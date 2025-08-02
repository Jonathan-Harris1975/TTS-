# tts-chunker-service

Small Express service that splits long text into SSML-safe chunks and calls **Google TTS v1** for each chunk.
Outputs either **R2 URLs**, **GCS URLs**, or base64 depending on configuration.

## Deploy (Render)

1. Create a Web Service (Node 20+).
2. Build command: `npm install`
3. Start command: `npm start`
4. Add environment variables:
   - For Google: either `GOOGLE_APPLICATION_CREDENTIALS` (path to mounted secret) **or** `GOOGLE_CREDENTIALS` (inline JSON).
   - For R2 (preferred): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
   - Optional: `GCS_BUCKET` as fallback.

## Endpoint

`POST /tts/chunked`

Body:
```json
{
  "text": "long script ...",
  "voice": { "languageCode": "en-GB", "name": "en-GB-Wavenet-B" },
  "audioConfig": { "audioEncoding": "MP3", "speakingRate": 1.0 },
  "concurrency": 3,
  "R2_BUCKET": "podcast-tt",
  "R2_PREFIX": "raw-2025-08-02"
}
```

Response:
```json
{
  "count": 3,
  "chunks": [
    {"index":0,"bytesApprox":12345,"url":"https://pub-.../raw-2025-08-02-000.mp3"},
    ...
  ],
  "summaryBytesApprox": 45678
}
```

If neither R2 nor GCS are configured, set `"returnBase64": true` to receive `base64` fields instead of URLs.