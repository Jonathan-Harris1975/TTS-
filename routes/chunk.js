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

// Input validation and normalization
const normalizeInput = (req) => {
  let input = {};
  
  // Handle both POST (JSON body) and GET (query params)
  if (req.method === 'POST' && req.body) {
    input = req.body;
  } else {
    input = {
      text: req.query.text,
      voice: {
        languageCode: req.query.languageCode || 'en-GB',
        name: req.query.name || 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: req.query.audioEncoding || 'MP3',
        speakingRate: req.query.speakingRate ? parseFloat(req.query.speakingRate) : 1.0
      },
      concurrency: req.query.concurrency ? parseInt(req.query.concurrency) : 3,
      R2_BUCKET: req.query.R2_BUCKET,
      R2_PREFIX: req.query.R2_PREFIX,
      returnBase64: req.query.returnBase64 === 'true'
    };
  }

  // Validate required fields
  if (!input.text || typeof input.text !== 'string') {
    throw new Error('Valid text is required');
  }

  return {
    text: input.text,
    voice: input.voice || { languageCode: 'en-GB', name: 'en-GB-Wavenet-B' },
    audioConfig: input.audioConfig || { audioEncoding: 'MP3', speakingRate: 1.0 },
    concurrency: Math.min(Math.max(input.concurrency || 3, 1), 10),
    R2_BUCKET: input.R2_BUCKET,
    R2_PREFIX: input.R2_PREFIX,
    returnBase64: input.returnBase64 || false
  };
};

// Text processing functions
const chunkText = (text, maxLength = 3000) => {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = sentence.length <= maxLength ? sentence : sentence.substring(0, maxLength);
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
};

const sanitizeText = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\w\s.,!?;:'"\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Storage functions
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
    return `${process.env.R2_PUBLIC_BASE_URL || ''}/${key}`;
  } catch (err) {
    console.error('R2 Upload Error:', err);
    throw new Error('Failed to upload to R2 storage');
  }
};

const uploadToGCS = async (buffer, key) => {
  try {
    const bucket = gcsClient.bucket(process.env.GCS_BUCKET);
    const file = bucket.file(key);
    await file.save(buffer, { contentType: 'audio/mpeg' });
    return `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${key}`;
  } catch (err) {
    console.error('GCS Upload Error:', err);
    throw new Error('Failed to upload to Google Cloud Storage');
  }
};

// Main endpoint handler
router.all('/chunked', async (req, res) => {
  try {
    const input = normalizeInput(req);
    const cleanText = sanitizeText(input.text);
    const chunks = chunkText(cleanText);

    // Process chunks with controlled concurrency
    const results = [];
    const processChunk = async (chunk, index) => {
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: chunk },
        voice: input.voice,
        audioConfig: input.audioConfig
      });

      if (input.returnBase64) {
        return {
          index,
          textLength: chunk.length,
          base64: response.audioContent.toString('base64')
        };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = input.R2_PREFIX ? 
        `${input.R2_PREFIX}-${index.toString().padStart(3, '0')}.mp3` : 
        `tts-${timestamp}-${index}.mp3`;

      let url;
      if (r2Client && input.R2_BUCKET) {
        url = await uploadToR2(response.audioContent, key, input.R2_BUCKET);
      } else if (gcsClient && process.env.GCS_BUCKET) {
        url = await uploadToGCS(response.audioContent, key);
      } else {
        return {
          index,
          textLength: chunk.length,
          base64: response.audioContent.toString('base64')
        };
      }

      return {
        index,
        textLength: chunk.length,
        url,
        bytes: response.audioContent.length
      };
    };

    // Process with concurrency control
    const activePromises = new Set();
    for (let i = 0; i < chunks.length; i++) {
      if (activePromises.size >= input.concurrency) {
        await Promise.race(activePromises);
      }

      const promise = processChunk(chunks[i], i)
        .then(result => {
          results.push(result);
          activePromises.delete(promise);
        })
        .catch(err => {
          activePromises.delete(promise);
          throw err;
        });

      activePromises.add(promise);
    }

    // Wait for remaining promises
    await Promise.all(activePromises);

    res.json({
      count: chunks.length,
      chunks: results.sort((a, b) => a.index - b.index),
      summaryBytesApprox: results.reduce((sum, r) => sum + (r.bytes || 0), 0)
    });

  } catch (err) {
    console.error('TTS Processing Error:', {
      message: err.message,
      stack: err.stack,
      input: req.method === 'POST' ? req.body : req.query
    });
    
    res.status(400).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
