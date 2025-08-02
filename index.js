import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import longTtsRouter from "./routes/ttslong.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "podcast-tts-long-audio", version: "1.0.2" });
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Simple diagnostics endpoint
app.get("/diag", (_req, res) => {
  const credsRaw = process.env.GOOGLE_CREDENTIALS || "";
  let saEmail = null, saProject = null;
  try {
    const c = JSON.parse(credsRaw);
    saEmail = c.client_email || null;
    saProject = c.project_id || null;
  } catch {}
  res.json({
    ok: true,
    env: {
      hasGoogleCredentials: !!credsRaw,
      serviceAccountEmail: saEmail,
      serviceAccountProjectId: saProject,
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || null,
      GCP_LOCATION: process.env.GCP_LOCATION || null,
      PASS_THROUGH_AUTH: process.env.PASS_THROUGH_AUTH || "false"
    }
  });
});

app.use("/tts/long", longTtsRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[tts-long] listening on :${port}`);
});
