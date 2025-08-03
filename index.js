import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chunkRouter from './routes/chunk.js';

dotenv.config();

const app = express();

// Custom JSON parser with quote handling
app.use(express.text({ type: 'application/json', limit: '10mb' }));
app.use((req, res, next) => {
  if (req.is('application/json') {
    try {
      // Pre-process to handle smart quotes and special characters
      const sanitized = req.body
        .replace(/[\u2018\u2019]/g, "'")  // Smart quotes
        .replace(/[\u201C\u201D]/g, '"')  // Smart double quotes
        .replace(/\r?\n/g, ' ');          // Newlines

      req.body = JSON.parse(sanitized);
    } catch (err) {
      const errorPos = parseInt(err.message.match(/position (\d+)/)?.[1] || 0;
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
        solution: 'Escape special characters and ensure proper JSON formatting'
      });
    }
  }
  next();
});

app.use(cors());

// Test endpoint for JSON validation
app.post('/validate-json', (req, res) => {
  res.json({
    valid: true,
    bodyType: typeof req.body,
    sample: req.body.text?.slice(0, 50) || 'No text field'
  });
});

app.use('/tts', chunkRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('JSON validation endpoint: POST /validate-json');
});
