import express from 'express';
const router = express.Router();

// POST /tts/chunked
router.post('/chunked', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    res.json({ 
      status: 'success',
      message: 'TTS processing simulated',
      text: text.slice(0, 100)
    });

  } catch (err) {
    res.status(500).json({ 
      error: "Processing failed",
      message: err.message
    });
  }
});

// GET /tts/chunked/fast
router.get('/chunked/fast', async (req, res) => {
  try {
    const { text } = req.query;
    
    if (!text) {
      return res.status(400).json({ error: "text query parameter is required" });
    }

    res.json({ 
      status: 'success',
      message: 'GET endpoint is working',
      text: text.slice(0, 100)
    });
    
  } catch (err) {
    res.status(500).json({ 
      error: "Processing failed",
      message: err.message
    });
  }
});

export default router;
