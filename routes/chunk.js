import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import pLimit from 'p-limit';

const router = express.Router();
const concurrencyLimiter = pLimit(3); // Limit to 3 concurrent TTS requests

// Initialize TTS client with retries
let ttsClient;
const MAX_RETRIES = 3;

const initializeTTS = async (retryCount = 0) => {
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
    if (retryCount < MAX_RETRIES) {
      console.warn(`⚠️ Retrying TTS initialization (${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return initializeTTS(retryCount + 1);
    }
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
  console.error('Fatal TTS initialization error:', err);
  process.exit(1);
});

// Request validation
const validateTTSRequest = (body) => {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be a JSON object');
  }

  const { text, voice, audioConfig } = body;

  if (!text || typeof text !== 'string') {
    throw new Error('"text" parameter (string) is required');
  }

  return {
    text: text.slice(0, 5000), // Limit input size
    voice: {
      languageCode: voice?.languageCode || 'en-GB',
      name: voice?.name || 'en-GB-Wavenet-B',
      ...voice
    },
    audioConfig: {
      audioEncoding: audioConfig?.audioEncoding || 'MP3',
      speakingRate: audioConfig?.speakingRate || 1.0,
      ...audioConfig
    }
  };
};

// TTS Processing Endpoint
router.post('/chunked', async (req, res) => {
  const requestId = Date.now();
  
  try {
    console.log(`[${requestId}] New TTS request`);
    
    const { text, voice, audioConfig } = validateTTSRequest(req.body);

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
      audioLength: response[0].audioContent?.length || 0
    });

  } catch (err) {
    console.error(`[${requestId}] TTS Error:`, {
      message: err.message,
      stack: err.stack,
      bodySample: req.body ? JSON.stringify(req.body).slice(0, 100) : 'empty'
    });

    const statusCode = err.message.includes('Request body') ? 400 : 500;
    res.status(statusCode).json({
      error: 'TTS processing failed',
      requestId,
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
      ...(statusCode === 400 && { example: {
        text: "Required text here",
        voice: {
          languageCode: "en-GB",
          name: "en-GB-Wavenet-B" 
        },
        audioConfig: {
          audioEncoding: "MP3"
        }
      }})
    });
  }
});

// Diagnostic endpoint
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    ttsInitialized: !!ttsClient,
    concurrency: {
      pending: concurrencyLimiter.pendingCount,
      active: concurrencyLimiter.activeCount
    },
    environment: {
      gcpProject: process.env.GCP_PROJECT_ID,
      credentialsLength: process.env.GOOGLE_CREDENTIALS?.length
    }
  });
});

export default router;
