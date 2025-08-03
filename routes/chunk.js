import express from 'express';
const router = express.Router();

// Simple GET endpoint (replace your existing implementation)
router.get('/fast', async (req, res) => {
  try {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: "?text= parameter required" });

    // Your TTS logic here
    res.json({ 
      status: 'success',
      message: 'Endpoint is working',
      text: text.slice(0, 100) // Example response
    });
    
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: "Processing failed" });
  }
});

export default router;
