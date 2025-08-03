import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Storage } from "@google-cloud/storage";
import pLimit from "p-limit";

const router = express.Router();
const concurrencyLimit = pLimit(3);

// Configuration matching YOUR environment variables
const {
  R2_ACCESS_KEY,     // Your actual variable name
  R2_SECRET_KEY,     // Your actual variable name
  R2_ENDPOINT,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  GOOGLE_CREDENTIALS,
  GCS_BUCKET,
  GCP_PROJECT_ID
} = process.env;

// Initialize clients with error handling
let ttsClient, r2Client, gcsClient;

try {
  // Google TTS Client
  ttsClient = new TextToSpeechClient({
    credentials: JSON.parse(GOOGLE_CREDENTIALS),
    projectId: GCP_PROJECT_ID
  });

  // R2 Client
  r2Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY
    }
  });

  // GCS Client
  if (GCS_BUCKET) {
    gcsClient = new Storage({
      credentials: JSON.parse(GOOGLE_CREDENTIALS)
    });
  }
} catch (err) {
  console.error("Initialization error:", err);
  throw err;
}

// Helper function to wrap text in SSML
const toSSML = (text) => {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.startsWith("<speak>") ? trimmed : `<speak>${trimmed}</speak>`;
};

// TTS Synthesis
async function synthesize(text, voice, audioConfig) {
  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: toSSML(text) },
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
  } catch (err) {
    console.error("TTS Error:", err);
    throw new Error("Failed to synthesize speech");
  }
}

// File Upload
async function upload(buffer, prefix = "audio") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${prefix}-${timestamp}-${Math.random().toString(36).slice(2, 8)}.mp3`;

  try {
    // Try R2 first
    if (r2Client && R2_BUCKET) {
      await new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET,
          Key: filename,
          Body: buffer,
          ContentType: "audio/mpeg"
        }
      }).done();
      return `${R2_PUBLIC_BASE_URL}/${filename}`;
    }

    // Fallback to GCS
    if (gcsClient && GCS_BUCKET) {
      const file = gcsClient.bucket(GCS_BUCKET).file(filename);
      await file.save(buffer, { contentType: "audio/mpeg" });
      return `https://storage.googleapis.com/${GCS_BUCKET}/${filename}`;
    }

    // Fallback to base64
    return { base64: buffer.toString("base64") };
  } catch (err) {
    console.error("Upload Error:", err);
    throw new Error("Failed to upload audio");
  }
}

// API Endpoint
router.post("/chunked", async (req, res) => {
  try {
    // Get input from either query or body
    const input = req.query.text ? {
      text: req.query.text,
      voice: req.query.voice ? JSON.parse(req.query.voice) : undefined,
      audioConfig: req.query.audioConfig ? JSON.parse(req.query.audioConfig) : undefined,
      returnBase64: req.query.returnBase64 === "true"
    } : req.body;

    if (!input?.text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Process request
    const audio = await concurrencyLimit(() =>
      synthesize(input.text, input.voice, input.audioConfig)
    );

    const result = input.returnBase64
      ? { base64: audio.toString("base64") }
      : { url: await upload(audio) };

    res.json({
      success: true,
      bytes: audio.length,
      ...result
    });

  } catch (err) {
    console.error("Endpoint Error:", {
      error: err.message,
      stack: err.stack,
      request: {
        method: req.method,
        url: req.url,
        query: req.query,
        body: req.body
      }
    });

    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack })
    });
  }
});

export default router;
