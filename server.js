import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const jobs = new Map();
const RUNWAY_API = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = process.env.RUNWAY_API_VERSION || '2024-11-06';
const RUNWAY_MODEL = process.env.RUNWAY_MODEL || 'gen4.5';
const JOB_TIMEOUT_MS = Number(process.env.RUNWAY_JOB_TIMEOUT_MS || 15 * 60 * 1000);
const allowedDurations = new Set(['5', '10']);
const ratioValues = { '16:9': '1280:720', '9:16': '720:1280', '1:1': '720:720' };

app.use(express.static('.'));

function apiHeaders() {
  return { Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, 'X-Runway-Version': RUNWAY_VERSION, 'Content-Type': 'application/json' };
}
function imageDataUrl(file) { return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`; }
function outputUrl(output) { return Array.isArray(output) ? output.find(value => typeof value === 'string') : typeof output === 'string' ? output : output?.url || output?.video_url || null; }
function providerMessage(payload, status) {
  const error = payload?.error;
  const code = error?.code || payload?.code;
  const message = error?.message || payload?.message || payload?.detail || (typeof error === 'string' ? error : 'Runway request failed.');
  if (status === 401) return 'Runway API key is invalid or unauthorized.';
  if (status === 403 || code === 'INSUFFICIENT_CREDITS' || /credit|quota|balance/i.test(message)) return 'Runway account has insufficient credits or is not permitted to use this model.';
  if (status === 404) return 'Runway model or endpoint was not found. Check RUNWAY_MODEL and API access.';
  if (status === 429) return 'Runway rate limit reached. Please wait and try again.';
  if (status >= 500) return 'Runway is temporarily unavailable. Please try again later.';
  return message || `Runway request failed (${status}).`;
}
async function runwayRequest(path, options = {}) {
  const response = await fetch(`${RUNWAY_API}${path}`, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(providerMessage(payload, response.status)); error.status = response.status; throw error; }
  return payload;
}

app.post('/api/generate', upload.single('image'), async (req, res) => {
  const promptText = String(req.body.prompt || '').trim();
  const duration = String(req.body.duration || '');
  const aspectRatio = String(req.body.aspectRatio || '');
  if (!process.env.RUNWAYML_API_SECRET) return res.status(503).json({ error: 'Runway is not configured. Add RUNWAYML_API_SECRET to the server environment.' });
  if (!promptText || promptText.length > 500) return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  if (!allowedDurations.has(duration)) return res.status(400).json({ error: 'Duration must be 5 or 10 seconds.' });
  if (!ratioValues[aspectRatio]) return res.status(400).json({ error: 'Aspect ratio must be 16:9, 9:16, or 1:1.' });
  if (req.file && !req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Starting file must be an image.' });

  const payload = { model: RUNWAY_MODEL, promptText, ratio: ratioValues[aspectRatio], duration: Number(duration) };
  const endpoint = req.file ? '/image_to_video' : '/text_to_video';
  if (req.file) payload.promptImage = [{ uri: imageDataUrl(req.file), position: 'first' }];
  try {
    const task = await runwayRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    const id = crypto.randomUUID();
    jobs.set(id, { id, taskId: task.id, status: task.status || 'PENDING', progress: 5, output: null, error: null, createdAt: Date.now() });
    res.status(202).json({ id, status: 'processing' });
  } catch (error) {
    console.error('Runway task creation failed:', error);
    res.status(error.status === 401 || error.status === 403 ? 502 : 502).json({ error: error.message || 'Runway rejected the generation request.' });
  }
});

app.get('/api/generate/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Generation job not found or the server restarted.' });
  if (!['SUCCEEDED', 'FAILED', 'CANCELED'].includes(job.status)) {
    if (Date.now() - job.createdAt > JOB_TIMEOUT_MS) { job.status = 'FAILED'; job.error = 'Video generation timed out. Please try again.'; jobs.set(job.id, job); }
    else {
      try {
        const task = await runwayRequest(`/tasks/${encodeURIComponent(job.taskId)}`, { headers: { 'Content-Type': undefined } });
        job.status = task.status;
        job.output = outputUrl(task.output);
        job.error = task.failure?.message || task.failure || task.error?.message || task.error || null;
        job.progress = task.status === 'SUCCEEDED' ? 100 : Math.min(95, Math.max(job.progress + 3, Number(task.progress) || 0));
        jobs.set(job.id, job);
      } catch (error) {
        console.error('Runway task polling failed:', error);
        return res.status(502).json({ error: error.message || 'Could not check Runway task status.' });
      }
    }
  }
  const completed = job.status === 'SUCCEEDED';
  const failed = job.status === 'FAILED' || job.status === 'CANCELED';
  res.json({ id: job.id, status: completed ? 'completed' : failed ? 'failed' : 'processing', progress: job.progress, videoUrl: completed ? `/api/generate/${job.id}/video` : null, error: failed ? (job.error || 'Runway could not generate this video.') : null, message: completed ? 'Your video is ready.' : failed ? job.error || 'Generation failed.' : 'Runway is rendering your video securely.' });
});

app.get('/api/generate/:id/video', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.output) return res.status(404).json({ error: 'Video output is not ready.' });
  try {
    const upstream = await fetch(job.output);
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: 'Runway output is temporarily unavailable.' });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="nova-motion-video.mp4"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
    res.end();
  } catch (error) { console.error('Runway output proxy failed:', error); if (!res.headersSent) res.status(502).json({ error: 'Could not retrieve the generated video.' }); else res.end(); }
});

app.listen(port, () => console.log(`Nova Motion listening on http://localhost:${port}`));
