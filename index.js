import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createLogger, format, transports } from 'winston';
import chunkRouter from './routes/chunk.js';

dotenv.config();

const app = express();
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      )
    }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST']
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests'
}));

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
      r2Storage: !!process.env.R2_ACCESS_KEY,
      ssmlEnabled: process.env.SSML_ENABLED === 'true'
    },
    uptime: process.uptime()
  });
});

// Error Handler
app.use((err, req, res, next) => {
  logger.error(`Error ${err.statusCode || 500}: ${err.message}`);
  res.status(err.statusCode || 500).json({
    error: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`SSML Formatting: ${process.env.SSML_ENABLED === 'true' ? 'ENABLED' : 'DISABLED'}`);
  logger.info(`Max Text Length: ${process.env.MAX_TEXT_LENGTH || 2000} chars`);
});
