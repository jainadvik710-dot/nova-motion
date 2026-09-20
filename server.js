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
const allowedDurations = new Set(['5', '10']);
const allowedRatios = new Set(['16:9', '9:16', '1:1']);

app.use(express.static('.'));

function configured() { return Boolean(process.env.RUNWAYML_API_SECRET); }
function headers() { return { Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, 'X-Runway-Version': RUNWAY_VERSION, 'Content-Type': 'application/json' }; }
function ratioValue(ratio) { return { '16:9': '1280:720', '9:16': '720:1280', '1:1': '720:720' }[ratio]; }
function dataUrl(file) { return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`; }
function providerError(payload, status) { return new Error(payload?.error || payload?.message || payload?.detail || `Runway request failed (${status}).`); }
function outputUrl(output) { return Array.isArray(output) ? output.find(value => typeof value === 'string') : typeof output === 'string' ? output : output?.url || output?.video_url || null; }

async function runwayRequest(path, options = {}) {
  const response = await fetch(`${RUNWAY_API}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(payload, response.status);
  return payload;
}

app.post('/api/videos', upload.single('image'), async (req, res) => {
  const promptText = String(req.body.prompt || '').trim();
  const duration = String(req.body.duration || '');
  const aspectRatio = String(req.body.aspectRatio || '');
  if (!promptText || promptText.length > 500) return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  if (!allowedDurations.has(duration)) return res.status(400).json({ error: 'Duration must be 5 or 10 seconds.' });
  if (!allowedRatios.has(aspectRatio)) return res.status(400).json({ error: 'Aspect ratio must be 16:9, 9:16, or 1:1.' });
  if (req.file && !req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Starting file must be an image.' });
  if (!configured()) return res.status(503).json({ error: 'Runway is not configured. Add RUNWAYML_API_SECRET to the server environment.' });

  const payload = { model: process.env.RUNWAY_MODEL || 'gen4_turbo', promptText, ratio: ratioValue(aspectRatio), duration: Number(duration) };
  const endpoint = req.file ? '/image_to_video' : '/text_to_video';
  if (req.file) payload.promptImage = dataUrl(req.file);
  try {
    const task = await runwayRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    const id = crypto.randomUUID();
    jobs.set(id, { id, taskId: task.id, status: task.status || 'PENDING', progress: 5, output: null, error: null });
    res.status(202).json({ id });
  } catch (error) {
    console.error('Runway task creation failed:', error);
    res.status(502).json({ error: error.message || 'Runway rejected the generation request.' });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Generation job not found or server restarted.' });
  if (!['SUCCEEDED', 'FAILED', 'CANCELED'].includes(job.status)) {
    try {
      const task = await runwayRequest(`/tasks/${encodeURIComponent(job.taskId)}`);
      job.status = task.status;
      job.output = outputUrl(task.output);
      job.error = task.failure || task.error || null;
      job.progress = task.status === 'SUCCEEDED' ? 100 : Math.min(95, Math.max(job.progress + 3, Number(task.progress) || 0));
      jobs.set(job.id, job);
    } catch (error) {
      console.error('Runway task polling failed:', error);
      return res.status(502).json({ error: 'Could not check Runway task status. Please try again.' });
    }
  }
  const completed = job.status === 'SUCCEEDED';
  res.json({ id: job.id, status: completed ? 'completed' : job.status === 'FAILED' || job.status === 'CANCELED' ? 'failed' : 'processing', progress: job.progress, videoUrl: completed ? `/api/videos/${job.id}/file` : null, error: job.error, message: completed ? 'Your video is ready.' : job.status === 'FAILED' || job.status === 'CANCELED' ? 'Runway could not generate this video.' : 'Runway is rendering your video securely.' });
});

app.get('/api/videos/:id/file', async (req, res) => {
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
