import express from 'express';
import textToSpeech from '@google-cloud/text-to-speech';
import { v4 as uuidv4 } from 'uuid';
import { saveToR2 } from '../saveToR2.js';

const router = express.Router();
const client = new textToSpeech.TextToSpeechClient();

// Common handler for both endpoints
async function handleTTS(text) {
  const request = {
    input: { text },
    voice: {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-D'
    },
    audioConfig: { audioEncoding: 'MP3' }
  };

  console.log('[INFO] Generating TTS audio...');
  const [response] = await client.synthesizeSpeech(request);
  console.log('[INFO] TTS audio generated successfully');

  const filename = `tts-${Date.now()}-${uuidv4()}.mp3`;
  return await saveToR2(filename, response.audioContent);
}

// POST endpoint for chunked TTS
router.post('/chunked', async (req, res) => {
  try {
    if (!req.body.text) {
      return res.status(400).json({ error: 'text is required' });
    }
    const publicUrl = await handleTTS(req.body.text);
    res.json({ success: true, r2_url: publicUrl });
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple GET endpoint to verify service is running
router.get('/chunked', (req, res) => {
  res.json({
    message: 'GET endpoint is working'
  });
});

export default router;
