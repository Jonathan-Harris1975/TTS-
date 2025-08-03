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
      .
