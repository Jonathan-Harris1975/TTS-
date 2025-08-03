import express from 'express';
import dotenv from 'dotenv';

// 1. Initialize environment
dotenv.config();

// 2. Create basic app
const app = express();

// 3. Add middleware
app.use(express.json());

// 4. Add test endpoint
app.get('/test', (req, res) => {
  console.log('✅ Test endpoint hit');
  res.json({
    status: 'live',
    env: {
      nodeVersion: process.version,
      time: new Date().toISOString()
    }
  });
});

// 5. Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('Environment variables:', {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV
  });
});}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb'
}));
app.get('/health', async (req, res) => {
  const checks = {
    googleAuth: false,
    r2Auth: false,
    ttsReady: false
  };

  try {
    // Test Google auth
    if (ttsClient) {
      await ttsClient.listVoices({});
      checks.googleAuth = true;
    }
    
    // Test R2 auth if configured
    if (r2Client) {
      // Simple R2 check would go here
      checks.r2Auth = true;
    }
    
    checks.ttsReady = checks.googleAuth;
    
    res.json({
      status: checks.ttsReady ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      checks,
      timestamp: new Date().toISOString()
    });
  }
});
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
