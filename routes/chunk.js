import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();

// Initialize TTS client
let ttsClient;
try {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('GOOGLE_CREDENTIALS environment variable is missing');
  }

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  ttsClient = new TextToSpeechClient({
    credentials,
    projectId: process.env.GCP_PROJECT_ID
  });

  // Test the connection
  await ttsClient.listVoices({});
  console.log('✅ Google TTS client initialized successfully');
} catch (err) {
  console.error('❌ Failed to initialize TTS client:', {
    message: err.message,
    stack: err.stack,
    credentialsPresent: !!process.env.GOOGLE_CREDENTIALS,
    credentialsValid: isJson(process.env.GOOGLE_CREDENTIALS),
    projectId: process.env.GCP_PROJECT_ID
  });
  throw err;
}

// Helper function to check if string is JSON
function isJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// TTS Processing Endpoint
router.post('/chunked', async (req, res) => {
  const requestId = Date.now();
  
  try {
    console.log(`ℹ️ [${requestId}] Request received`);
    
    if (!req.body) {
      throw new Error('Request body is missing');
    }

    const { text, voice, audioConfig } = req.body;

    if (!text) {
      return res.status(400).json({
        error: 'Text parameter is required',
        example: {
          text: 'Hello world',
          voice: {
            languageCode: 'en-GB',
            name: 'en-GB-Wavenet-B'
          },
          audioConfig: {
            audioEncoding: 'MP3'
          }
        }
      });
    }

    // Process with timeout
    const ttsPromise = ttsClient.synthesizeSpeech({
      input: { text },
      voice: voice || {
        languageCode: 'en-GB',
        name: 'en-GB-Wavenet-B'
      },
      audioConfig: audioConfig || {
        audioEncoding: 'MP3',
        speakingRate: 1.0
      }
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TTS processing timeout')), 10000);
    });

    const response = await Promise.race([ttsPromise, timeoutPromise]);

    res.json({
      success: true,
      audioLength: response[0].audioContent.length
    });

  } catch (err) {
    console.error(`❌ [${requestId}] Error:`, {
      message: err.message,
      stack: err.stack,
      body: req.body ? '***' : 'empty'
    });

    res.status(500).json({
      error: 'Failed to process TTS request',
      requestId,
      ...(process.env.NODE_ENV !== 'production' && { details: err.message })
    });
  }
});

export default router;
