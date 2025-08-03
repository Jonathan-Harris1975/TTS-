// Add these imports at the top
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Storage } from '@google-cloud/storage';
import { Upload } from '@aws-sdk/lib-storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { PassThrough } from 'stream';

// Add after the R2 config section
// Google TTS client initialization
const ttsClient = new TextToSpeechClient();

// Storage clients initialization
let gcsClient = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS) {
  gcsClient = new Storage();
}

// Add these helper functions
async function synthesizeSpeech(text, voice, audioConfig) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { ssml: text },
    voice,
    audioConfig
  });
  return response.audioContent;
}

async function uploadToR2(buffer, key, bucket) {
  const client = getR2Client();
  if (!client) throw new Error('R2 client not configured');
  
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg'
    }
  });
  
  await upload.done();
  return key;
}

async function uploadToGCS(buffer, key, bucket) {
  if (!gcsClient) throw new Error('GCS client not configured');
  
  const file = gcsClient.bucket(bucket).file(key);
  await file.save(buffer, { contentType: 'audio/mpeg' });
  return key;
}

// Add the main TTS endpoint
router.post('/chunked', async (req, res) => {
  try {
    const {
      text,
      voice = { languageCode: 'en-GB', name: 'en-GB-Wavenet-B' },
      audioConfig = { audioEncoding: 'MP3', speakingRate: 1.0 },
      concurrency = 3,
      R2_BUCKET = process.env.R2_BUCKET,
      R2_PREFIX = 'raw-' + new Date().toISOString().split('T')[0],
      returnBase64 = false
    } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Normalize and chunk the text
    const out = buildOutputs({ text }, {});
    if (out.error) return res.status(400).json({ error: out.error });

    const ssmlChunks = out.normalized.main.chunks;
    if (!ssmlChunks.length) {
      return res.status(400).json({ error: 'No valid text chunks found' });
    }

    // Process chunks
    const results = [];
    for (let i = 0; i < ssmlChunks.length; i++) {
      const chunk = ssmlChunks[i];
      const audioContent = await synthesizeSpeech(chunk, voice, audioConfig);
      
      let url, base64;
      if (returnBase64) {
        base64 = audioContent.toString('base64');
      } else {
        const key = `${R2_PREFIX}-${String(i).padStart(3, '0')}.mp3`;
        if (R2_BUCKET) {
          await uploadToR2(audioContent, key, R2_BUCKET);
          url = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
        } else if (process.env.GCS_BUCKET) {
          await uploadToGCS(audioContent, key, process.env.GCS_BUCKET);
          url = `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${key}`;
        } else {
          base64 = audioContent.toString('base64');
        }
      }
      
      results.push({
        index: i,
        bytesApprox: audioContent.length,
        url,
        base64
      });
    }

    res.json({
      count: results.length,
      chunks: results,
      });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1");
}

const toASCII = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");

function strictClean(text, { ascii = false, join = "space" } = {}) {
  let t = unescapeCommon(text);
  t = normalizeUnicodePunctuation(t);
  t = t.replace(/\bA\s+I\b/g, "AI");
  t = t.replace(/\s+/g, " ").trim();
  if (ascii) t = toASCII(t);
  return t;
}

function normalizeSpeak(input) {
  if (input == null) return "";
  return wrapSpeak(stripLabelPrefix(input));
}

function normalizeMain(input) {
  if (input == null) return { chunks: [] };
  if (typeof input === "string") return { chunks: [normalizeSpeak(input)] };
  if (Array.isArray(input)) return { chunks: input.map(normalizeSpeak) };
  if (typeof input === "object" && Array.isArray(input.chunks)) return { chunks: input.chunks.map(normalizeSpeak) };
  if (typeof input === "object" && typeof input.text === "string") return { chunks: [normalizeSpeak(input.text)] };
  return { chunks: [] };
}

const tryParseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* ---------------------------- core composition --------------------------- */
function buildOutputs(body = {}, q = {}) {
  const name = (body.name || q.name || "en-GB-Wavenet-B").toString();
  const r2Prefix = (body.r2Prefix || q.r2Prefix || "podcast").toString();

  let intro = "";
  if (body.intro) intro = normalizeSpeak(body.intro);
  else if (body.textIntro) intro = normalizeSpeak(body.textIntro);
  else if (q.intro) intro = normalizeSpeak(q.intro);

  let outro = "";
  if (body.outro) outro = normalizeSpeak(body.outro);
  else if (body.textOutro) outro = normalizeSpeak(body.textOutro);
  else if (q.outro) outro = normalizeSpeak(q.outro);

  let mainNorm = normalizeMain(body.main ?? body.textMain ?? body.text);
  if (!mainNorm.chunks.length) {
    const chunkKeys = Object.keys(q)
      .filter((k) => /^mainChunk\d+$/i.test(k))
      .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));
    if (chunkKeys.length) mainNorm = { chunks: chunkKeys.map((k) => normalizeSpeak(q[k])) };
    else if (q.main) mainNorm = normalizeMain(q.main);
  }

  if (!intro && !outro && mainNorm.chunks.length === 0) {
    return { error: "Provide at least one of: intro, main (string/array/{chunks}), or outro." };
  }

  const mainBodies = mainNorm.chunks.map((c) => oneLine(stripSpeak(c)));
  const mergedMain = mainBodies.length
    ? `<speak>${oneLine(mainBodies.join(' <break time="700ms"/> '))}</speak>`
    : "";

  const parts = [];
  if (intro) parts.push(oneLine(stripSpeak(intro)));
  if (mergedMain) parts.push(oneLine(stripSpeak(mergedMain)));
  if (outro) parts.push(oneLine(stripSpeak(outro)));
  const mergedEpisode = parts.length
    ? `<speak>${oneLine(parts.join(' <break time="700ms"/> '))}</speak>`
    : "";

  const introText = intro ? ssmlToPlain(intro) : "";
  const mainBodiesText = mainNorm.chunks.map((c) => ssmlToPlain(c));
  const outroText = outro ? ssmlToPlain(outro) : "";
  const text = [introText, ...mainBodiesText, outroText].filter(Boolean).join(" ");

  return {
    name, r2Prefix,
    normalized: { intro, main: { chunks: mainNorm.chunks }, main_merged: mergedMain, outro },
    ssml: mergedEpisode || mergedMain || intro || outro,
    text
  };
}

