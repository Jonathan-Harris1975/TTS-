// Updated chunk.js with proper chunking implementation
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';

// Initialize storage clients conditionally
const r2Client = process.env.R2_ACCESS_KEY_ID ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
}) : null;

const gcsClient = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS ? 
  new Storage() : null;

// Improved text chunker
const chunkText = (text, maxLength = 3000) => {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = sentence.length <= maxLength ? sentence : sentence.substring(0, maxLength);
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
};

// Enhanced sanitizer
const sanitizeText = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\w\s.,!?;:'"\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Upload helper functions
const uploadToR2 = async (buffer, key) => {
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg'
    }
  });
  await upload.done();
  return `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
};

const uploadToGCS = async (buffer, key) => {
  const bucket = gcsClient.bucket(process.env.GCS_BUCKET);
  const file = bucket.file(key);
  await file.save(buffer, { contentType: 'audio/mpeg' });
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${key}`;
};

// Updated TTS endpoint
router.post('/chunked', async (req, res) => {
  try {
    const { text, voice, audioConfig, concurrency = 3, R2_BUCKET, R2_PREFIX, returnBase64 } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const cleanText = sanitizeText(text);
    const chunks = chunkText(cleanText);
    
    // Process chunks in parallel with limited concurrency
    const processChunk = async (chunk, index) => {
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: chunk },
        voice: voice || { languageCode: 'en-GB', name: 'en-GB-Wavenet-B' },
        audioConfig: audioConfig || { audioEncoding: 'MP3', speakingRate: 1.0 }
      });

      if (returnBase64) {
        return {
          index,
          textLength: chunk.length,
          base64: response.audioContent.toString('base64')
        };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = R2_PREFIX ? 
        `${R2_PREFIX}-${index.toString().padStart(3, '0')}.mp3` : 
        `tts-${timestamp}-${index}.mp3`;

      let url;
      if (r2Client && (R2_BUCKET || process.env.R2_BUCKET)) {
        url = await uploadToR2(response.audioContent, key);
      } else if (gcsClient) {
        url = await uploadToGCS(response.audioContent, key);
      } else {
        return {
          index,
          textLength: chunk.length,
          base64: response.audioContent.toString('base64')
        };
      }

      return {
        index,
        textLength: chunk.length,
        url,
        bytes: response.audioContent.length
      };
    };

    // Process with limited concurrency
    const results = await Promise.all(
      chunks.map((_, index) => 
        new Promise(resolve => 
          setTimeout(async () => 
            resolve(await processChunk(chunks[index], index)), 
            index * 1000 / concurrency
          )
        )
    );

    res.json({
      count: chunks.length,
      chunks: results,
      summaryBytesApprox: results.reduce((sum, r) => sum + (r.bytes || 0), 0)
    });

  } catch (err) {
    console.error('TTS Processing Error:', {
      message: err.message,
      stack: err.stack,
      requestBody: req.body ? JSON.stringify(req.body).slice(0, 500) : null
    });
    
    res.status(500).json({
      error: 'TTS processing failed',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});
