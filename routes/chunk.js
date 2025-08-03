import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import pLimit from 'p-limit';

const router = express.Router();
const concurrencyLimiter = pLimit(3); // Limit concurrent TTS requests

// Initialize TTS client with validation
let ttsClient;
const initializeTTS = async () => {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    
    ttsClient = new TextToSpeechClient({
      credentials,
      projectId: process.env.GCP_PROJECT_ID,
      fallback: true
    });

    // Verify connection
    await ttsClient.listVoices({});
    console.log('✅ Google TTS client initialized');
  } catch (err) {
    console.error('❌ TTS initialization failed:', {
      message: err.message,
      credentialsLength: process.env.GOOGLE_CREDENTIALS?.length,
      projectId: process.env.GCP_PROJECT_ID
    });
    throw new Error('TTS service unavailable');
  }
};

// Initialize immediately
initializeTTS().catch(err => {
  console.error('Failed to initialize TTS:', err);
  process.exit(1);
});

// Helper functions
const validateRequest = (body) => {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be JSON');
  }

  if (!body.text) {
    throw new Error('Text parameter is required');
  }

  return {
    text: String(body.text).slice(0, 5000), // Limit input size
    voice: body.voice || {
      languageCode: 'en-GB',
      name: 'en-GB-Wavenet-B'
    },
    audioConfig: body.audioConfig || {
      audioEncoding: 'MP3',
      speakingRate: 1.0
    }
  };
};

// TTS Processing Endpoint
router.post('/chunked', async (req, res) => {
  const requestId = Date.now();
  
  try {
    console.log(`[${requestId}] New TTS request`);
    
    const { text, voice, audioConfig } = validateRequest(req.body);

    const response = await concurrencyLimiter(() => 
      ttsClient.synthesizeSpeech({
        input: { text },
        voice,
        audioConfig
      })
    );

    res.json({
      success: true,
      requestId,
      audioLength: response[0].audioContent.length
    });

  } catch (err) {
    console.error(`[${requestId}] TTS failed:`, {
      error: err.message,
      body: req.body ? '***' : 'empty'
    });

    res.status(err.statusCode || 500).json({
      error: 'Failed to process TTS request',
      requestId,
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    ttsInitialized: !!ttsClient,
    concurrency: concurrencyLimiter.pendingCount
  });
});

export default router;
