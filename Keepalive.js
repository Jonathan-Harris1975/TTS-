import axios from 'axios';

setInterval(async () => {
  try {
    await axios.get(process.env.KEEPALIVE_URL);
    console.log(`[Keepalive] Pinged ${process.env.KEEPALIVE_URL}`);
  } catch (err) {
    console.error('[Keepalive] Ping failed', err.message);
  }
}, 5 * 60 * 1000); // every 5 minutes
