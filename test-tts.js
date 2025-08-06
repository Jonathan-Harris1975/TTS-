import axios from 'axios';

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const SAMPLE_TEXT = 'This is a test of the TTS to R2 pipeline.';

async function testEndpoint(endpoint, text) {
  try {
    const res = endpoint.includes('fast')
      ? await axios.get(`${BASE_URL}${endpoint}?text=${encodeURIComponent(text)}`)
      : await axios.post(`${BASE_URL}${endpoint}`, { text });
    console.log(`[${endpoint}]`, res.data);
  } catch (err) {
    console.error(`[${endpoint}] ERROR:`, err.response?.data || err.message);
  }
}

(async () => {
  await testEndpoint('/tts/chunked', SAMPLE_TEXT);
  await testEndpoint('/tts/chunked/fast', SAMPLE_TEXT);
})();
