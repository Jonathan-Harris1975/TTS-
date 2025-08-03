import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();

// Simplified configuration
const { GOOGLE_CREDENTIALS } = process.env;

// Initialize TTS client with verbose logging
let ttsClient;
try {
  console.log('ℹ️ Attempting to initialize TTS client...');
  const credentials = JSON.parse(GOOGLE_CREDENTIALS);
  ttsClient = new TextToSpeechClient({ credentials });
  console.log('✅ TTS client initialized successfully');
} catch (err) {
  console.error('❌ TTS client initialization failed:', {
    message: err.message,
    stack: err.stack,
    credentialsLength: GOOGLE_CREDENTIALS?.length,
    credentialsStart: GOOGLE_CREDENTIALS?.slice(0, 20) + '...'
  });
  throw err;
}

// Minimal test endpoint
router.get('/test', (req, res) => {
  console.log('✅ Chunk router test endpoint reached');
  res.json({
    status: 'ok',
    ttsInitialized: !!ttsClient
  });
});

// Your existing /chunked endpoint with more logging
router.post('/chunked', async (req, res) => {
  try {
    console.log('ℹ️ /chunked request received:', {
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: req.body ? '***' : 'empty'
    });

    if (!req.body?.text && !req.query?.text) {
      console.warn('⚠️ No text provided in request');
      return res.status(400).json({ error: "Text is required" });
    }

    const text = req.body?.text || req.query?.text;
    console.log('ℹ️ Processing text:', text?.slice(0, 50) + (text?.length > 50 ? '...' : ''));

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: 'en-GB',
        name: 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: 'MP3'
      }
    });

    console.log('✅ TTS response received');
    res.json({
      success: true,
      audioLength: response.audioContent?.length
    });

  } catch (err) {
    console.error('❌ /chunked error:', {
      message: err.message,
      stack: err.stack,
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body ? '***' : 'empty'
      }
    });
    res.status(500).json({ 
      error: 'Internal Server Error',
      requestId: Date.now()
    });
  }
});

export default router;
