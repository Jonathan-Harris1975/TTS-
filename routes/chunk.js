import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// ======================
// SSML FORMATTING ENGINE
// ======================
const formatSSML = (text) => {
  if (!process.env.SSML_ENABLED || process.env.SSML_ENABLED === 'false') {
    return `<speak>${text}</speak>`;
  }

  let processed = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Date formatting (ISO: 2025-08-03)
  if (process.env.SSML_DATE_FORMAT) {
    processed = processed.replace(
      /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      `<say-as interpret-as="date" format="${process.env.SSML_DATE_FORMAT}">$1$2$3</say-as>`
    );
  }

  // Time formatting (14:30 or 2:30 PM)
  if (process.env.SSML_TIME_FORMAT) {
    processed = processed.replace(
      /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s?(AM|PM)?\b/gi,
      (match, h, m, s, period) => {
        const timeStr = s ? `${h}:${m}:${s}` : `${h}:${m}`;
        return `<say-as interpret-as="time" format="${process.env.SSML_TIME_FORMAT}">${timeStr}${period || ''}</say-as>`;
      }
    );
  }

  // Currency formatting ($19.99 or 42 EUR)
  if (process.env.SSML_CURRENCIES === 'true') {
    processed = processed
      .replace(/\$(\d+\.?\d*)\b/g, '<say-as interpret-as="currency" currency="USD">$1</say-as>')
      .replace(/\b(\d+\.?\d*)\s?(USD|EUR|GBP|JPY)\b/gi, '<say-as interpret-as="currency" currency="$2">$1</say-as>');
  }

  // Measurements (5kg, 10 miles)
  if (process.env.SSML_MEASUREMENTS === 'true') {
    processed = processed.replace(
      /\b(\d+\.?\d*)\s?(kg|lb|cm|in|km|mi|m|ft)\b/gi,
      '<say-as interpret-as="unit">$1 $2</say-as>'
    );
  }

  // Acronyms (NASA, FAQ)
  if (process.env.SSML_ACRONYMS === 'true') {
    processed = processed.replace(
      /\b([A-Z]{2,})\b/g,
      (match) => `<sub alias="${match.split('').join(' ')}">${match}</sub>`
    );
  }

  // Add pauses after punctuation
  const breakTime = process.env.SSML_BREAK_MS ? `${process.env.SSML_BREAK_MS}ms` : '300ms';
  processed = processed.replace(/([.!?;])\s+/g, `$1<break time="${breakTime}"/> `);

  return `<speak>${processed}</speak>`;
};

// ======================
// CORE FUNCTIONALITY
// ======================
let ttsClient;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    ttsClient = new TextToSpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      projectId: process.env.GCP_PROJECT_ID
    });
  } catch (err) {
    console.error('❌ Google TTS init failed:', err.message);
  }
}

const r2Client = process.env.R2_ACCESS_KEY ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
}) : null;

const sanitizeText = (text) => String(text).replace(/[^\w\s.,!?;:'"\-<>]/g, '').trim();

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
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
};

// ======================
// API ENDPOINTS
// ======================
router.get('/chunked/fast', async (req, res) => {
  try {
    // Validate input
    if (!req.query.text) {
      return res.status(400).json({
        error: "Missing text",
        example: "?text=Hello+world&voice=en-US-Wavenet-A"
      });
    }

    // Process text
    const maxLength = Math.min(
      parseInt(req.query.maxLength) || 2000,
      parseInt(process.env.MAX_TEXT_LENGTH) || 5000
    );
    const cleanText = sanitizeText(req.query.text).slice(0, maxLength);
    const isTruncated = req.query.text.length > maxLength;

    // Generate speech
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: formatSSML(cleanText) },
      voice: {
        languageCode: req.query.languageCode || 'en-GB',
        name: req.query.name || 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: req.query.audioEncoding || 'MP3',
        speakingRate: req.query.speakingRate ? parseFloat(req.query.speakingRate) : 1.0
      }
    });

    // Handle output
    if (r2Client && (req.query.R2_BUCKET || process.env.R2_BUCKET)) {
      const bucket = req.query.R2_BUCKET || process.env.R2_BUCKET;
      const prefix = req.query.R2_PREFIX || new Date().toISOString().split('T')[0];
      const key = `${prefix}-${Date.now()}.mp3`;
      
      const url = await uploadToR2(response.audioContent, key, bucket);
      return res.json({
        url,
        textLength: cleanText.length,
        isTruncated,
        ssml: formatSSML(cleanText)
      });
    }

    res.json({
      base64: response.audioContent.toString('base64'),
      textLength: cleanText.length,
      isTruncated
    });

  } catch (err) {
    console.error(`TTS Error: ${err.message}`);
    res.status(500).json({
      error: "Processing failed",
      details: process.env.NODE_ENV !== 'production' ? {
        message: err.message,
        stack: err.stack
      } : undefined
    });
  }
});

export default router;
