import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// Initialize Google TTS Client
let ttsClient;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    ttsClient = new TextToSpeechClient({
      credentials,
      projectId: process.env.GCP_PROJECT_ID
    });
    console.log('Google TTS client initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Google TTS client:', err);
  }
}

// Initialize R2 Client
const r2Client = process.env.R2_ACCESS_KEY ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
}) : null;

if (r2Client) {
  console.log('R2 client initialized successfully');
} else {
  console.log('R2 client not configured - missing R2_ACCESS_KEY or R2_SECRET_KEY');
}

// Helper functions
const sanitizeText = (text) => {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\w\s.,!?;:'"\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const chunkText = (text, maxLength = 2000) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.substring(i, i + maxLength));
  }
  return chunks;
};

const uploadToR2 = async (buffer, key, bucket) => {
  try {
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
    // Clean the base URL and ensure no double slashes
    const cleanBaseUrl = process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
    return `${cleanBaseUrl}/${key}`;
  } catch (err) {
    console.error('R2 Upload Error:', err);
    throw new Error('Failed to upload to R2 storage');
  }
};

// Fast processing endpoint (GET)
router.get('/chunked/fast', async (req, res) => {
  try {
    if (!ttsClient) {
      return res.status(500).json({ error: 'Google TTS not configured' });
    }

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
      R2_BUCKET: req.query.R2_BUCKET || process.env.R2_BUCKET,
      R2_PREFIX: req.query.R2_PREFIX || 'fast-tts'
    };

    const cleanText = sanitizeText(input.text).slice(0, 2000);
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: cleanText },
      voice: input.voice,
      audioConfig: input.audioConfig
    });

    if (r2Client && input.R2_BUCKET) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const timePart = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .split('T')[1]
        .split('.')[0]; // HH-MM-SS format
      const key = `${input.R2_PREFIX || today}-${timePart}.mp3`;
      
      const url = await uploadToR2(response.audioContent, key, input.R2_BUCKET);
      return res.json({
        status: 'success',
        url,
        bytes: response.audioContent.length,
        textLength: cleanText.length
      });
    }

    res.json({
      status: 'success',
      base64: response.audioContent.toString('base64'),
      textLength: cleanText.length
    });

  } catch (err) {
    console.error('Fast TTS Error:', err);
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

// Full processing endpoint (POST)
router.post('/chunked', async (req, res) => {
  try {
    if (!ttsClient) {
      return res.status(500).json({ error: 'Google TTS not configured' });
    }

    const { text, voice, audioConfig, concurrency = 3, R2_BUCKET, R2_PREFIX } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const cleanText = sanitizeText(text);
    const chunks = chunkText(cleanText);
    const bucket = R2_BUCKET || process.env.R2_BUCKET;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    const results = await Promise.all(chunks.map(async (chunk, index) => {
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: chunk },
        voice: voice || {
          languageCode: 'en-GB',
          name: 'en-GB-Wavenet-B'
        },
        audioConfig: audioConfig || {
          audioEncoding: 'MP3',
          speakingRate: 1.0
        }
      });

      if (r2Client && bucket) {
        const key = `${R2_PREFIX || today}-${index.toString().padStart(3, '0')}.mp3`;
        const url = await uploadToR2(response.audioContent, key, bucket);
        return {
          index,
          bytesApprox: response.audioContent.length,
          url
        };
      }

      return {
        index,
        bytesApprox: response.audioContent.length,
        base64: response.audioContent.toString('base64')
      };
    }));

    res.json({
      count: chunks.length,
      chunks: results,
      summaryBytesApprox: results.reduce((sum, chunk) => sum + chunk.bytesApprox, 0)
    });

  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
