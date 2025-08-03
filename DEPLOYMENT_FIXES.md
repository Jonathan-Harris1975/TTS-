# TTS Repository - Render Deployment Fixes

## Issues Found and Fixed

### 1. Import Path Case Sensitivity Issue
**Problem**: `index.js` was importing `'./routes/chunk.js'` but the actual file was named `Chunk` (without extension).
**Fix**: 
- Renamed `routes/Chunk` to `routes/Chunk.js`
- Updated import in `index.js` to `'./routes/Chunk.js'`

### 2. Missing Logs Directory
**Problem**: Winston logger was configured to write to `logs/combined.log` but the directory didn't exist.
**Fix**: Created `logs/` directory to prevent logging errors.

### 3. Missing Environment Configuration
**Problem**: No `.env` file was present, which could cause issues with environment variables.
**Fix**: Created `.env` file with default configuration based on `.env.example`.

### 4. Production Logging Configuration
**Problem**: File logging in production environments can cause issues on platforms like Render.
**Fix**: Modified winston configuration to only use file logging in non-production environments.

### 5. Missing Deployment Files
**Problem**: No `.gitignore` or deployment configuration files.
**Fix**: 
- Added comprehensive `.gitignore` file
- Created `render.yaml` for explicit Render deployment configuration

## Deployment Instructions for Render

1. **Push to GitHub**: Commit all changes and push to a GitHub repository.

2. **Create Render Web Service**:
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

3. **Configure Service**:
   - **Name**: Choose a unique name (will become your URL)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or paid as needed)

4. **Environment Variables** (Optional):
   Add these in Render dashboard if you need cloud services:
   ```
   NODE_ENV=production
   LOG_LEVEL=info
   
   # For Google Cloud TTS (optional)
   GOOGLE_CREDENTIALS={"type":"service_account"...}
   GCP_PROJECT_ID=your-project-id
   GCP_LOCATION=us-central1
   
   # For Cloudflare R2 Storage (optional)
   R2_ACCESS_KEY=your-access-key
   R2_SECRET_KEY=your-secret-key
   R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
   R2_BUCKET=your-bucket-name
   R2_PUBLIC_BASE_URL=https://your-public-url
   ```

5. **Deploy**: Click "Create Web Service" and wait for deployment to complete.

## API Endpoints

Once deployed, your service will have these endpoints:

- `GET /health` - Health check endpoint
- `POST /tts/chunked` - Main TTS processing endpoint
- `GET /tts/chunked/fast` - Fast TTS endpoint with query parameters

## Testing

The application has been tested locally and all endpoints are working correctly:
- ✅ Server starts without errors
- ✅ Health endpoint responds correctly
- ✅ TTS endpoints accept requests and return responses
- ✅ Logging works properly
- ✅ Environment variables are loaded correctly

## Notes

- The current implementation includes placeholder TTS functionality
- To enable full TTS capabilities, configure Google Cloud TTS and/or R2 storage
- The service uses rate limiting (100 requests per 15 minutes per IP)
- CORS is enabled for all origins by default
- Logs are written to console in production, files in development

