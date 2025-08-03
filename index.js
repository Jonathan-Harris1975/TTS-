import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Initialize environment
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Service is running',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    services: {
      r2: !!process.env.R2_ACCESS_KEY,
      google: !!process.env.GOOGLE_CREDENTIALS
    }
  });
});

// API routes
app.use('/tts', chunkRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});// API routes
app.use('/tts', chunkRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