/* ------------------------------ JSON route ------------------------------ */
router.post("/ready-for-tts", (req, res) => {
  try {
    let body = typeof req.body === "undefined" ? {} : req.body;
    if (typeof body === "string") {
      const parsed = tryParseJson(body);
      if (parsed && typeof parsed === "object") body = parsed;
      else return res.status(400).json({ error: "Body must be JSON or form data. Set Content-Type: application/json." });
    }
    if (typeof body !== "object" || body === null) {
      return res.status(400).json({ error: "Body must be a JSON object or form fields." });
    }

    const out = buildOutputs(body, req.query || {});
    if (out.error) return res.status(400).json({ error: out.error });

    const strict = String((req.query.strict ?? "")).toLowerCase() === "1";
    const ascii = String((req.query.ascii ?? "")).toLowerCase() === "1";
    const textClean = strict ? strictClean(out.text, { ascii, join: "space" }) : out.text;

    return res.json({
      voice: { languageCode: "en-GB", name: out.name },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 },
      R2_PREFIX: out.r2Prefix,
      normalized: out.normalized,
      ssml: out.ssml,
      text: textClean
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

/* --------------------------- PURE TEXT route --------------------------- */
router.post("/plain", (req, res) => {
  try {
    let body = typeof req.body === "undefined" ? {} : req.body;
    if (typeof body === "string") {
      const parsed = tryParseJson(body);
      if (parsed && typeof parsed === "object") body = parsed;
      else body = {};
    }
    const out = buildOutputs(body, req.query || {});
    if (out.error) return res.status(400).type("text/plain; charset=utf-8").send(out.error);

    const strict = String((req.query.strict ?? "")).toLowerCase() === "1";
    const ascii = String((req.query.ascii ?? "")).toLowerCase() === "1";
    const text = strict ? strictClean(out.text, { ascii, join: "space" }) : out.text;

    res.type("text/plain; charset=utf-8").send(text);
  } catch (e) {
    res.status(500).type("text/plain; charset=utf-8").send(String(e?.message || e));
  }
});

// R2 config
const {
  R2_ACCESS_KEY_ID,
  R2_ACCESS_KEY,
  R2_SECRET_ACCESS_KEY,
  R2_SECRET_KEY,
  R2_ENDPOINT
} = process.env;

function getR2Client() {
  const accessKeyId = R2_ACCESS_KEY_ID || R2_ACCESS_KEY;
  const secretAccessKey = R2_SECRET_ACCESS_KEY || R2_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey || !R2_ENDPOINT) return null;

  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export default router;
