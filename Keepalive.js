import axios from 'axios';

const KEEPALIVE_URL = process.env.KEEPALIVE_URL;

if (!KEEPALIVE_URL) {
  console.error('[Keepalive] KEEPALIVE_URL is not set in environment variables.');
  process.exit(1);
}

setInterval(async () => {
  try {
    await axios.get(KEEPALIVE_URL);
    console.log(`[Keepalive] Pinged ${KEEPALIVE_URL} at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[Keepalive] Ping failed:', err.message);
  }
}, 5 * 60 * 1000); // every 5 minutes
