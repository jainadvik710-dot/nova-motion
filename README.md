# Nova Motion

Nova Motion uses the current Runway Dev API for real text-to-video and image-to-video generation. The browser sends inputs to the backend; `RUNWAYML_API_SECRET` is never sent to frontend code.

## Required environment variables

Create a local `.env` file in the project root and set:

```env
RUNWAYML_API_SECRET=your_private_runway_secret
RUNWAY_MODEL=gen4.5
RUNWAY_API_VERSION=2024-11-06
RUNWAY_JOB_TIMEOUT_MS=900000
RUNWAY_10S_MODELS=gen4.5,gen4_turbo,veo3,veo3.1,veo3.1_fast,seedance-2.5
PORT=3000
```

Notes:
- `RUNWAYML_API_SECRET` is required and must stay on the backend only.
- `RUNWAY_MODEL` should be a current Runway model supported by your account.
- `RUNWAY_10S_MODELS` is optional and controls which models are allowed to accept 10-second requests.
- `RUNWAY_API_VERSION` must match your Runway API version header.

## Install and run

```bash
npm install
cp .env.example .env
# edit .env with your real values
npm start
```

Open:

```bash
http://localhost:3000
```

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

When `status` is `completed`, the response includes the real `videoUrl` from Runway:

```bash
curl http://localhost:3000/api/generate/YOUR_JOB_ID
```

Download the final video:

```bash
curl -L "$(curl -s http://localhost:3000/api/generate/YOUR_JOB_ID | python3 -c 'import sys, json; print(json.load(sys.stdin)["videoUrl"])')" -o nova-motion-video.mp4
```

Image-to-video test:

```bash
curl -i -X POST http://localhost:3000/api/generate \
  -F 'prompt=Slow cinematic camera movement through the scene' \
  -F 'duration=5' \
  -F 'aspectRatio=9:16' \
  -F 'image=@/absolute/path/to/your/image.jpg'
```

Important:
- Never commit `.env`.
- Never put the API key in `script.js`, HTML, or public frontend code.
- Do not use fake or demo video URLs.
- If the selected Runway model does not support 10s, the backend returns a clear validation error.
