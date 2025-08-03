import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Initialize and validate environment
dotenv.config();

// Validate required environment variables
const validateEnvironment = () => {
  const requiredVars = {
    GOOGLE_CREDENTIALS: 'Google Cloud credentials',
    PORT: 'Server port'
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([key]) => !process.env[key])
    .map(([_, name]) => name);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }

  // Validate JSON credentials
  try {
    JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (err) {
    console.error('❌ Invalid GOOGLE_CREDENTIALS JSON:', {
      error: err.message,
      sample: process.env.GOOGLE_CREDENTIALS?.slice(0, 100) + '...'
    });
    process.exit(1);
  }
};

validateEnvironment();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      google: !!process.env.GOOGLE_CREDENTIALS,
      r2: !!process.env.R2_ACCESS_KEY
    }
  });
});

app.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Service is operational',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/tts', chunkRouter);

// Error handling
app.use((err, req, res, next) => {
  const errorId = Date.now();
  console.error(`[${errorId}]`, {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal Server Error',
    errorId,
    ...(process.env.NODE_ENV !== 'production' && { details: err.message })
  });
});

// Start server
const serverPort = parseInt(process.env.PORT) || 3000;
app.listen(serverPort, () => {
  console.log(`🚀 Server running on port ${serverPort}`);
  console.log(`🛠️  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🔍 Monitoring ready at /health');
});
