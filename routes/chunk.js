// Add this near the top with other imports
import qs from "qs";

// ... (keep all existing helper functions)

/* ---------------------------- core endpoint ---------------------------- */
router.post("/chunked", (req, res) => {
  try {
    // Get data from either JSON body or query string
    let payload = {};
    
    if (req.method === "POST" && req.body) {
      // If Content-Type is application/json, use the body directly
      if (req.headers["content-type"] === "application/json") {
        payload = req.body;
      } 
      // If form data, parse it
      else if (req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
        payload = qs.parse(req.body);
      }
      // For other cases, try to parse as JSON or use as-is
      else if (typeof req.body === "string") {
        try {
          payload = JSON.parse(req.body);
        } catch {
          payload = qs.parse(req.body);
        }
      } else {
        payload = req.body;
      }
    }
    
    // Also include query parameters (lower priority than body)
    payload = { ...req.query, ...payload };

    // Extract parameters with fallbacks
    const text = payload.text || "";
    const voice = typeof payload.voice === "string" ? tryParseJson(payload.voice) : payload.voice || {
      languageCode: payload.languageCode || "en-GB",
      name: payload.voiceName || payload.name || "en-GB-Wavenet-B"
    };
    
    const audioConfig = typeof payload.audioConfig === "string" ? tryParseJson(payload.audioConfig) : payload.audioConfig || {
      audioEncoding: payload.audioEncoding || "MP3",
      speakingRate: parseFloat(payload.speakingRate) || 1.0
    };
    
    const concurrency = parseInt(payload.concurrency) || 3;
    const R2_BUCKET = payload.R2_BUCKET || process.env.R2_BUCKET;
    const R2_PREFIX = payload.R2_PREFIX || "raw-" + new Date().toISOString().split("T")[0];
    const returnBase64 = payload.returnBase64 === "true" || payload.returnBase64 === true;

    // Validate required fields
    if (!text) {
      return res.status(400).json({ error: "Missing required field: text" });
    }

    // Process the text into chunks (using your existing logic)
    const chunks = splitIntoChunks(text); // You'll need to implement this or use existing logic
    
    // Generate response
    const response = {
      count: chunks.length,
      chunks: chunks.map((chunk, index) => ({
        index,
        bytesApprox: chunk.length * 2, // Example approximation
        url: returnBase64 ? null : `https://example.com/${R2_PREFIX}-${index.toString().padStart(3, "0")}.mp3`,
        base64: returnBase64 ? Buffer.from(chunk).toString("base64") : null
      })),
      summaryBytesApprox: chunks.reduce((sum, chunk) => sum + chunk.length * 2, 0)
    };

    res.json(response);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ... (keep the rest of the file)// Unicode punctuation → ASCII, remove invisibles, collapse spacing
function normalizeUnicodePunctuation(s) {
  return String(s ?? "")
    // spaces & invisibles
    .replace(/\u00A0/g, " ")  // NBSP
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width/BOM
    // quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // dashes
    .replace(/[\u2013\u2014\u2212]/g, "-")
    // ellipsis
    .replace(/\u2026/g, "...")
    // tidy spaces around punctuation
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1");
}

// Optionally force ASCII (strip diacritics/emojis)
const toASCII = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .replace(/[^\x00-\x7F]/g, "");   // anything non-ASCII

// FINAL strict cleaner for TTS makers
function strictClean(text, { ascii = false, join = "space" } = {}) {
  let t = unescapeCommon(text);
  t = normalizeUnicodePunctuation(t);
  // collapse “A I”, “A  I”
  t = t.replace(/\bA\s+I\b/g, "AI");
  // collapse multiple spaces
  t = t.replace(/\s+/g, " ").trim();
  if (ascii) t = toASCII(t);
  // join mode already by this point is single-space; nothing else to do
  return t;
}

/* ---------------------------- normalisers ---------------------------- */
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

/* --------------------------- core composition --------------------------- */
function buildOutputs(body = {}, q = {}) {
  const name = (body.name || q.name || "en-GB-Wavenet-B").toString();
  const r2Prefix = (body.r2Prefix || q.r2Prefix || "podcast").toString();

  // intro/outro
  let intro = "";
  if (body.intro) intro = normalizeSpeak(body.intro);
  else if (body.textIntro) intro = normalizeSpeak(body.textIntro);
  else if (q.intro) intro = normalizeSpeak(q.intro);

  let outro = "";
  if (body.outro) outro = normalizeSpeak(body.outro);
  else if (body.textOutro) outro = normalizeSpeak(body.textOutro);
  else if (q.outro) outro = normalizeSpeak(q.outro);

  // main
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

  // SSML merged
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

  // plain text (continuous line)
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

    // If caller wants the strict-processed text inside JSON too:
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
/** Returns raw text/plain with strict final parsing when requested.
 *  Query:
 *    - strict=1  -> run strictClean (recommended for TTS maker)
 *    - ascii=1   -> force ASCII after strictClean
 */
router.post("/plain", (req, res) => {
  try {
    let body = typeof req.body === "undefined" ? {} : req.body;
    if (typeof body === "string") {
      const parsed = tryParseJson(body);
      if (parsed && typeof parsed === "object") body = parsed;
      else body = {}; // allow query-only
    }
    const out = buildOutputs(body, req.query || {});
    if (out.error) return res.status(400).type("text/plain; charset=utf-8").send(out.error);

    const strict = String((req.query.strict ?? "")).toLowerCase() === "1";
    const ascii = String((req.query.ascii ?? "")).toLowerCase() === "1";
    const text = strict ? strictClean(out.text, { ascii, join: "space" }) : out.text;

    res.type("text/plain; charset=utf-8").send(text); // ← pure text, continuous line
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





// ---- Route ----
    // storage












export default router;
