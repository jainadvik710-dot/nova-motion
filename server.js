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
const JOB_TIMEOUT_MS = Number(process.env.HF_SPACE_TIMEOUT_MS || 15 * 60 * 1000);

app.use(express.static('.'));

function providerError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'Hugging Face generation failed.'; }
}

function extractVideoUrl(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoUrl(item);
      if (found) return found;
    }
  }
  if (typeof value === 'object') {
    return extractVideoUrl(value.url) || extractVideoUrl(value.video) || extractVideoUrl(value.data) || extractVideoUrl(value.path);
  }
  return null;
}

async function connectSpace() {
  const options = process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : undefined;
  return Client.connect(HF_SPACE_ID, options);
}

async function generateVideo(job, promptText) {
  try {
    job.status = 'processing';
    job.message = `Running ${HF_SPACE_ID} on free Hugging Face hardware.`;
    const client = await connectSpace();
    const result = await client.predict(HF_SPACE_API_NAME, [promptText]);
    const videoUrl = extractVideoUrl(result?.data ?? result);
    if (!videoUrl) {
      throw new Error(`The Hugging Face Space completed without returning a video URL. Raw response: ${JSON.stringify(result?.data ?? result)}`);
    }
    job.status = 'completed';
    job.progress = 100;
    job.videoUrl = videoUrl;
    job.message = 'Your real generated video is ready.';
  } catch (error) {
    job.status = 'failed';
    job.error = providerError(error);
    job.message = job.error;
    console.error('Hugging Face generation failed:', job.error);
  }
}

app.get('/api/capabilities', async (_req, res) => {
  try {
    const client = await connectSpace();
    return res.json({
      available: true,
      provider: 'Hugging Face Space',
      space: HF_SPACE_ID,
      apiName: HF_SPACE_API_NAME,
      model: 'latent-consistency/LTX-video-1.3B-distilled',
      textToVideo: true,
      imageToVideo: false,
      note: 'Availability depends on the Space being awake and free hardware being allocated.'
    });
  } catch (error) {
    return res.status(503).json({
      available: false,
      provider: 'Hugging Face Space',
      space: HF_SPACE_ID,
      error: providerError(error),
      message: 'Free Hugging Face hardware or the configured Space is unavailable.'
    });
  }
});

app.post('/api/generate', upload.single('image'), async (req, res) => {
  const promptText = String(req.body.prompt || '').trim();
  if (!promptText || promptText.length > 500) {
    return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  }
  if (req.file) {
    return res.status(400).json({ error: 'Image-to-video is unavailable with the selected free LTX Space. No image was sent to a substitute provider.' });
  }

  const id = crypto.randomUUID();
  const job = { id, status: 'queued', progress: 5, videoUrl: null, error: null, message: 'Waiting for free Hugging Face hardware.', createdAt: Date.now() };
  jobs.set(id, job);
  void generateVideo(job, promptText);
  return res.status(202).json({ id, status: 'processing', message: job.message });
});

app.get('/api/generate/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Generation job not found or the server restarted.' });
  if (!['completed', 'failed'].includes(job.status) && Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
    job.status = 'failed';
    job.error = 'Free Hugging Face hardware did not complete the generation before the timeout.';
    job.message = job.error;
  }
  return res.json({ id: job.id, status: job.status, progress: job.status === 'completed' ? 100 : job.progress, videoUrl: job.status === 'completed' ? job.videoUrl : null, error: job.status === 'failed' ? job.error : null, message: job.message });
});

app.listen(port, () => {
  console.log(`Nova Motion listening on port ${port}`);
});
