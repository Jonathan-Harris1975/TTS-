import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// Initialize clients
const ttsClient = process.env.GOOGLE_CREDENTIALS ? new TextToSpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  projectId: process.env.GCP_PROJECT_ID
}) : null;

const r2Client = process.env.R2_ACCESS_KEY ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
}) : null;

// Enhanced SSML Formatter for UK English
const formatSSML = (text) => {
  // British English specific replacements
  let processed = text
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, 
      '<say-as interpret-as="date" format="dmy">$1-$2-$3</say-as>') // UK date format
    .replace(/\b£(\d+\.?\d*)\b/g, 
      '<say-as interpret-as="currency" currency="GBP">$1</say-as>') // British pounds
    .replace(/([.,;])\s+/g, '$1<break time="300ms"/> ') // Natural pauses
    .replace(/([?!])\s+/g, '$1<break time="500ms"/> ');

  return `<speak version="1.0" xml:lang="en-GB">${processed}</speak>`;
};

// GET Endpoint with Full Voice Control
router.get('/speak', async (req, res) => {
  try {
    const { 
      text, 
      voice = 'en-GB-Wavenet-B',
      speed = '1.1',
      pitch = '-2.0',      // Default slightly deeper pitch for UK English
      volume = '3.0',     // Slight volume boost (in dB)
      bucket,             // Optional R2 bucket
      prefix = 'speech'   // File prefix
    } = req.query;

    if (!text) return res.status(400).json({ error: "?text= parameter required" });

    // Generate speech with voice tuning
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: formatSSML(text) },
      voice: {
        languageCode: 'en-GB',
        name: voice,
        ssmlGender: voice.includes('Female') ? 'FEMALE' : 'MALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: parseFloat(speed) || 1.1,  // Default slightly faster for UK English
        pitch: parseFloat(pitch) || -2.0,       // -20.0 to 20.0
        volumeGainDb: parseFloat(volume) || 3.0, // Volume boost in decibels
        effectsProfileId: ['medium-bluetooth-speaker-class-device']
      }
    });

    // Store in R2 if bucket specified
    if (bucket && r2Client) {
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_');
      const key = `${prefix}_${timestamp}.mp3`;
      
      await new Upload({
        client: r2Client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: response.audioContent,
          ContentType: 'audio/mpeg'
        }
      }).done();

      return res.json({
        url: `${process.env.R2_PUBLIC_BASE_URL}/${key}`,
        settings: { voice, speed, pitch, volume }
      });
    }

    // Stream audio directly
    res.set('Content-Type', 'audio/mpeg');
    res.send(response.audioContent);

  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({ 
      error: "Speech generation failed",
      suggestion: "Check voice/pitch parameters are valid",
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
