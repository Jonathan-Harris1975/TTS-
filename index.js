import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import chunkRouter from './routes/chunk.js';
import { createLogger, format, transports } from 'winston';

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

// Enhanced CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
};
app.use(cors(corsOptions));

// Apply rate limiting to all routes
app.use(limiter);

// Improved JSON parsing middleware
app.use(express.text({ type: 'application/json', limit: '10mb' }));
app.use((req, res, next) => {
  if (req.is('application/json')) {
    try {
      // Enhanced JSON sanitization and validation
      const sanitized = req.body
        .replace(/[\u2018\u2019]/g, "'")        // Smart single quotes
        .replace(/[\u201C\u201D]/g, '"')       // Smart double quotes
        .replace(/(['"])/g, '\\$1')            // Escape existing quotes
        .replace(/\r?\n|\t/g, ' ')             // Normalize whitespace
        .replace(/,\s*([}\]])/g, '$1')         // Remove trailing commas
        .replace(/([{,])(\s*)([A-Za-z0-9_\-]+?)\s*:/g, '$1"$3":'); // Add quotes to keys

      req.body = JSON.parse(sanitized);
      logger.debug('Successfully parsed JSON body');
    } catch (err) {
      const errorPos = parseInt(err.message.match(/position (\d+)/)?.[1]) || 0;
      const sample = req.body.slice(Math.max(0, errorPos-20), errorPos+20);
      
      logger.error('JSON Parse Error', {
        position: errorPos,
        problemArea: sample,
        error: err.message,
        url: req.originalUrl,
        ip: req.ip
      });

      return res.status(400).json({
        error: 'Invalid JSON format',
        position: errorPos,
        problemArea: sample,
        solution: 'Check for unclosed quotes, brackets, or trailing commas',
        documentation: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON'
      });
    }
  }
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type')
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
  logger.debug('Health check performed', healthcheck);
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

// Enhanced error handler
app.use((err, req, res, next) => {
  logger.error('Server Error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body ? JSON.stringify(req.body).slice(0, 500) : null
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
