# Nova Motion

Nova Motion uses the Runway Dev API for real text-to-video and image-to-video generation. The browser sends inputs to the backend; `RUNWAYML_API_SECRET` is never sent to frontend code.

## Run locally

```bash
npm install
cp .env.example .env
```

Set these variables in the root `.env` file:

```env
RUNWAYML_API_SECRET=your_private_runway_secret
RUNWAY_MODEL=gen4.5
RUNWAY_API_VERSION=2024-11-06
RUNWAY_JOB_TIMEOUT_MS=900000
PORT=3000
```

`RUNWAYML_API_SECRET` is required and must be kept server-side. `RUNWAY_MODEL` defaults to `gen4.5` in the backend and must be a model enabled for your Runway account that supports the selected video endpoint. `RUNWAY_API_VERSION` defaults to `2024-11-06`; `RUNWAY_JOB_TIMEOUT_MS` defaults to 900000 (15 minutes); `PORT` defaults to 3000.

Start the server:

```bash
npm start
```

Open http://localhost:3000.

## API flow

- `POST /api/generate` validates the request and creates a real Runway task at `/v1/text_to_video` or `/v1/image_to_video`.
- `GET /api/generate/:id` polls `/v1/tasks/:taskId` until `SUCCEEDED`, `FAILED`, `CANCELED`, or timeout.
- `GET /api/generate/:id/video` proxies the completed Runway output to the browser for preview and download.

The frontend supports 5 and 10 seconds and maps 16:9 to `1280:720`, 9:16 to `720:1280`, and 1:1 to `720:720`. Runway model capabilities and account access can vary; if your chosen model rejects a value, the UI displays the provider error rather than fabricating a video.

## Test the backend

With the server running, test missing configuration:

```bash
curl -i -X POST http://localhost:3000/api/generate \
  -F 'prompt=A cinematic sunset over the mountains' \
  -F 'duration=5' \
  -F 'aspectRatio=16:9'
```

With a valid secret configured, the same command returns HTTP 202 and a JSON job id. Poll it using the returned id:

```bash
curl http://localhost:3000/api/generate/YOUR_JOB_ID
```

When `status` becomes `completed`, open the returned `videoUrl` or download it:

```bash
curl -L http://localhost:3000/api/generate/YOUR_JOB_ID/video -o nova-motion-video.mp4
```

For image-to-video:

```bash
curl -i -X POST http://localhost:3000/api/generate \
  -F 'prompt=Slow cinematic camera movement through the scene' \
  -F 'duration=5' \
  -F 'aspectRatio=9:16' \
  -F 'image=@/absolute/path/to/image.jpg'
```

Never commit `.env` or place the Runway secret in `script.js`, HTML, or a public frontend variable.
