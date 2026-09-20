# Nova Motion

Standalone text-to-video and image-to-video interface. The browser submits prompts and optional images to the backend; provider credentials stay server-side.

## Run locally

```bash
npm install
cp .env.example .env
# Set VIDEO_API_URL and VIDEO_API_KEY in .env
npm start
```

The backend expects a provider `POST` endpoint returning `{ "id": "..." }` and a `GET /:id` status endpoint returning `status`, `progress`, and `video_url` or `output_url` when complete. Adapt those calls to the selected vendor's API schema. Never commit `.env` or expose `VIDEO_API_KEY` in frontend code.
