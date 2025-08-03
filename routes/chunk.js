// Update the imports at the top
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';

// Initialize clients with proper credentials
let ttsClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS) {
  const config = process.env.GOOGLE_CREDENTIALS 
    ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS) }
    : {};
  ttsClient = new TextToSpeechClient(config);
}

// Add the POST endpoint
router.post('/chunked', async (req, res) => {
  try {
    const { text, voice, audioConfig, concurrency, R2_BUCKET, R2_PREFIX } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (!ttsClient) {
      return res.status(500).json({ error: 'Google TTS not configured' });
    }

    // Process the text and generate TTS
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: sanitizeText(text) },
      voice: voice || {
        languageCode: 'en-GB',
        name: 'en-GB-Wavenet-B'
      },
      audioConfig: audioConfig || {
        audioEncoding: 'MP3',
        speakingRate: 1.0
      }
    });

    // Handle storage options
    if (r2Client && R2_BUCKET) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `${R2_PREFIX || 'tts'}-${timestamp}.mp3`;
      const url = await uploadToR2(response.audioContent, key, R2_BUCKET);
      return res.json({
        count: 1,
        chunks: [{
          index: 0,
          bytesApprox: response.audioContent.length,
          url
        }],
        summaryBytesApprox: response.audioContent.length
      });
    }

    // Fallback to base64
    res.json({
      count: 1,
      chunks: [{
        index: 0,
        bytesApprox: response.audioContent.length,
        base64: response.audioContent.toString('base64')
      }],
      summaryBytesApprox: response.audioContent.length
    });

  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});
