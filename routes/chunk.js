import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

const router = express.Router();

// ======================
// UK ENGLISH SSML FORMATTER
// ======================
const formatSSML = (text) => {
  // UK-specific replacements
  let processed = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Dates (DD/MM/YYYY)
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, 
      '<say-as interpret-as="date" format="dmy">$1-$2-$3</say-as>')
    // British currency
    .replace(/\b£(\d+\.?\d*)\b/g, 
      '<say-as interpret-as="currency" currency="GBP">$1</say-as>')
    // Times (14:30)
    .replace(/\b(\d{1,2}):(\d{2})\b/g,
      '<say-as interpret-as="time" format="hms24">$1:$2</say-as>');

  // UK tech terms
  const UK_PRONUNCIATIONS = {
    'API': 'A P I', 'JSON': 'Jay-son', 'HTTP': 'H T T P',
    'AI': 'A I', 'SQL': 'Se-quel', 'CEO': 'C E O'
  };

  Object.entries(UK_PRONUNCIATIONS).forEach(([term, alias]) => {
    processed = processed.replace(
      new RegExp(`\\b${term}\\b`, 'gi'),
      `<sub alias="${alias}">${term}</sub>`
    );
  });

  // Natural pauses for British speech
  return `<speak version="1.0" xml:lang="en-GB">
    ${processed.replace(/([.,;])\s+/g, '$1<break time="300ms"/> ')
               .replace(/([?!])\s+/g, '$1<break time="500ms"/> ')}
  </speak>`;
};

// ======================
// TTS CLIENT CONFIG
// ======================
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

// ======================
// QUERY STRING ENDPOINTS
// ======================
router.get('/speak', async (req, res) => {
  try {
    // Required parameters
    const { text, bucket } = req.query;
    if (!text) return res.status(400).json({ error: "?text= required" });

    // Optional parameters with defaults
    const voice = req.query.voice || 'en-GB-Wavenet-B';
    const speed = parseFloat(req.query.speed) || 1.1;
    const prefix = req.query.prefix || 'speech';

    // Generate SSML (auto-formats numbers, dates, etc.)
    const ssml = formatSSML(text);

    // Call Google TTS
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml },
      voice: { 
        languageCode: 'en-GB',
        name: voice 
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed,
        pitch: -2.0,
        volumeGainDb: 3.0
      }
    });

    // Store in R2 if bucket specified
    if (bucket && r2Client) {
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_');
      const key = `${prefix}_${timestamp}.mp3`;
      const url = await new Upload({
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
        textLength: text.length,
        voice,
        speed 
      });
    }

    // Stream audio directly
    res.set('Content-Type', 'audio/mpeg');
    res.send(response.audioContent);

  } catch (err) {
    console.error(`TTS Error: ${err.message}`);
    res.status(500).json({ 
      error: "Speech generation failed",
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

export default router;
