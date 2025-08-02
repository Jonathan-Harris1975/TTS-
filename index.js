import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import longTtsRouter from "./routes/ttslong.js";

dotenv.config();
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

app.get("/", (_req, res) => res.json({ ok: true, service: "podcast-tts-long-audio", version: "1.0.3" }));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// simple diag
app.get("/diag", (_req, res) => {
  const credsSet = !!process.env.GOOGLE_CREDENTIALS;
  let saEmail = null, saProjectId = null;
  try {
    if (credsSet) {
      const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      saEmail = c.client_email || null;
      saProjectId = c.project_id || null;
    }
  } catch {}
  res.json({
    hasGoogleCredentials: credsSet,
    serviceAccountEmail: saEmail,
    serviceAccountProjectId: saProjectId,
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || null,
    GCP_LOCATION: process.env.GCP_LOCATION || null
  });
});

app.use("/tts/long", longTtsRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[tts-long] listening on :${port}`));
