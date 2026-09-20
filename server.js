import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { Client } from '@gradio/client';

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const jobs = new Map();
const HF_SPACE_ID = process.env.HF_SPACE_ID || 'ZeroGPU/LTX-Video-1.3B';
const HF_SPACE_API_NAME = process.env.HF_SPACE_API_NAME || '/generate';
const HF_SPACE_MODEL = process.env.HF_SPACE_MODEL || 'latent-consistency/LTX-video-1.3B-distilled';
const JOB_TIMEOUT_MS = Number(process.env.HF_SPACE_TIMEOUT_MS || 15 * 60 * 1000);

app.use(express.static('.'));

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'Hugging Face generation failed.'; }
}

function findVideoUrl(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findVideoUrl(item);
      if (url) return url;
    }
  }
  if (typeof value === 'object') {
    return findVideoUrl(value.url) || findVideoUrl(value.video) || findVideoUrl(value.data) || findVideoUrl(value.path);
  }
  return null;
}

async function connectSpace() {
  return Client.connect(HF_SPACE_ID, process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : undefined);
}

async function runGeneration(job, promptText) {
  try {
    job.status = 'processing';
    job.progress = 20;
    job.message = `Connected. Waiting for free Hugging Face hardware for ${HF_SPACE_ID}.`;
    const client = await connectSpace();
    job.progress = 35;
    job.message = 'Model is generating a real video. This may take several minutes on shared hardware.';
    const result = await client.predict(HF_SPACE_API_NAME, [promptText]);
    const output = result?.data ?? result;
    const videoUrl = findVideoUrl(output);
    if (!videoUrl) {
      throw new Error(`The Hugging Face endpoint completed without returning a video URL. Response: ${JSON.stringify(output)}`);
    }
    job.status = 'completed';
    job.progress = 100;
    job.videoUrl = videoUrl;
    job.message = 'Real generated video ready.';
  } catch (error) {
    job.status = 'failed';
    job.error = errorMessage(error);
    job.message = job.error;
    console.error('Hugging Face generation failed:', job.error);
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/capabilities', async (_req, res) => {
  try {
    await connectSpace();
    return res.json({ available: true, provider: 'Hugging Face Space', space: HF_SPACE_ID, apiName: HF_SPACE_API_NAME, model: HF_SPACE_MODEL, textToVideo: true, imageToVideo: false, message: 'The Space is reachable. Free hardware is still allocated per generation.' });
  } catch (error) {
    return res.status(503).json({ available: false, provider: 'Hugging Face Space', space: HF_SPACE_ID, error: errorMessage(error), message: 'The free Hugging Face Space or hardware is unavailable.' });
  }
});

app.post('/api/generate', upload.single('image'), (req, res) => {
  const promptText = String(req.body.prompt || '').trim();
  if (!promptText || promptText.length > 500) return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  if (req.file) return res.status(400).json({ error: 'Image-to-video is unavailable for the selected free model. No image was sent to another provider.' });

  const id = crypto.randomUUID();
  const job = { id, status: 'queued', progress: 5, videoUrl: null, error: null, message: 'Queued for free Hugging Face hardware.', createdAt: Date.now() };
  jobs.set(id, job);
  void runGeneration(job, promptText);
  return res.status(202).json({ id, status: job.status, progress: job.progress, message: job.message });
});

app.get('/api/generate/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Generation job not found or the server restarted.' });
  if (!['completed', 'failed'].includes(job.status) && Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
    job.status = 'failed';
    job.error = 'Free Hugging Face hardware did not complete the generation before the timeout.';
    job.message = job.error;
  }
  return res.json({ id: job.id, status: job.status, progress: job.progress, videoUrl: job.status === 'completed' ? job.videoUrl : null, error: job.status === 'failed' ? job.error : null, message: job.message });
});

app.listen(port, () => console.log(`Nova Motion listening on port ${port}`));
