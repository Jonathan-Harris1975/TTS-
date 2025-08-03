import express from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Storage } from '@google-cloud/storage';
import pLimit from 'p-limit';

const router = express.Router();
const concurrencyLimit = pLimit(3); // Limit concurrent TTS requests

// Configuration
const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_ENDPOINT,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  GCS_BUCKET,
  GOOGLE_CREDENTIALS
} = process.env;

// Initialize clients
const ttsClient = GOOGLE_CREDENTIALS 
  ? new TextToSpeechClient({ credentials: JSON.parse(GOOGLE_CREDENTIALS) })
  : new TextToSpeechClient();

const r2Client = R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT
  ? new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    })
  : null;

const gcsClient = GCS_BUCKET ? new Storage() : null;

// Helper Functions
const wrapSSML = (text) => {
  if (!text) return '';
  const cleaned = String(text).trim();
  return cleaned.startsWith('<speak>') ? cleaned : `<speak>${cleaned}</speak>`;
};

// Core Functions
async function synthesizeSpeech(text, voice = {}, audioConfig = {}) {
  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: wrapSSML(text) },
      voice: {
        languageCode: voice.languageCode || 'en-GB',
        name: voice.name || 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: audioConfig.audioEncoding || 'MP3',
        speakingRate: audioConfig.speakingRate || 1.0,
        ...audioConfig
      }
    });
    return response.audioContent;
  } catch (error) {
    console.error('TTS Error:', error);
    throw new Error('Failed to synthesize speech');
  }
}

async function uploadToStorage(buffer, prefix = 'audio') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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
          ContentType: 'audio/mpeg'
        }
      }).done();
      return `${R2_PUBLIC_BASE_URL}/${filename}`;
    }
    
    // Fallback to GCS
    if (gcsClient && GCS_BUCKET) {
      const file = gcsClient.bucket(GCS_BUCKET).file(filename);
      await file.save(buffer, { contentType: 'audio/mpeg' });
      return `https://storage.googleapis.com/${GCS_BUCKET}/${filename}`;
    }
    
    // Fallback to base64
    return { base64: buffer.toString('base64') };
  } catch (error) {
    console.error('Upload Error:', error);
    throw new Error('Failed to upload audio');
  }
}

// API Endpoints
router.post('/chunked', async (req, res) => {
  try {
    // Accept input from both query params and body
    const input = req.query.text ? {
      text: req.query.text,
      voice: req.query.voice ? JSON.parse(req.query.voice) : undefined,
      audioConfig: req.query.audioConfig ? JSON.parse(req.query.audioConfig) : undefined,
      returnBase64: req.query.returnBase64 === 'true'
    } : req.body;

    if (!input?.text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Process with concurrency control
    const audioContent = await concurrencyLimit(() => 
      synthesizeSpeech(input.text, input.voice, input.audioConfig)
    );

    // Handle output
    const result = input.returnBase64
      ? { base64: audioContent.toString('base64') }
      : { url: await uploadToStorage(audioContent) };

    res.json({
      success: true,
      bytes: audioContent.length,
      ...result
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

export default router;
