
import express from "express";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";
import _ from "lodash";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();

// ---- Clients ----
function makeGcpTtsClient() {
  // Prefer inline GOOGLE_CREDENTIALS; fall back to default ADC
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      return new TextToSpeechClient({ credentials: creds });
    } catch {}
  }
  return new TextToSpeechClient();
}

function makeGcsClient() {
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      return new Storage({ credentials: creds });
    } catch {}
  }
  return new Storage();
}

function makeR2Client() {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) return null;
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// ---- Helpers ----
function toSsmlChunks(plainText, maxLen = 3000) {
  // Ensure we wrap each chunk in <speak> ... </speak>
  // Split on paragraph-ish boundaries while keeping flow.
  const paras = String(plainText).replace(/\r\n/g, "\n").split(/\n{2,}/);
  const chunks = [];
  let buf = "";

  const push = () => {
    if (!buf.trim()) return;
    const content = buf.trim();
    chunks.push(`<speak>${content}</speak>`);
    buf = "";
  };

  for (const p of paras) {
    const part = p.trim();
    if (!part) continue;
    if ((buf + (buf ? " " : "") + part).length <= maxLen) {
      buf += (buf ? " " : "") + part;
    } else {
      // try sentence level split
      const sentences = part.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((buf + (buf ? " " : "") + s).length <= maxLen) {
          buf += (buf ? " " : "") + s;
        } else {
          push();
          if (s.length > maxLen) {
            // hard wrap if a single sentence is massive
            let i = 0;
            while (i < s.length) {
              const slice = s.slice(i, i + maxLen - 50);
              chunks.push(`<speak>${slice}</speak>`);
              i += maxLen - 50;
            }
          } else {
            buf = s;
          }
        }
      }
    }
    if (buf.length && buf.length + 25 < maxLen) buf += " <break time=\"600ms\"/>";
  }
  push();
  return chunks;
}

function approxBytesFromBase64(b64) {
  // MP3 base64 length approx -> bytes
  // 4 base64 chars ~ 3 bytes
  return Math.floor((b64.length * 3) / 4);
}

// ---- Route ----
router.post("/chunked", async (req, res) => {
  const {
    text,
    voice,
    audioConfig,
    concurrency = 3,
    returnBase64 = false,
    // Storage options
    GCS_BUCKET,
    R2_BUCKET,
    R2_PREFIX = "",
  } = req.body || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Provide 'text' string in body." });
  }

  const tts = makeGcpTtsClient();
  const gcs = makeGcsClient();
  const r2 = makeR2Client();

  // prefer env if not given in body
  const gcsBucket = GCS_BUCKET || process.env.GCS_BUCKET;
  const r2Bucket = R2_BUCKET || process.env.R2_BUCKET;
  const r2PublicBase = process.env.R2_PUBLIC_BASE_URL; // e.g. https://pub-xxxx.r2.dev

  try {
    const ssmlChunks = toSsmlChunks(text, 3000);
    const limit = pLimit(Math.max(1, Math.min(10, concurrency)));

    const results = await Promise.all(
      ssmlChunks.map((ssml, index) =>
        limit(async () => {
          const [resp] = await tts.synthesizeSpeech({
            input: { ssml },
            voice: voice || { languageCode: "en-GB", name: "en-GB-Wavenet-B" },
            audioConfig: audioConfig || { audioEncoding: "MP3", speakingRate: 1.0 },
          });
          const b64 = resp.audioContent?.toString("base64") || "";
          let url = null;

          if (!returnBase64) {
            const filename = `${(R2_PREFIX || "tts")}-${Date.now()}-${index
              .toString()
              .padStart(3, "0")}.mp3`;

            if (r2 && r2Bucket) {
              const put = new PutObjectCommand({
                Bucket: r2Bucket,
                Key: filename,
                Body: Buffer.from(b64, "base64"),
                ContentType: "audio/mpeg",
                ACL: undefined, // R2 ignores ACL when using public bucket policy
              });
              await r2.send(put);
              if (r2PublicBase) {
                url = `${r2PublicBase.replace(/\/+$/, "")}/${filename}`;
              }
            } else if (gcsBucket) {
              const file = gcs.bucket(gcsBucket).file(filename);
              await file.save(Buffer.from(b64, "base64"), { contentType: "audio/mpeg" });
              await file.makePublic().catch(() => {});
              url = `https://storage.googleapis.com/${gcsBucket}/${filename}`;
            }
          }

          return {
            index,
            ssml,
            bytesApprox: approxBytesFromBase64(b64),
            url,
            base64: returnBase64 ? b64 : undefined,
          };
        })
      )
    );

    results.sort((a, b) => a.index - b.index);

    return res.json({
      count: results.length,
      chunks: results.map(({ index, ssml, bytesApprox, url, base64 }) => ({
        index,
        ssml,
        bytesApprox,
        url,
        base64,
      })),
      summaryBytesApprox: _.sumBy(results, "bytesApprox"),
      storage: {
        r2: Boolean(r2 && (R2_BUCKET || process.env.R2_BUCKET)),
        gcs: Boolean(gcsBucket),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
