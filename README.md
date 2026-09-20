# Nova Motion

Nova Motion uses the Runway Dev API for real text-to-video and image-to-video generation. The browser sends generation inputs only to this backend. `RUNWAYML_API_SECRET` is never sent to the frontend.

## Exact setup

1. Install Node.js 18+ (Node 20+ recommended).
2. Create a Runway API key in your Runway developer account.
3. From the repository root, install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env
```

4. Edit `.env`:

```env
RUNWAYML_API_SECRET=your_private_runway_secret
RUNWAY_MODEL=gen4_turbo
RUNWAY_API_VERSION=2024-11-06
PORT=3000
```

- `RUNWAYML_API_SECRET` is required. Keep it in the server environment only. Never place it in `script.js`, HTML, or a public frontend variable.
- `RUNWAY_MODEL` defaults to `gen4_turbo`. Use a Runway model available to your account that supports the selected endpoint and the requested duration/ratios.
- `RUNWAY_API_VERSION` controls the `X-Runway-Version` request header and defaults to `2024-11-06`.
- `PORT` is the local server port.

5. Start Nova Motion:

```bash
npm start
```

Open <http://localhost:3000>.

## Integration flow

- `POST /api/videos` validates the request, chooses Runway `text_to_video` or `image_to_video`, and creates a real Runway task using the backend secret.
- `GET /api/videos/:id` polls `GET /v1/tasks/:taskId` and maps Runway task status to the existing UI progress state.
- `GET /api/videos/:id/file` streams the completed Runway output through the backend for preview and download.

The UI's 5 and 10 second options are sent as numeric durations. Aspect ratios are mapped to Runway pixel ratios: 16:9 → `1280:720`, 9:16 → `720:1280`, and 1:1 → `720:720`. Verify that the selected Runway model supports all requested values; provider capabilities can vary by model and account.

## Production notes

Set `RUNWAYML_API_SECRET` as an encrypted secret in your hosting provider rather than committing `.env`. Before public launch, add authentication, rate limiting, durable job storage, request cleanup, and a webhook strategy if supported by the selected Runway API plan. The in-memory job map is suitable for a single-process starter deployment but is not restart-safe.
