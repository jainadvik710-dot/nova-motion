# Nova Motion

Standalone text-to-video and image-to-video interface backed by Replicate. The frontend never receives a provider API key. The backend creates and polls Replicate predictions, then proxies the completed video to the browser for preview and download.

## Exact setup

1. Install Node.js 18+ (Node 20+ recommended).
2. Create a Replicate account and API token at <https://replicate.com/account/api-tokens>.
3. Clone this repository and install dependencies:

```bash
npm install
```

4. Create a server-only environment file in the repository root:

```bash
cp .env.example .env
```

5. Edit `.env` and set these variables:

```env
REPLICATE_API_TOKEN=r8_your_private_token
REPLICATE_MODEL=wan-video/wan-2.6-t2v
REPLICATE_IMAGE_MODEL=
REPLICATE_IMAGE_INPUT_KEY=image
VIDEO_JOB_TIMEOUT=10m
PORT=3000
```

- `REPLICATE_API_TOKEN` is required and must stay server-side. Do not prefix it with `VITE_`, `NEXT_PUBLIC_`, or put it in `script.js`.
- `REPLICATE_MODEL` is required. It must be a Replicate model slug whose current schema accepts `prompt`, numeric `duration`, and `size` inputs. The example model is a starting point; verify its current schema before production use.
- `REPLICATE_IMAGE_MODEL` is optional. Set it to a separate Replicate model slug if image-to-video needs a different model. If blank, the text model is used for both modes.
- `REPLICATE_IMAGE_INPUT_KEY` defaults to `image`. Change it only when the selected model names its image input differently.
- `VIDEO_JOB_TIMEOUT` is sent to Replicate as the maximum prediction lifetime.
- `PORT` is the local backend port.

6. Start the server:

```bash
npm start
```

Open <http://localhost:3000>.

## API flow

- `POST /api/videos` validates the prompt, duration, ratio, and optional image, then creates a real Replicate prediction with the server-side token.
- `GET /api/videos/:id` polls Replicate and maps provider states to the frontend progress screen.
- `GET /api/videos/:id/file` streams the completed provider output through the backend, so the frontend does not need a provider URL or credential.

The UI supports 5 and 10 seconds and maps aspect ratios to `1280*720`, `720*1280`, and `720*720`. Exact duration and aspect-ratio support remains model-dependent; choose a Replicate model that supports all requested values or adapt `createPrediction()` in `server.js` to that model's schema.

## Deployment

Set the same environment variables as encrypted server-side secrets in your hosting provider. Do not commit `.env`. Add authentication, rate limiting, durable job storage, and provider webhooks before exposing this endpoint publicly; the in-memory job map is intentionally simple and is not restart-safe.
