# Horsimize Backend - Railway Deployment

## Deploy in 5 minutes

### Step 1 - Push to GitHub
Create a new GitHub repo called "horsimize-backend"
Push these files to it

### Step 2 - Connect to Railway
In your Railway project click "New Service" → "GitHub Repo"
Select horsimize-backend
Railway auto-detects Node.js and deploys

### Step 3 - Add Environment Variables
In Railway service → Variables tab, add:

  ANTHROPIC_API_KEY = your_claude_api_key_here
  DATABASE_URL = (Railway injects this automatically from your Postgres service)

### Step 4 - Link your Postgres
In Railway, click your API service → Settings → Connected Services
Link it to your Postgres database
Railway auto-injects DATABASE_URL

### Your API endpoints will be live at:
  https://your-service.railway.app/

GET  /                          → health check
POST /api/users                 → create/login user
GET  /api/horses/:userId        → get all horses
POST /api/horses                → add a horse
PUT  /api/horses/:id            → update a horse
DELETE /api/horses/:id          → delete a horse
POST /api/analyze-feed          → scan a feed tag (THE MAIN EVENT)
GET  /api/scans/:horseId        → scan history for a horse
