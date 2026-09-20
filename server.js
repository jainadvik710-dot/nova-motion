import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const jobs = new Map();
const RUNWAY_API_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_API_VERSION = process.env.RUNWAY_API_VERSION || '2024-11-06';
const DEFAULT_MODEL = 'gen4.5';
const RUNWAY_MODEL = process.env.RUNWAY_MODEL || DEFAULT_MODEL;
const JOB_TIMEOUT_MS = Number(process.env.RUNWAY_JOB_TIMEOUT_MS || 15 * 60 * 1000);
const supportedTenSecondModels = new Set((process.env.RUNWAY_10S_MODELS || 'gen4.5,gen4_turbo,veo3,veo3.1,veo3.1_fast,seedance-2.5').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
const ratioValues = {
  '16:9': '1280:720',
  '9:16': '720:1280',
  '1:1': '720:720'
};

app.use(express.static('.'));

function supportsDuration(model, duration) {
  if (duration === 5) return true;
  if (duration === 10) return supportedTenSecondModels.has(String(model).toLowerCase());
  return false;
}

function modelWarning(model) {
  const validModels = ['gen4.5', 'gen4_turbo', 'veo3', 'veo3.1', 'veo3.1_fast', 'seedance-2.5'];
  if (!validModels.includes(String(model).toLowerCase())) {
    return `Invalid Runway model '${model}'. Use one of: ${validModels.join(', ')}`;
  }
  return null;
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
    'X-Runway-Version': RUNWAY_API_VERSION,
    'Content-Type': 'application/json'
  };
}

function imageDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function extractOutputUrl(output) {
  if (Array.isArray(output)) return output.find(value => typeof value === 'string') || null;
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    return output.url || output.video_url || output.videoUrl || null;
  }
  return null;
}

function handleProviderError(payload, status) {
  const error = payload?.error;
  const messageFromPayload = error?.message || payload?.message || payload?.detail || (typeof error === 'string' ? error : 'Runway request failed.');
  const normalized = String(messageFromPayload || '').toLowerCase();

  if (status === 401) return 'Runway API key is missing, invalid, or unauthorized.';
  if (status === 403 || normalized.includes('credit') || normalized.includes('quota') || normalized.includes('balance')) return 'Runway account has insufficient credits or is not permitted to use this model.';
  if (status === 404) return 'Runway model or task endpoint was not found. Check RUNWAY_MODEL and your Runway account access.';
  if (status === 429) return 'Runway rate limit reached. Please wait and try again.';
  if (status >= 500) return 'Runway is temporarily unavailable. Please try again later.';
  return messageFromPayload || `Runway request failed (${status}).`;
}

async function runwayRequest(path, options = {}) {
  const response = await fetch(`${RUNWAY_API_BASE}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(handleProviderError(payload, response.status));
    error.status = response.status;
    throw error;
  }

  return payload;
}

app.post('/api/generate', upload.single('image'), async (req, res) => {
  const promptText = String(req.body.prompt || '').trim();
  const duration = Number(req.body.duration);
  const aspectRatio = String(req.body.aspectRatio || '');
  const modelWarningMessage = modelWarning(RUNWAY_MODEL);

  if (!process.env.RUNWAYML_API_SECRET) {
    return res.status(503).json({ error: 'RUNWAYML_API_SECRET is missing. Add it to the backend environment only.' });
  }

  if (modelWarningMessage) {
    return res.status(400).json({ error: modelWarningMessage });
  }

  if (!promptText || promptText.length > 500) {
    return res.status(400).json({ error: 'Prompt is required and must be 500 characters or fewer.' });
  }

  if (!Number.isFinite(duration) || !supportsDuration(RUNWAY_MODEL, duration)) {
    return res.status(400).json({ error: `Unsupported duration ${duration}. This model supports 5 seconds and, when enabled, 10 seconds.` });
  }

  if (!ratioValues[aspectRatio]) {
    return res.status(400).json({ error: 'Aspect ratio must be 16:9, 9:16, or 1:1.' });
  }

  if (req.file && !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'The uploaded start frame must be an image file.' });
  }

  const payload = {
    model: RUNWAY_MODEL,
    promptText,
    ratio: ratioValues[aspectRatio],
    duration
  };

  const endpoint = req.file ? '/image_to_video' : '/text_to_video';

  if (req.file) {
    payload.promptImage = imageDataUrl(req.file);
  }

  try {
    const task = await runwayRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!task || !task.id) {
      return res.status(502).json({ error: 'Runway did not return a valid task ID.' });
    }

    const id = crypto.randomUUID();
    jobs.set(id, {
      id,
      taskId: task.id,
      status: task.status || 'PENDING',
      progress: 5,
      output: null,
      error: null,
      createdAt: Date.now()
    });

    return res.status(202).json({ id, status: 'processing' });
  } catch (error) {
    console.error('Runway task creation failed:', error);
    return res.status(error.status || 502).json({ error: error.message || 'Runway rejected the generation request.' });
  }
});

app.get('/api/generate/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Generation job not found or the server restarted.' });
  }

  if (!['SUCCEEDED', 'FAILED', 'CANCELED'].includes(job.status)) {
    if (Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
      job.status = 'FAILED';
      job.error = 'Video generation timed out. Please try again.';
      jobs.set(job.id, job);
    } else {
      try {
        const task = await runwayRequest(`/tasks/${encodeURIComponent(job.taskId)}`, { method: 'GET' });
        job.status = task.status || job.status;
        job.output = extractOutputUrl(task.output);
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

  return res.json({
    id: job.id,
    status: completed ? 'completed' : failed ? 'failed' : 'processing',
    progress: job.progress,
    videoUrl: completed ? job.output : null,
    error: failed ? (job.error || 'Runway could not generate this video.') : null,
    message: completed ? 'Your video is ready.' : failed ? job.error || 'Generation failed.' : 'Runway is rendering your video securely.'
  });
});

app.get('/api/generate/:id/video', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.output) {
    return res.status(404).json({ error: 'Video output is not ready.' });
  }

  try {
    const upstream = await fetch(job.output);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: 'Runway output is temporarily unavailable.' });
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="nova-motion-video.mp4"');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    for await (const chunk of upstream.body) {
      res.write(Buffer.from(chunk));
    }
    res.end();
  } catch (error) {
    console.error('Runway output proxy failed:', error);
    if (!res.headersSent) {
      return res.status(502).json({ error: 'Could not retrieve the generated video.' });
    }
    return res.end();
  }
});

app.listen(port, () => {
  console.log(`Nova Motion listening on http://localhost:${port}`);
});

