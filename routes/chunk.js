import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// --- SSML Formatter ---
const formatSSML = (plainText) => {
  const breakTime = `${process.env.SSML_BREAK_MS || 300}ms`;
  
  let ssml = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/([?!.;])\s+/g, `$1<break time="${breakTime}"/> `)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, 
      `<say-as interpret-as="date" format="${process.env.SSML_DATE_FORMAT || 'ymd'}">$1$2$3</say-as>`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g,
      `<say-as interpret-as="time" format="${process.env.SSML_TIME_FORMAT || 'hms12'}">$1:$2</say-as>`)
    .replace(/\b([A-Z]{3,})\b/g, '<sub alias="$1">$1</sub>')
    .replace(/\b(\d+)\b/g, '<say-as interpret-as="cardinal">$1</say-as>');

  return `<speak>${ssml}</speak>`;
};

// --- Clients Initialization ---
let ttsClient;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    ttsClient = new TextToSpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      projectId: process.env.GCP_PROJECT_ID
    });
  } catch (err) {
    console.error('Google TTS init error:', err);
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

// --- Helper Functions ---
const sanitizeText = (text) => text.toString().replace(/[^\w\s.,!?;:'"\-<>]/g, '').trim();

const chunkText = (text, maxLength = process.env.MAX_TEXT_LENGTH || 2000) => {
  return text.match(new RegExp(`.{1,${maxLength}}`, 'gs')) || [];
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
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
};

// --- Endpoints ---
router.get('/chunked/fast', async (req, res) => {
  try {
    if (!req.query.text) {
      return res.status(400).json({
        error: "Text required",
        example: formatSSML("Try: Hello! Today is 2025-08-03.")
      });
    }

    const maxLength = Math.min(
      parseInt(req.query.maxLength) || 2000,
      process.env.MAX_TEXT_LENGTH || 5000
    );

    const cleanText = sanitizeText(req.query.text).slice(0, maxLength);
    const isTruncated = req.query.text.length > maxLength;

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

    if (r2Client && (req.query.R2_BUCKET || process.env.R2_BUCKET)) {
      const bucket = req.query.R2_BUCKET || process.env.R2_BUCKET;
      const prefix = req.query.R2_PREFIX || new Date().toISOString().split('T')[0];
      const key = `${prefix}-${Date.now()}.mp3`;
      
      const url = await uploadToR2(response.audioContent, key, bucket);
      return res.json({
        url,
        textLength: cleanText.length,
        isTruncated,
        ssmlUsed: formatSSML(cleanText)
      });
    }

    res.json({
      base64: response.audioContent.toString('base64'),
      textLength: cleanText.length,
      isTruncated
    });

  } catch (err) {
    console.error('Fast TTS Error:', err);
    res.status(500).json({
      error: 'Processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
