// index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mainRoute from './routes/main.js';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/healthz', (_req, res) => res.send('ok'));

// Main route
app.use('/main', mainRoute);

// Start server
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
