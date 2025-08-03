import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const router = express.Router();
const ttsClient = new TextToSpeechClient();

// Text sanitizer
const sanitizeText = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/[\u2018\u2019\u201C\u201D]/g, '') // Remove fancy quotes
    .replace(/[^\w\s.,!?;:'"-]/g, '')          // Remove special chars
    .replace(/\s+/g, ' ')                      // Collapse whitespace
    .trim()
    .slice(0, 5000);                           // Limit length
};

// TTS endpoint
router.post('/chunked', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        error: 'Request body must be JSON',
        example: {
          text: "Your text here",
          voice: {
            languageCode: "en-GB",
            name: "en-GB-Wavenet-B"
          }
        }
      });
    }

    const { text } = req.body;
    const cleanText = sanitizeText(text);

    if (!cleanText) {
      return res.status(400).json({
        error: 'Text cannot be empty after sanitization',
        originalText: text?.slice(0, 100)
      });
    }

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
      textLength: cleanText.length,
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
