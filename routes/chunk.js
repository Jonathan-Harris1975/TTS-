// routes/chunk.js — JSON + pure text endpoints with strict final parser for TTS
import express from "express";
import qs from "qs";
import { S3Client } from "@aws-sdk/client-s3";

const router = express.Router();

/* ------------------------------ helpers ------------------------------ */
const oneLine = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
const looksLikeSSML = (s) => /<speak[\s>]/i.test(String(s || ""));
const wrapSpeak = (s) => (looksLikeSSML(s) ? oneLine(s) : `<speak>${oneLine(s)}</speak>`);
const stripLabelPrefix = (s) => String(s || "").replace(/^\s*(intro|main|outro)\s*:\s*/i, "");
const stripSpeak = (s) =>
  String(s ?? "").replace(/^\s*<speak[^>]*>/i, "").replace(/<\/speak>\s*$/i, "");

// ... (keep all other existing helper functions)

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

// ... (keep the rest of the existing file)

export default router;
