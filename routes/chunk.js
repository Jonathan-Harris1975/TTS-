import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import qs from "qs";

const router = express.Router();

/* ------------------------------ helpers ------------------------------ */
const oneLine = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
const looksLikeSSML = (s) => /<speak[\s>]/i.test(String(s || ""));
const wrapSpeak = (s) => (looksLikeSSML(s) ? oneLine(s) : `<speak>${oneLine(s)}</speak>`);
const stripLabelPrefix = (s) => String(s || "").replace(/^\s*(intro|main|outro)\s*:\s*/i, "");
const stripSpeak = (s) =>
  String(s ?? "").replace(/^\s*<speak[^>]*>/i, "").replace(/<\/speak>\s*$/i, "");

// SSML -> plain (fix "A I" → "AI", drop tags)
const ssmlToPlain = (s) => {
  let t = String(s ?? "");
  t = stripSpeak(t);
  t = t.replace(/<\s*say-as\b[^>]*>([\s\S]*?)<\/\s*say-as\s*>/gi, (_, inner) =>
    String(inner).replace(/\s+/g, "")
  );
  t = t.replace(/<\s*break\b[^>]*>/gi, " ");
  t = t.replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
};

const unescapeCommon = (s) =>
  String(s ?? "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\r/g, " ");

function normalizeUnicodePunctuation(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
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
