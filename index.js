// Updated JSON middleware in index.js
app.use(express.text({ type: 'application/json', limit: '10mb' }));
app.use((req, res, next) => {
  if (req.is('application/json')) {
    try {
      // Trim whitespace and remove any byte order mark (BOM)
      let body = req.body.trim();
      if (body.charCodeAt(0) === 0xFEFF) {
        body = body.substring(1);
      }
      
      // Handle common JSON formatting issues
      const sanitized = body
        .replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '') // Trim all Unicode whitespace
        .replace(/[\u2018\u2019]/g, "'")  // Convert smart single quotes
        .replace(/[\u201C\u201D]/g, '"')  // Convert smart double quotes
        .replace(/\r?\n|\t/g, ' ')        // Normalize whitespace
        .replace(/,\s*([}\]])/g, '$1')    // Remove trailing commas
        .replace(/([{,])(\s*)([A-Za-z0-9_\-]+?)\s*:/g, '$1"$3":'); // Add quotes to keys

      req.body = JSON.parse(sanitized);
    } catch (err) {
      const errorPos = parseInt(err.message.match(/position (\d+)/)?.[1]) || 0;
      const sample = req.body.slice(Math.max(0, errorPos-20), errorPos+20);
      
      console.error('JSON Parse Error:', {
        position: errorPos,
        problemArea: sample,
        fullError: err.message,
        rawBody: req.body.slice(0, 200) + (req.body.length > 200 ? '...' : '')
      });

      return res.status(400).json({
        error: 'Invalid JSON format',
        position: errorPos,
        problemArea: sample,
        solution: 'Check for unclosed quotes, brackets, or trailing commas',
        documentation: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON'
      });
    }
  }
  next();
});
