import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";

const router = express.Router();

// --- Configuration ---
const {
  // R2 Configuration
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY, 
  R2_ENDPOINT,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  
  // Google Cloud Configuration
  GOOGLE_APPLICATION_CREDENTIALS,
  GOOGLE_CREDENTIALS,
  GCS_BUCKET
} = process.env;

// --- Helper Functions ---
const safeParseJson = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

const normalizeText = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isSSML = (text) => /<speak[\s>]/i.test(text || "");

const wrapSSML = (text) => {
  const cleaned = normalizeText(text);
  return isSSML(cleaned) ? cleaned : `<speak>${cleaned}</speak>`;
};

// --- Client Initialization ---
const ttsClient = new TextToSpeechClient(
  GOOGLE_CREDENTIALS ? { credentials: safeParseJson(GOOGLE_CREDENTIALS) } : {}
);

const r2Client = R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    })
  : null;

const gcsClient = GCS_BUCKET ? new Storage() : null;

// --- Core Functions ---
async function synthesizeChunk(text, voice, audioConfig) {
  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: wrapSSML(text) },
      voice: {
        languageCode: voice?.languageCode || "en-GB",
        name: voice?.name || "en-GB-Wavenet-B"
      },
      audioConfig: {
        audioEncoding: audioConfig?.audioEncoding || "MP3",
        speakingRate: audioConfig?.speakingRate || 1.0,
        ...audioConfig
      }
    });
    return response.audioContent;
  } catch (error) {
    console.error("TTS Synthesis Error:", error);
    throw new Error("Failed to synthesize speech");
  }
}

async function uploadAudio(buffer, filename) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `audio-${timestamp}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  
  try {
    // Try R2 first
    if (r2Client && R2_BUCKET) {
      await new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: "audio/mpeg"
        }
      }).done();
      return `${R2_PUBLIC_BASE_URL}/${key}`;
    }
    
    // Fallback to GCS
    if (gcsClient && GCS_BUCKET) {
      const file = gcsClient.bucket(GCS_BUCKET).file(key);
      await file.save(buffer, { contentType: "audio/mpeg" });
      return `https://storage.googleapis.com/${GCS_BUCKET}/${key}`;
    }
    
    // Fallback to base64
    return {
      base64: buffer.toString("base64"),
      message: "No storage configured - returned as base64"
    };
  } catch (error) {
    console.error("Upload Error:", error);
    throw new Error("Failed to upload audio");
  }
}

// --- API Endpoints ---
router.post("/chunked", async (req, res) => {
  try {
    // Parse input from either query params or body
    const input = req.query.text ? {
      text: req.query.text,
      voice: req.query.voice ? safeParseJson(req.query.voice) : undefined,
      audioConfig: req.query.audioConfig ? safeParseJson(req.query.audioConfig) : undefined,
      concurrency: req.query.concurrency ? parseInt(req.query.concurrency) : undefined,
      returnBase64: req.query.returnBase64 === "true"
    } : req.body;

    // Validate input
    if (!input?.text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Process with defaults
    const audioContent = await synthesizeChunk(
      input.text,
      input.voice,
      input.audioConfig
    );

    // Handle output
    let result;
    if (input.returnBase64) {
      result = { base64: audioContent.toString("base64") };
    } else {
      const url = await uploadAudio(audioContent, "output");
      result = { url };
    }

    res.json({
      success: true,
      bytes: audioContent.length,
      ...result
    });

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV !== "production" ? error.stack : undefined
    });
  }
});

// Health check endpoint
router.get("/status", (req, res) => {
  res.json({
    status: "ok",
    services: {
      googleTTS: !!ttsClient,
      r2Storage: !!r2Client,
      gcsStorage: !!gcsClient
    },
    timestamp: new Date().toISOString()
  });
});

export default router;
