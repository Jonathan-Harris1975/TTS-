import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';

const router = express.Router();
const ttsClient = new TextToSpeechClient();

// Initialize storage clients conditionally
const r2Client = process.env.R2_ACCESS_KEY_ID ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
}) : null;

const gcsClient = (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS) ? 
  new Storage() : null;

// Fast processing endpoint optimized for Make.com
router.get('/chunked/fast', async (req, res) => {
  try {
    // Validate and normalize input
    if (!req.query.text) {
      return res.status(400).json({ error: 'Text parameter is required' });
    }

    const input = {
      text: req.query.text,
      voice: {
        languageCode: req.query.languageCode || 'en-GB',
        name: req.query.name || 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: req.query.audioEncoding || 'MP3',
        speakingRate: req.query.speakingRate ? parseFloat(req.query.speakingRate) : 1.0
      },
      R2_BUCKET: req.query.R2_BUCKET,
      R2_PREFIX: req.query.R2_PREFIX || 'fast-tts'
    };

    // Process just the first 2000 characters to stay within timeout limits
    const cleanText = sanitizeText(input.text).slice(0, 2000);
    const firstChunk = chunkText(cleanText, 2000)[0]; // Single chunk mode

    // Generate speech (fast track)
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: firstChunk },
      voice: input.voice,
      audioConfig: input.audioConfig
    });

    // If R2 storage configured, upload and return URL
    if (r2Client && input.R2_BUCKET) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `${input.R2_PREFIX}-${timestamp}.mp3`;
      
      const url = await uploadToR2(response.audioContent, key, input.R2_BUCKET);
      return res.json({
        status: 'success',
        url,
        bytes: response.audioContent.length,
        textLength: firstChunk.length,
        message: 'Processed first 2000 characters'
      });
    }

    // Fallback to base64
    res.json({
      status: 'success',
      base64: response.audioContent.toString('base64'),
      textLength: firstChunk.length,
      message: 'Processed first 2000 characters (no R2 configured)'
    });

  } catch (err) {
    console.error('Fast TTS Error:', err);
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

// Helper functions (same as before but optimized)
const chunkText = (text, maxLength = 2000) => {
  return [text.substring(0, maxLength)]; // Return single chunk
};

const sanitizeText = (text) => {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\w\s.,!?;:'"\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const uploadToR2 = async (buffer, key, bucket) => {
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg'
    }
  });
  await upload.done();
  return `${process.env.R2_PUBLIC_BASE_URL || ''}/${key}`;
};

export default router;
