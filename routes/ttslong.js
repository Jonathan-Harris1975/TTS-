import express from "express";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";

const router = express.Router();

// Get Google OAuth token from service account or pass-through header
async function getGoogleToken(passThroughAuth, req) {
  if (passThroughAuth && req.headers.authorization) {
    return req.headers.authorization.split(" ")[1];
  }

  const auth = new GoogleAuth({
    credentials: process.env.GOOGLE_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
      : undefined,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

/**
 * POST /tts/long/start
 * Body: { tts: {...}, outputGcsUri: "gs://bucket/file.mp3", projectNumber?: "...", passThroughAuth?: true }
 */
router.post("/start", async (req, res) => {
  try {
    const { tts, outputGcsUri, projectNumber, passThroughAuth } = req.body;
    if (!tts || !outputGcsUri) {
      return res.status(400).json({ error: "tts and outputGcsUri are required" });
    }

    const projectNum = projectNumber || process.env.PROJECT_NUMBER;
    if (!projectNum) {
      return res.status(400).json({ error: "projectNumber missing" });
    }

    const token = await getGoogleToken(passThroughAuth, req);

    const endpoint = `https://texttospeech.googleapis.com/v1beta1/projects/${projectNum}/locations/global:synthesizeLongAudio`;
    const body = { ...tts, outputGcsUri };

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    res.status(r.ok ? 200 : 400).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /tts/long/status?name=projects/.../operations/...
 */
router.get("/status", async (req, res) => {
  try {
    const { name, passThroughAuth } = req.query;
    if (!name) {
      return res.status(400).json({ error: "operation name is required" });
    }

    const token = await getGoogleToken(passThroughAuth, req);
    const endpoint = `https://texttospeech.googleapis.com/v1beta1/${name}`;

    const r = await fetch(endpoint, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 400).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
