import express from "express";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";

const router = express.Router();

// Helper to obtain a Google OAuth token either via a service account JSON
// (provided in env GOOGLE_CREDENTIALS) or pass-through Authorization: Bearer <token>
async function getGoogleToken(passThroughAuth, req) {
  if (passThroughAuth && req.headers.authorization) {
    const parts = req.headers.authorization.split(" ");
    if (parts[0].toLowerCase() === "bearer" && parts[1]) return parts[1];
  }
  const auth = new GoogleAuth({
    credentials: process.env.GOOGLE_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
      : undefined,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/**
 * Start a long audio synthesis operation.
 * POST /tts/long/start
 * Body:
 * {
 *   "input": { "text": "..."} or { "ssml": "..." },
 *   "voice": { "languageCode": "en-GB", "name": "en-GB-Wavenet-B" },
 *   "audioConfig": { "audioEncoding": "MP3", "speakingRate": 1.0 },
 *   "outputGcsUri": "gs://bucket/path/output.mp3"
 * }
 * Optional: projectId, location (defaults env GCP_PROJECT_ID / GCP_LOCATION)
 */
router.post("/start", async (req, res) => {
  try {
    const {
      input,
      voice,
      audioConfig,
      outputGcsUri,
      projectId,
      location,
    } = req.body || {};

    if (!input || !audioConfig || !outputGcsUri) {
      return res.status(400).json({ error: "input, audioConfig, and outputGcsUri are required" });
    }

    const proj = projectId || process.env.GCP_PROJECT_ID;
    const loc  = location  || process.env.GCP_LOCATION || "us-central1";
    if (!proj) return res.status(400).json({ error: "projectId missing (body or env GCP_PROJECT_ID)" });

    const name = `projects/${proj}/locations/${loc}:longAudioSynthesize`;
    const token = await getGoogleToken(process.env.PASS_THROUGH_AUTH === "true", req);

    const body = { input, voice, audioConfig, outputGcsUri };
    const endpoint = `https://texttospeech.googleapis.com/v1beta1/${name}`;

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    const statusCode = r.ok ? 200 : r.status || 400;
    res.status(statusCode).json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Poll an operation by its name returned from /start
 * GET /tts/long/status?name=projects/123/locations/us-central1/operations/456
 */
router.get("/status", async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "name query param required" });
    const token = await getGoogleToken(process.env.PASS_THROUGH_AUTH === "true", req);
    const endpoint = `https://texttospeech.googleapis.com/v1beta1/${name}`;
    const r = await fetch(endpoint, { headers: { "Authorization": `Bearer ${token}` } });
    const data = await r.json();
    const statusCode = r.ok ? 200 : r.status || 400;
    res.status(statusCode).json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
