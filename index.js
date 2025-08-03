import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import chunkRouter from './routes/chunk.js'; // Corrected import path

// Initialize environment
dotenv.config();

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  ]
});

const app = express();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced logging middleware
app.use((req, res, next) => {
  logger.debug(`Incoming: ${req.method} ${req.originalUrl}`);
  next();
});

// Route mounting with debug logging
app.use('/tts', (req, res, next) => {
  logger.debug(`Routing to TTS: ${req.method} ${req.path}`);
  next();
}, chunkRouter);

// Debug endpoint to list all routes
app.get('/debug-routes', (req, res) => {
  const routes = [
    'POST /tts/chunked',
    'GET /tts/chunked/fast?text=YOUR_TEXT',
    'GET /health',
    'GET /debug-routes'
  ];
  res.json({ 
    status: 'success',
    routes,
    mountPath: '/tts'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage()
  });
});

// 404 Handler
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'POST /tts/chunked',
      'GET /tts/chunked/fast?text=YOUR_TEXT',
      'GET /health',
      'GET /debug-routes'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Server Error: ${err.stack}`);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  logger.info('Available endpoints:');
  logger.info('- POST /tts/chunked');
  logger.info('- GET /tts/chunked/fast?text=YOUR_TEXT');
  logger.info('- GET /health');
  logger.info('- GET /debug-routes');
});
