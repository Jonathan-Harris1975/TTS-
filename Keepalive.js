const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

async function pingServer() {
  try {
    await axios.get(`${BASE_URL}/health`);
    console.log('Keepalive ping successful');
  } catch (err) {
    console.error('Keepalive ping failed:', err.message);
  }
}

// Ping every 5 minutes (300000ms)
setInterval(pingServer, 300000);

// Initial ping
pingServer();

console.log('Keepalive service started');
