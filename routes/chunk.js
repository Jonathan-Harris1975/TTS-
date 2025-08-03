import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();

// Configuration with validation
const { GOOGLE_CREDENTIALS, GCP_PROJECT_ID } = process.env;

// Initialize TTS client with verbose logging
let ttsClient;
try {
  console.log('ℹ️ Initializing TTS client with credentials:', 
    GOOGLE_CREDENTIALS ? '***' + GOOGLE_CREDENTIALS.slice(-10) : 'MISSING');
  
  if (!GOOGLE_CREDENTIALS) throw new Error('GOOGLE_CREDENTIALS missing');
  
  const credentials = JSON.parse(GOOGLE_CREDENTIALS);
  ttsClient = new TextToSpeechClient({
    credentials,
    projectId: GCP_PROJECT_ID
  });
  
  // Verify connection
  await ttsClient.listVoices({});
  console.log('✅ TTS client initialized and verified');
} catch (err) {
  console.error('❌ TTS initialization failed:', {
    message: err.message,
    stack: err.stack,
    credentialsPresent: !!GOOGLE_CREDENTIALS,
    credentialsLength: GOOGLE_CREDENTIALS?.length,
    projectId: GCP_PROJECT_ID
  });
  throw err;
}

// Enhanced chunked endpoint with request diagnostics
router.post('/chunked', async (req, res) => {
  const requestId = Date.now();
  try {
    console.log(`ℹ️ [${requestId}] Request received:`, {
      method: req.method,
      headers: {
        'content-type': req.get('content-type'),
        'content-length': req.get('content-length')
      },
      bodyKeys: req.body ? Object.keys(req.body) : 'empty'
    });

    // Validate input
    if (!req.body) {
      console.warn(`⚠️ [${requestId}] No body received`);
      return res.status(400).json({ error: "Request body is required" });
    }

    const { text, voice, audioConfig } = req.body;
    
    if (!text) {
      console.warn(`⚠️ [${requestId}] Missing text parameter`);
      return res.status(400).json({ 
        error: "text parameter is required",
        example: {
          text: "Hello world",
          voice: {
            languageCode: "en-GB",
            name: "en-GB-Wavenet-B"
          },
          audioConfig: {
            audioEncoding: "MP3"
          }
        }
      });
    }

    console.log(`ℹ️ [${requestId}] Processing text (first 50 chars):`, 
      text.length > 50 ? text.slice(0, 50) + '...' : text);

    // Process with timeout
    const response = await Promise.race([
      ttsClient.synthesizeSpeech({
        input: { text },
        voice: voice || {
          languageCode: "en-GB",
          name: "en-GB-Wavenet-B"
        },
        audioConfig: audioConfig || {
          audioEncoding: "MP3",
          speakingRate: 1.0
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TTS timeout after 10s")), 10000)
    ]);

    console.log(`✅ [${requestId}] TTS successful`);
    res.json({
      success: true,
      audioLength: response[0].audioContent.length
    });

  } catch (err) {
    console.error(`❌ [${requestId}] Processing error:`, {
      message: err.message,
      stack: err.stack,
      bodySample: req.body ? JSON.stringify(req.body).slice(0, 100) : 'empty'
    });

    res.status(500).json({
      error: "TTS processing failed",
      requestId,
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
