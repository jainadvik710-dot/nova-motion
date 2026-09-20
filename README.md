# Nova Motion

Nova Motion is a real video-generation UI backed by an open model in a Hugging Face Space. Runway and all paid video APIs have been removed. The app never uses fake or demo video URLs.

## Current free model and deployment

The default provider is the public Hugging Face Space `ZeroGPU/LTX-Video-1.3B`, using the open `latent-consistency/LTX-video-1.3B-distilled` model through the Gradio client. It is selected because it supports text-to-video and is much more practical for a free shared GPU Space than larger video models.

This is a zero-cost, best-effort deployment, not guaranteed compute. Hugging Face free Spaces can sleep, queue, time out, or reject work when free hardware/quota is unavailable. Nova Motion reports those provider errors instead of creating a placeholder video. The model is text-to-video only in this integration; image-to-video is deliberately rejected rather than silently substituted.

The existing Nova Motion frontend remains in place and calls the same-origin Node backend. The backend connects to the Space, waits for the real generation result, and returns its real video URL.

## Environment

Copy `.env.example` to `.env` for local use:

```env
HF_SPACE_ID=ZeroGPU/LTX-Video-1.3B
HF_SPACE_API_NAME=/generate
HF_SPACE_TIMEOUT_MS=900000
PORT=3000
```

`HF_TOKEN` is optional and must be configured only as a server-side environment variable if the selected Space requires authentication. Do not put it in browser code. No paid API, Runway secret, credit card, or paid Hugging Face hardware is required by the application.

`HF_SPACE_API_NAME` must match the actual generation endpoint exposed by the selected Space. If the Space changes its endpoint or is unavailable, `/api/capabilities` and generation return the exact connection/provider error.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Check provider availability at `GET /api/capabilities` before generating.

## Free Hugging Face deployment

The simplest no-cost setup is:

1. Create a free public Hugging Face Space for the UI/backend, or run this Node service on a free Node host.
2. Configure `HF_SPACE_ID=ZeroGPU/LTX-Video-1.3B` and `HF_SPACE_API_NAME=/generate` as server variables.
3. Use `npm install` as the build command and `npm start` as the start command.
4. Do not add a paid provider, Runway key, or client-side token.

For a fully self-contained Hugging Face Space, the same Space should expose the model and a Gradio endpoint named `/generate`; otherwise point `HF_SPACE_ID` at a compatible public Space. Free hardware availability is not guaranteed. A genuine video is returned only when the model actually completes.

## API flow

- `GET /api/capabilities` checks whether the configured Space can be reached.
- `POST /api/generate` accepts a prompt and creates an in-memory job.
- `GET /api/generate/:id` polls that job until `completed` or `failed`.
- `image` uploads return an explicit unsupported error because the selected free model integration is text-only.

Failures such as sleeping Space, missing free hardware, quota exhaustion, model load errors, endpoint mismatch, and inference errors are displayed as real errors. No fake video is ever returned.
