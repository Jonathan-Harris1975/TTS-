import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createLogger, format, transports } from 'winston';
import chunkRouter from './routes/chunk.js';

dotenv.config();

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' })
  ]
});

const app = express();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));
app.use(express.json());
app.use((req, _, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/tts', chunkRouter);

// Health Check
app.get('/health', (_, res) => res.json({ 
  status: 'up',
  services: {
    googleTTS: !!process.env.GOOGLE_CREDENTIALS,
    r2Storage: !!process.env.R2_ACCESS_KEY
  }
}));

// Error Handling
app.use((err, req, res, _) => {
  logger.error(`Error: ${err.message}`, { 
    path: req.path,
    body: req.body 
  });
  res.status(500).json({ 
    error: 'Internal error',
    requestId: req.id 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`SSML formatting enabled: ${process.env.SSML_ENABLED || 'true'}`);
});
