import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createLogger, format, transports } from 'winston';
import chunkRouter from './routes/chunk.js';

// Initialize environment
dotenv.config();

// Configure logging
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

const app = express();

// Enhanced CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Middleware to handle both JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    body: req.method === 'POST' ? req.body : req.query
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthcheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV
  };
  res.json(healthcheck);
});

// API routes
app.use('/tts', chunkRouter);

// 404 handler
app.use((req, res) => {
  logger.warn('404 Not Found', { url: req.originalUrl, method: req.method });
  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource ${req.originalUrl} was not found`
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Server Error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    query: req.query
  });
  
  const response = {
    error: 'Internal Server Error',
    requestId: req.id
  };

  if (process.env.NODE_ENV !== 'production') {
    response.details = err.message;
    response.stack = err.stack;
  }

  res.status(500).json(response);
});

// Server configuration
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.info(`Server running on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
