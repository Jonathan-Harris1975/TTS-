import express from "express";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";
import _ from "lodash";

const router = express.Router();

// create clients using GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CREDENTIALS env
function createClients() {
  // If GOOGLE_CREDENTIALS is a JSON string, use it inline.
  let clientOpts = undefined;
  if (process.env.GOOGLE_CREDENTIALS) {
    try { clientOpts = { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS) }; }
    catch {}
  }
  const tts = new TextToSpeechClient(clientOpts);
  const storage = new Storage(clientOpts);
  return { tts, storage };
}

// naive sentence split preserving paragraphs
function splitIntoChunks(text, maxLen=4400) {
  const cleaned = text.replace(/\r/g, "").replace(/\t/g, " ").replace(/ +/g, " ").trim();
  const paras = cleaned.split(/\n\s*\n/);
  const chunks = [];
  let buf = "";

  const pushBuf = () => {
    if (!buf.trim()) return;
    const ssml = `<speak>${buf.trim()}</speak>`;
    chunks.push(ssml);
    buf = "";
  };

  for (const p of paras) {
    const sentences = p.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const candidate = (buf ? buf + " " : "") + s;
      // leave headroom for <speak> and tags
      if (candidate.length + 14 > maxLen) {
        pushBuf();
        if (s.length + 14 > maxLen) {
          // very long sentence – hard split
          let i = 0;
          while (i < s.length) {
            const slice = s.slice(i, i + (maxLen - 14 - 1));
            chunks.push(`<speak>${slice}</speak>`);
            i += (maxLen - 14 - 1);
          }
        } else {
          buf = s;
        }
      } else {
        buf = candidate;
      }
    }
    // paragraph boundary -> prefer break
    if (buf.length && buf.length + 25 < maxLen) buf += " <break time=\"600ms\"/>";
  }
  pushBuf();
  return chunks;
}

/**
 * POST /tts/chunked
 * Body: { text: string, voice?: {languageCode, name}, audioConfig?: {...},
 *         bucket?: "podcast-tt", prefix?: "tts-tests/out-", concurrency?: 3, returnBase64?: false }
 */
router.post("/chunked", async (req, res) => {
  try {
    const { text, voice, audioConfig, bucket, prefix, concurrency=3, returnBase64=false, projectId, location } = req.body || {};
    if (!text) return res.status(400).json({ error: "text is required" });
    const chunks = splitIntoChunks(text, 4400);
    const { tts, storage } = createClients();

    const chosenVoice = voice || { languageCode: "en-GB", name: "en-GB-Wavenet-B" };
    const cfg = Object.assign({ audioEncoding: "MP3", speakingRate: 1.0 }, audioConfig || {});

    const limit = pLimit(Math.max(1, Math.min(8, concurrency)));
    const ops = chunks.map((ssml, i) => limit(async () => {
      const [resp] = await tts.synthesizeSpeech({ input: { ssml }, voice: chosenVoice, audioConfig: cfg });
      const audio = resp.audioContent;
      let gcsUri = null;
      if (bucket) {
        const b = storage.bucket(bucket);
        const file = b.file(`${prefix || "tts-chunks/chunk-"}${String(i).padStart(3, "0")}.mp3`);
        await file.save(Buffer.from(audio, "base64"), { contentType: "audio/mpeg" });
        gcsUri = `gs://${bucket}/${file.name}`;
      }
      return { index: i, ssml, bytes: audio.length * 0.75, gcsUri, base64: returnBase64 ? audio : undefined };
    }));

    const results = await Promise.all(ops);
    results.sort((a, b) => a.index - b.index);
    res.json({ count: results.length, chunks: results.map(({index, gcsUri}) => ({ index, gcsUri })), returnBase64, summaryBytesApprox: _.sumBy(results, "bytes") });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
