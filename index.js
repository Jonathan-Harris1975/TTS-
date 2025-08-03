import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createLogger, transports } from 'winston';
import chunkRouter from './routes/chunk.js';

dotenv.config();

const app = express();
const logger = createLogger({
  transports: [new transports.Console()],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// Middleware
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json());

// Routes
app.use('/tts', chunkRouter);

// UK Voice Test Endpoint
app.get('/voice-demo', (_, res) => {
  res.json({
    availableVoices: [
      'en-GB-Wavenet-A (Female)',
      'en-GB-Wavenet-B (Male)',
      'en-GB-Wavenet-C (Female)',
      'en-GB-Wavenet-D (Male)'
    ],
    recommendedSettings: {
      speakingRate: 1.1,
      pitch: -2.0,
      volumeGainDb: 3.0
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`UK TTS Service running on port ${PORT}`);
  logger.info(`Default voice: ${process.env.DEFAULT_VOICE}`);
});
