# Nova Motion

Nova Motion uses the Runway Dev API for real text-to-video and image-to-video generation. The browser sends inputs to the backend; `RUNWAYML_API_SECRET` is never sent to frontend code.

## Deploy with a Node.js host

Nova Motion is a single Node.js service: Express serves the existing frontend and handles the backend Runway integration. The frontend uses same-origin `/api/...` routes, so no production backend URL needs to be hard-coded.

### Environment variables

Copy the variable names from `.env.example` into your hosting provider's **server/runtime environment variables**. Set the secret value only in the provider dashboard or secret manager:

```env
RUNWAYML_API_SECRET=your_private_runway_secret
RUNWAY_MODEL=gen4.5
RUNWAY_API_VERSION=2024-11-06
RUNWAY_JOB_TIMEOUT_MS=900000
RUNWAY_10S_MODELS=gen4.5,gen4_turbo,veo3,veo3.1,veo3.1_fast,seedance-2.5
```

`RUNWAYML_API_SECRET` must contain the real Runway API secret, but it must never be committed to Git, placed in frontend JavaScript/HTML, or configured as a client-exposed/public environment variable. Leave the value blank in `.env.example`.

The service listens on the port supplied by the host through `process.env.PORT`. Do not hard-code a production port.

### Simplest deployment

1. Create a service from this GitHub repository on a Node.js hosting provider such as Render, Railway, or Fly.io.
2. Use the build command `npm install` (or the provider's automatic Node.js install).
3. Use the start command `npm start` or `npm run start:production`.
4. Add `RUNWAYML_API_SECRET` as a server-side environment variable, and add the optional variables above if you want to override their defaults.
5. Deploy and open the HTTPS URL supplied by the host. The existing frontend and `/api/generate` endpoints are served by the same service.

Do not deploy this as a static-only site: the Node.js service must remain running because it holds the Runway secret and proxies generation/polling requests.

## Local setup

Create a local `.env` file in the project root. Never commit it:

```bash
cp .env.example .env
# Edit .env and set RUNWAYML_API_SECRET to your real secret.
npm install
npm start
```

Open the local URL printed by the server. In production, use the HTTPS URL provided by your host; the frontend continues to call the same-origin backend automatically.

## Test one real generation

Text-to-video test:

```bash
curl -i -X POST http://localhost:3000/api/generate \
  -F 'prompt=A cinematic sunrise over a quiet mountain lake' \
  -F 'duration=5' \
  -F 'aspectRatio=16:9'
```

This returns a JSON response with an `id`. Poll it:

```bash
curl http://localhost:3000/api/generate/YOUR_JOB_ID
```

When `status` is `completed`, the response includes the real `videoUrl` from Runway. The Nova Motion UI displays the generated output; it does not use fake or demo video URLs.

Image-to-video test:

```bash
curl -i -X POST http://localhost:3000/api/generate \
  -F 'prompt=Slow cinematic camera movement through the scene' \
  -F 'duration=5' \
  -F 'aspectRatio=9:16' \
  -F 'image=@/absolute/path/to/your/image.jpg'
```

## Security and error handling

- Never commit `.env` or any real API secret.
- Never put the API key in `script.js`, HTML, or public frontend code.
- The backend sends the secret to Runway only from the server environment.
- Runway failures are returned as errors; the UI must not substitute a fake video.
- If the selected Runway model does not support a requested duration, the backend returns a clear validation error.
