import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// Initialize clients (with error handling)
let ttsClient, s3Client;
try {
  ttsClient = new TextToSpeechClient();
  if (process.env.R2_ENDPOINT) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
} catch (err) {
  console.error('Client initialization failed:', err);
}

// POST /tts/chunked
router.post('/chunked', async (req, res) => {
  try {
    console.log('Request body:', req.body);
    const { text, voice, audioConfig, R2_BUCKET, R2_PREFIX } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "text is required in request body" });
    }

    // Simplified processing for testing
    const result = {
      status: 'success',
      message: 'TTS processing simulated',
      text: text.slice(0, 100),
      chunks: [{
        index: 0,
        bytesApprox: text.length,
        url: process.env.R2_PUBLIC_BASE_URL 
          ? `${process.env.R2_PUBLIC_BASE_URL}/sample.mp3`
          : null,
        base64: !process.env.R2_PUBLIC_BASE_URL 
          ? Buffer.from(text).toString('base64').slice(0, 100) + '...' 
          : null
      }],
      summaryBytesApprox: text.length
    };

    res.json(result);

  } catch (err) {
    console.error('POST /chunked error:', err);
    res.status(500).json({ 
      error: "Processing failed",
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

// GET /tts/chunked/fast
router.get('/chunked/fast', async (req, res) => {
  try {
    const { text } = req.query;
    console.log('GET /fast query params:', req.query);
    
    if (!text) {
      return res.status(400).json({ error: "text query parameter is required" });
    }

    res.json({ 
      status: 'success',
      message: 'GET endpoint is working',
      text: text.slice(0, 100),
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('GET /fast error:', err);
    res.status(500).json({ 
      error: "Processing failed",
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
