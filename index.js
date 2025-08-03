import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Load and verify environment
dotenv.config();
if (!process.env.PORT) {
  console.warn('PORT not set, defaulting to 3000');
}

const app = express();

// Enhanced middleware
app.use(cors());
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.use('/tts', chunkRouter);

// Error handling
app.use((err, req, res, next) => {
  const errorId = Date.now();
  console.error(`[${errorId}]`, err);
  
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    errorId,
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || '
