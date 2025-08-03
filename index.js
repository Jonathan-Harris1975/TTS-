import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import chunkRouter from './routes/chunk.js';

dotenv.config();

const app = express();
const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// Middleware
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json());
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/tts', chunkRouter);

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      googleTTS: !!process.env.GOOGLE_CREDENTIALS,
      r2Storage: !!process.env.R2_ACCESS_KEY
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});
