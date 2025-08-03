import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();
const ttsClient = new TextToSpeechClient();

// Text sanitization helper
const sanitizeText = (text) => {
  return String(text)
    .replace(/[\u2018\u2019\u201C\u201D]/g, '') // Remove fancy quotes
    .replace(/[^\w\s.,!?;:'"-]/g, '')          // Remove special chars
    .slice(0, 5000);                           // Limit length
};

router.post('/chunked', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        error: 'Text is required',
        example: {
          text: "Hello world",
          voice: {
            languageCode: "en-GB",
            name: "en-GB-Wavenet-B"
          }
        }
      });
    }

    const cleanText = sanitizeText(text);
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: cleanText },
      voice: req.body.voice || {
        languageCode: 'en-GB',
        name: 'en-GB-Wavenet-B'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0
      }
    });

    res.json({
      success: true,
      originalLength: text.length,
      cleanLength: cleanText.length,
      audioLength: response.audioContent.length
    });

  } catch (err) {
    console.error('TTS Error:', {
      message: err.message,
      textSample: req.body.text?.slice(0, 100)
    });
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
