import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Initialize environment with validation
dotenv.config();

const requiredEnvVars = [
  'R2_ACCESS_KEY',
  'R2_SECRET_KEY',
  'R2_ENDPOINT',
  'GOOGLE_CREDENTIALS'
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  process.exit(1);
}

console.log('✅ Environment variables verified');

const app = express();

// Enhanced middleware
app.use(cors());
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      if (buf.length) JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON body');
    }
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb'
}));

// Routes
app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    services: {
      r2: !!process.env.R2_ACCESS_KEY,
      google: !!process.env.GOOGLE_CREDENTIALS
    },
    timestamp: new Date().toISOString()
  });
});

app.use('/tts', chunkRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  const errorId = Date.now();
  console.error(`[${errorId}]`, {
    message: err.message,
    stack: err.stack,
    request: {
      method: req.method,
      url: req.url,
      query: req.query,
      body: Object.keys(req.body || {}).length ? '***' : 'empty'
    }
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    errorId,
    ...(process.env.NODE_ENV !== 'production' && { details: err.message })
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌎 Environment: ${process.env.NODE_ENV || 'development'}`);
});
