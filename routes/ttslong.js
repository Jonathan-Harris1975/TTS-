import express from "express";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";

const router = express.Router();

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

router.post("/start", async (req, res) => {
  try {
    const { input, voice, audioConfig, outputGcsUri, projectId, location } = req.body || {};
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

    console.log("[tts-long/start] request", { name, outputGcsUri, hasToken: !!token });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    try {
      const json = JSON.parse(text);
      if (!r.ok) console.error("[tts-long/start] Google error:", json);
      return res.status(r.ok ? 200 : r.status || 400).json(json);
    } catch {
      console.error("[tts-long/start] Non-JSON response:", text);
      return res.status(r.status || 500).send(text);
    }
  } catch (err) {
    console.error("[tts-long/start] exception:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/status", async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "name query param required" });
    const token = await getGoogleToken(process.env.PASS_THROUGH_AUTH === "true", req);
    const endpoint = `https://texttospeech.googleapis.com/v1beta1/${name}`;
    console.log("[tts-long/status] fetch", { name, hasToken: !!token });
    const r = await fetch(endpoint, { headers: { "Authorization": `Bearer ${token}` } });
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      if (!r.ok) console.error("[tts-long/status] Google error:", json);
      return res.status(r.ok ? 200 : r.status || 400).json(json);
    } catch {
      console.error("[tts-long/status] Non-JSON response:", text);
      return res.status(r.status || 500).send(text);
    }
  } catch (err) {
    console.error("[tts-long/status] exception:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
