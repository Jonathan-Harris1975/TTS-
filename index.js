import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Initialize environment with validation
dotenv.config();

// Verify required environment variables
const requiredVars = ['GOOGLE_CREDENTIALS', 'PORT'];
const missingVars = requiredVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

// Validate Google credentials format
try {
  JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (err) {
  console.error('❌ Invalid GOOGLE_CREDENTIALS JSON:', {
    error: err.message,
    sample: process.env.GOOGLE_CREDENTIALS?.slice(180, 200) // Show problem area
  });
  process.exit(1);
}

const app = express();

// Enhanced middleware with JSON validation
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      if (buf.length) JSON.parse(buf.toString());
    } catch (e) {
      const errorPos = parseInt(e.message.match(/position (\d+)/)?.[1]) || 0;
      console.error('❌ Invalid JSON received:', {
        sample: buf.toString().slice(Math.max(0, errorPos-20), errorPos+20),
        error: e.message
      });
      throw new Error(`Invalid JSON at position ${errorPos}`);
    }
  }
}));

app.use(cors());
app.use(express.urlencoded({ extended: true }));

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

// Test endpoint with JSON validation
app.post('/validate-json', (req, res) => {
  res.json({
    status: 'valid',
    bodyKeys: Object.keys(req.body),
    length: JSON.stringify(req.body).length
  });
});

// API routes
app.use('/tts', chunkRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  const errorId = Date.now();
  const errorResponse = {
    error: 'Internal Server Error',
    errorId,
    path: req.path,
    method: req.method,
    ...(process.env.NODE_ENV !== 'production' && { details: err.message })
  };

  console.error(`[${errorId}]`, {
    message: err.message,
    stack: err.stack,
    body: req.body ? '***' : 'empty'
  });

  res.status(500).json(errorResponse);
});

// Start server
const port = parseInt(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`
  🚀 Server running on port ${port}
  🛠️  Environment: ${process.env.NODE_ENV || 'development'}
  📊 Monitoring: /health
  🧪 JSON Test: POST /validate-json
  `);
});
