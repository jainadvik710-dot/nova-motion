import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes } });
const jobs = new Map();
const allowedDurations = new Set(['5', '10']);
const allowedRatios = new Set(['16:9', '9:16', '1:1']);

app.use(express.static('.'));

function providerConfigured() {
  return Boolean(process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_MODEL);
}

function modelUrl(model) {
  const parts = model.split('/');
  if (parts.length !== 2) throw new Error('REPLICATE_MODEL must use the owner/model format.');
  return `https://api.replicate.com/v1/models/${parts[0]}/${parts[1]}/predictions`;
}

function sizeForRatio(ratio) {
  return { '16:9': '1280*720', '9:16': '720*1280', '1:1': '720*720' }[ratio];
}

function imageDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function providerHeaders() {
  return {
    Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json',
    Prefer: 'wait=1',
    'Cancel-After': process.env.VIDEO_JOB_TIMEOUT || '10m'
  };
}

function providerError(payload, status) {
  const detail = typeof payload?.detail === 'string' ? payload.detail : payload?.error;
  return new Error(detail || `Video provider request failed (${status}).`);
}

function outputUrl(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.find(item => typeof item === 'string') || null;
  if (output && typeof output === 'object') return output.video || output.video_url || output.url || null;
  return null;
}

async function createPrediction({ prompt, duration, aspectRatio, file }) {
  const model = file && process.env.REPLICATE_IMAGE_MODEL ? process.env.REPLICATE_IMAGE_MODEL : process.env.REPLICATE_MODEL;
  const input = {
    prompt,
    duration: Number(duration),
    size: sizeForRatio(aspectRatio)
  };
  if (file) input[process.env.REPLICATE_IMAGE_INPUT_KEY || 'image'] = imageDataUrl(file);
  const response = await fetch(modelUrl(model), {
    method: 'POST',
    headers: providerHeaders(),
    body: JSON.stringify({ input })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(payload, response.status);
  return payload;
}

async function getPrediction(job) {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(job.providerId)}`, {
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(payload, response.status);
  return payload;
}

app.post('/api/videos', upload.single('image'), async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  const duration = String(req.body.duration || '');
  const aspectRatio = String(req.body.aspectRatio || '');
  if (!prompt || prompt.length > 500) return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  if (!allowedDurations.has(duration)) return res.status(400).json({ error: 'Duration must be 5 or 10 seconds.' });
  if (!allowedRatios.has(aspectRatio)) return res.status(400).json({ error: 'Aspect ratio must be 16:9, 9:16, or 1:1.' });
  if (req.file && !req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Starting file must be an image.' });
  if (!providerConfigured()) return res.status(503).json({ error: 'Video provider is not configured. Add REPLICATE_API_TOKEN and REPLICATE_MODEL to .env.' });

  const id = crypto.randomUUID();
  try {
    const prediction = await createPrediction({ prompt, duration, aspectRatio, file: req.file });
    jobs.set(id, { id, providerId: prediction.id, status: prediction.status || 'starting', progress: 5, output: null, error: null });
    res.status(202).json({ id });
  } catch (error) {
    console.error('Replicate create prediction failed:', error);
    res.status(502).json({ error: error.message || 'The video provider rejected the request.' });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Generation job not found or server restarted.' });
  if (!['succeeded', 'failed', 'canceled'].includes(job.status)) {
    try {
      const prediction = await getPrediction(job);
      const mappedStatus = prediction.status === 'succeeded' ? 'completed' : prediction.status === 'canceled' ? 'canceled' : prediction.status === 'failed' ? 'failed' : 'processing';
      job.status = mappedStatus;
      job.progress = mappedStatus === 'completed' ? 100 : Math.min(95, Math.max(job.progress, Number(prediction.progress) || job.progress + 3));
      job.output = outputUrl(prediction.output);
      job.error = prediction.error || null;
      jobs.set(job.id, job);
    } catch (error) {
      console.error('Replicate polling failed:', error);
      return res.status(502).json({ error: 'Could not check the video provider status. Please try again.' });
    }
  }
  res.json({ id: job.id, status: job.status, progress: job.progress, videoUrl: job.status === 'completed' ? `/api/videos/${job.id}/file` : null, error: job.error, message: job.status === 'completed' ? 'Your video is ready.' : job.status === 'failed' ? 'The provider could not generate this video.' : 'Rendering frames securely on the server.' });
});

app.get('/api/videos/:id/file', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.output) return res.status(404).json({ error: 'Video output is not ready.' });
  try {
    const upstream = await fetch(job.output);
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: 'Generated video is temporarily unavailable.' });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="nova-motion-video.mp4"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    upstream.body.pipeTo(new WritableStream({ write(chunk) { res.write(Buffer.from(chunk)); }, close() { res.end(); }, abort() { res.end(); } })).catch(() => res.end());
  } catch (error) {
    console.error('Video download proxy failed:', error);
    res.status(502).json({ error: 'Could not retrieve the generated video.' });
  }
});

app.listen(port, () => console.log(`Nova Motion listening on http://localhost:${port}`));
