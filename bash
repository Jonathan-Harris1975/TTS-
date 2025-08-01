# create folder and enter it
mkdir -p tts-long-audio && cd tts-long-audio

# package.json
cat > package.json <<'JSON'
{
  "name": "tts-long-audio",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "engines": { "node": ">=20" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "google-auth-library": "^9.14.1",
    "node-fetch": "^3.3.2"
  }
}
JSON

# index.js
cat > index.js <<'JS'
import express from "express";
import dotenv from "dotenv";
import composeRouter from "./routes/compose.js";
import ttsLongRouter from "./routes/ttsLong.js";

dotenv.config();
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req, res) => res.json({ ok: true, service: "TTS long audio API" }));

app.use("/compose", composeRouter);
app.use("/tts/long", ttsLongRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
JS

# routes/compose.js
mkdir -p routes
cat > routes/compose.js <<'JS'
import express from "express";
const router = express.Router();

const oneLine = s => String(s || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
const ensureSpeak = s => {
  const t = oneLine(s);
  return /^<speak>[\s\S]*<\/speak>$/.test(t) ? t : `<speak>${t}</speak>`;
};
const unwrap = s => oneLine(s).replace(/^<speak>/, "").replace(/<\/speak>$/, "");

function coerce(val) {
  if (val == null) return "";
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const t = val.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try { return JSON.parse(t); } catch {}
    }
    return val;
  }
  return val;
}

function normaliseToSingle(input) {
  const v = coerce(input);
  if (Array.isArray(v)) {
    const bodies = v
      .map(x => typeof x === "string" ? x : String(x))
      .map(x => /<speak>[\s\S]*<\/speak>/.test(x) ? unwrap(x) : oneLine(x))
      .filter(Boolean);
    return ensureSpeak(bodies.join(' <break time="700ms"/> '));
  }
  if (typeof v === "object" && v && Array.isArray(v.chunks)) return normaliseToSingle(v.chunks);
  if (typeof v === "string") return ensureSpeak(v);
  return "";
}

/**
 * POST /compose
 * Body: intro, main (or mainChunks), outro, optional name (voice)
 * Returns: merged SSML + TTS-ready payloads
 */
router.post("/", express.text({ type: "*/*", limit: "1mb" }), (req, res) => {
  try {
    let payload = {};
    if (req.is("application/json") && typeof req.body === "object") {
      payload = req.body;
    } else if (typeof req.body === "string" && req.body.trim()) {
      try { payload = JSON.parse(req.body); } catch {}
    }
    if (!Object.keys(payload).length) payload = { ...req.query };

    const intro = payload.intro;
    const mainInput = payload.main ?? payload.mainChunks;
    const outro = payload.outro;
    const voiceName = payload.name || "en-GB-Wavenet-B";

    if (!intro || !mainInput || !outro) {
      return res.status(400).json({ error: "Provide intro, main (or mainChunks), and outro. Optional: name (voice)." });
    }

    const merged = [
      unwrap(normaliseToSingle(intro)),
      '<break time="700ms"/>',
      unwrap(normaliseToSingle(mainInput)),
      '<break time="700ms"/>',
      unwrap(normaliseToSingle(outro))
    ].join(" ");

    const ssml = ensureSpeak(merged);

    const tts = {
      input: { ssml },
      voice: { languageCode: "en-GB", name: voiceName, ssmlGender: "MALE" },
      audioConfig: { audioEncoding: "MP3" }
    };

    return res.json({
      ssml,
      tts,
      "TTS output complete": tts,
      "TTS output complete (string)": JSON.stringify(tts)
    });
  } catch (err) {
    console.error("Compose failed:", err);
    return res.status(500).json({ error: "Compose error", details: err.message });
  }
});

export default router;
JS

# routes/ttsLong.js
cat > routes/ttsLong.js <<'JS'
import express from "express";
import fetch from "node-fetch";
import { getGoogleToken } from "../services/auth.js";

const router = express.Router();

/**
 * POST /tts/long/start
 * Body: { tts, outputGcsUri, projectNumber?, passThroughAuth? }
 */
router.post("/start", async (req, res) => {
  try {
    const { tts, outputGcsUri, projectNumber, passThroughAuth } = req.body || {};
    if (!tts || !outputGcsUri) return res.status(400).json({ error: "tts and outputGcsUri are required" });

    const projectNum = String(projectNumber || process.env.PROJECT_NUMBER || "").trim();
    if (!projectNum) return res.status(400).json({ error: "projectNumber missing" });

    const token = await getGoogleToken({ passThroughAuth, req });
    const url = `https://texttospeech.googleapis.com/v1beta1/projects/${projectNum}/locations/global:synthesizeLongAudio`;
    const body = { ...tts, outputGcsUri };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : 400).json(data);
  } catch (err) {
    console.error("start long tts error:", err);
    return res.status(500).json({ error: "start long tts error", details: err.message });
  }
});

/** GET /tts/long/status?name=projects/.../operations/... */
router.get("/status", async (req, res) => {
  try {
    const { name, passThroughAuth } = req.query || {};
    if (!name) return res.status(400).json({ error: "operation name is required" });

    const token = await getGoogleToken({ passThroughAuth, req });
    const url = `https://texttospeech.googleapis.com/v1beta1/${name}`;
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
    const data = await r.json();
    return res.status(r.ok ? 200 : 400).json(data);
  } catch (err) {
    console.error("status long tts error:", err);
    return res.status(500).json({ error: "status long tts error", details: err.message });
  }
});

export default router;
JS

# services/auth.js
mkdir -p services
cat > services/auth.js <<'JS'
import { GoogleAuth } from "google-auth-library";

export async function getGoogleToken({ passThroughAuth, req }) {
  if (passThroughAuth && req.headers.authorization) {
    const [scheme, token] = (req.headers.authorization || "").split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) return token;
  }
  const credentials = process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : undefined;
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}
JS

# .env.example
cat > .env.example <<'ENV'
PORT=3000
PROJECT_NUMBER=974776487386
# Paste the single-line service account JSON below (keep \n in the private_key):
GOOGLE_CREDENTIALS={"type":"service_account","project_id":"YOUR_PROJECT_ID","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...snip...\n-----END PRIVATE KEY-----\n","client_email":"your-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/your-sa%40YOUR_PROJECT_ID.iam.gserviceaccount.com"}
ENV

# README.md
cat > README.md <<'MD'
# Podcast TTS Long Audio API

Express API to stitch SSML and synthesize **long audio** via Google Text-to-Speech v1beta1 (writes to GCS).

## Routes

### POST /compose
Body:
```json
{ "intro":"<speak>…</speak>", "main":"<speak>…</speak>", "outro":"<speak>…</speak>", "name":"en-GB-Wavenet-B" }
