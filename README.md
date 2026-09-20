# Nova Motion

Nova Motion is a focused AI video-generation website. It uses the open `latent-consistency/LTX-video-1.3B-distilled` model through a Hugging Face Space and does not use Runway, paid video APIs, fake media, or demo URLs.

## Free-provider limitations

The default Space is `ZeroGPU/LTX-Video-1.3B`. It supports text-to-video for this integration. Image-to-video is intentionally disabled because the selected Space/model endpoint is not verified to support it. Hugging Face free hardware is shared: it can sleep, queue, run out of quota, or be unavailable. Nova Motion shows the real provider error and never substitutes a video.

## Configuration

```bash
npm install
cp .env.example .env
npm start
```

Server-side variables:

```env
HF_SPACE_ID=ZeroGPU/LTX-Video-1.3B
HF_SPACE_API_NAME=/generate
HF_SPACE_MODEL=latent-consistency/LTX-video-1.3B-distilled
HF_SPACE_TIMEOUT_MS=900000
PORT=3000
```

`HF_TOKEN` is optional and must only be configured in the server environment if a selected Space requires authentication. Never place it in `index.html` or `script.js`. No Runway key or paid API is required.

## Production deployment

Deploy as a Node.js web service, not a static-only site. Use `npm install` as the build command and `npm start` as the start command. Configure the variables above in the host's server-side environment. The frontend uses same-origin `/api` requests, so it does not contain a localhost or provider secret.

Check `GET /health` and `GET /api/capabilities` after deployment. A successful capabilities response means the Space is reachable, not that free GPU capacity is guaranteed. A generation returns a video only after the Hugging Face endpoint returns a real video URL.
