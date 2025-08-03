import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

// Initialize environment
dotenv.config();

const app = express();

// Middleware to handle JSON parsing with better error messages
app.use(express.text({ type: 'application/json', limit: '10mb' }));
app.use((req, res, next) => {
  if (req.is('application/json')) {
    try {
      // Pre-process to handle common JSON issues
      const sanitized = req.body
        .replace(/[\u2018\u2019]/g, "'")  // Convert smart single quotes
        .replace(/[\u201C\u201D]/g, '"')  // Convert smart double quotes
        .replace(/\r?\n/g, ' ')           // Replace newlines
        .replace(/\\"/g, '"')             // Handle escaped quotes
        .replace(/\t/g, ' ');             // Replace tabs

      req.body = JSON.parse(sanitized);
    } catch (err) {
      const errorPos = parseInt(err.message.match(/position (\d+)/)?.[1]) || 0;
      const sample = req.body.slice(Math.max(0, errorPos-20), errorPos+20);
      
      console.error('JSON Parse Error:', {
        position: errorPos,
        problemArea: sample,
        fullError: err.message
      });

      return res.status(400).json({
        error: 'Invalid JSON format',
        position: errorPos,
        problemArea: sample,
        solution: 'Check for unclosed quotes, brackets, or trailing commas'
      });
    }
  }
  next();
});

app.use(cors());

// Test endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// JSON validation endpoint
app.post('/validate-json', (req, res) => {
  res.json({
    valid: true,
    body: req.body
  });
});

// API routes
app.use('/tts', chunkRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    details: process.env.NODE_ENV !== 'production' ? err.message : undefined
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('POST /validate-json to test your JSON formatting');
});
