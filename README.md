# podcast-tts-long-audio (Render-ready)

A minimal Express service that wraps Google Cloud Text-to-Speech **long audio** (v1beta1).  
Provides two endpoints:

- `POST /tts/long/start` — starts a long synthesis operation
- `GET /tts/long/status?name=operations/XYZ` — polls operation status

## Deploy to Render

1. Create a **Web Service** on Render, link this repo/zip contents.
2. Build command: *(leave empty — Render will run `npm install`)*
3. Start command: `npm start`
4. Runtime: Node 20+
5. Environment variables:
   - `GOOGLE_CREDENTIALS` — **JSON string** for a service account with access to TTS.
   - `GCP_PROJECT_ID` — your project id.
   - `GCP_LOCATION` — region for TTS (e.g., `us-central1`).
   - Optional `PASS_THROUGH_AUTH=true` if you want to forward an Authorization header instead of using a service account.

## Usage

### Start synthesis
```bash
curl -X POST $HOST/tts/long/start \
  -H 'Content-Type: application/json' \
  -d '{
    "input": { "ssml": "<speak>Hello</speak>" },
    "voice": { "languageCode": "en-GB", "name": "en-GB-Wavenet-B" },
    "audioConfig": { "audioEncoding": "MP3", "speakingRate": 1.0 },
    "outputGcsUri": "gs://your-bucket/path/out.mp3"
  }'
```

Response includes an `name` like `projects/.../operations/123`.

### Check status
```bash
curl "$HOST/tts/long/status?name=projects/..../operations/123"
```

When `done: true` and `response` present, the file should be in the provided `gs://` path.

## Local dev

```bash
cp .env.example .env
npm install
npm start
```

## Notes

- Ensure the service account has `texttospeech.longAudioSynthesize` permission and write access to the target GCS bucket.
- If using `PASS_THROUGH_AUTH`, obtain a valid Google OAuth token from upstream and send `Authorization: Bearer <token>`.
