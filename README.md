# tts-chunker-service

Render-ready Node service that splits long text into SSML chunks (<= ~4400 chars) and synthesizes each chunk using the **standard Google TTS v1** API. No long-audio needed.

## Endpoints

### POST /tts/chunked
Request body:
```json
{
  "text": "Very long text ...",
  "voice": { "languageCode": "en-GB", "name": "en-GB-Wavenet-B" },
  "audioConfig": { "audioEncoding": "MP3", "speakingRate": 1.0 },
  "bucket": "podcast-tt",
  "prefix": "tts-tests/output-20250802-",
  "concurrency": 3,
  "returnBase64": false
}
```
Response:
```json
{
  "count": 5,
  "chunks": [
    {"index":0, "gcsUri":"gs://podcast-tt/tts-tests/output-20250802-000.mp3"},
    ...
  ]
}
```

- If `bucket` is omitted, it returns `base64` audio if `returnBase64: true`.
- Service account must have TTS + Storage write on the bucket.

## Deploy (Render)
- Build: `npm install`
- Start: `npm start`
- Node: 20+
- Env:
  - `GOOGLE_CREDENTIALS` = service account JSON string (or use `GOOGLE_APPLICATION_CREDENTIALS` file path)
- Optional:
  - `PORT`

## Notes
- Chunker respects paragraph/sentence boundaries where possible.
- Each chunk is wrapped with `<speak> ... </speak>` and inserts a small `<break>` between paragraphs.
- For final merging, use your existing merge service, or any ffmpeg join on the produced MP3s.
