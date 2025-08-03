import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();

// Initialize TTS client
let ttsClient;
try {
  ttsClient = new TextToSpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    projectId: process.env.GCP_PROJECT_ID
  });
  console.log('TTS client initialized successfully');
} catch (err) {
  console.error('Failed to initialize TTS client:', err);
  throw err;
}

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    ttsInitialized: !!ttsClient
  });
});

// TTS endpoint
router.post('/chunked', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

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

    res.json({
      success: true,
      audioLength: response.audioContent.length
    });

  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({ 
      error: 'Failed to process TTS request',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

export default router;
