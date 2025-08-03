import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// ========================
// UK ENGLISH SSML FORMATTER
// ========================
const formatSSML = (text) => {
  // UK-specific replacements
  let processed = text
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, // Convert to UK date format
      `<say-as interpret-as="date" format="dmy">$1-$2-$3</say-as>`)
    .replace(/\b£(\d+\.?\d*)\b/g, 
      `<say-as interpret-as="currency" currency="GBP">$1</say-as>`)
    .replace(/\b(\d+)p\b/g, // British pence
      `<say-as interpret-as="currency" currency="GBP">0.$1</say-as>`);

  // UK tech term pronunciations
  const UK_TECH_TERMS = {
    'API': 'A P I',
    'JSON': 'Jay-son',
    'HTTP': 'H T T P',
    'AI': 'A I'
  };

  processed = processed.replace(
    /\b(API|JSON|HTTP|AI)\b/gi, 
    match => `<sub alias="${UK_TECH_TERMS[match.toUpperCase()]}">${match}</sub>`
  );

  // UK-style pauses (longer after commas)
  processed = processed
    .replace(/([,;])\s+/g, '<break time="400ms"/>$1 ')
    .replace(/([.!?])\s+/g, '<break time="600ms"/>$1 ');

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">${processed}</speak>`;
};

// ========================
// UK VOICE CONFIGURATION
// ========================
const getVoiceSettings = () => ({
  languageCode: 'en-GB',
  name: process.env.DEFAULT_VOICE || 'en-GB-Wavenet-B',
  ssmlGender: 'MALE'
});

const getAudioConfig = () => ({
  audioEncoding: 'MP3',
  speakingRate: parseFloat(process.env.DEFAULT_SPEAKING_RATE) || 1.1,
  pitch: parseFloat(process.env.DEFAULT_PITCH) || -2.0,
  volumeGainDb: 3.0,
  effectsProfileId: ['medium-bluetooth-speaker-class-device']
});

// ========================
// CORE FUNCTIONALITY
// ========================
let ttsClient;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    ttsClient = new TextToSpeechClient({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      projectId: process.env.GCP_PROJECT_ID
    });
  } catch (err) {
    console.error('❌ TTS Init Error:', err.message);
  }
}

// ========================
// API ENDPOINTS
// ========================
router.post('/tts', async (req, res) => {
  try {
    const { text, voiceConfig, audioConfig } = req.body;

    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: formatSSML(text) },
      voice: voiceConfig || getVoiceSettings(),
      audioConfig: audioConfig || getAudioConfig()
    });

    res.json({
      audioContent: response.audioContent.toString('base64'),
      ssmlUsed: formatSSML(text),
      voiceSettings: getVoiceSettings()
    });

  } catch (err) {
    console.error('UK TTS Error:', err);
    res.status(500).json({
      error: "Speech generation failed",
      suggestion: "Try reducing text length or adjusting voice settings",
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
