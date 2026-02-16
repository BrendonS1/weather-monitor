# Railway Deployment Guide

Guide for deploying the Weather Monitor solution to Railway, including migrating the PostgreSQL schema from Render.

## Prerequisites

- A Railway account (https://railway.com)
- Railway CLI installed (`npm install -g @railway/cli`)
- Git repository connected to Railway

## Step 1: Create the Railway Project

1. Log in to Railway dashboard
2. Click **New Project**
3. Select **Deploy from GitHub repo** and connect your weather-monitor repository
4. Railway will create a project — don't deploy yet, you need to set up the database first

## Step 2: Provision PostgreSQL

1. Inside your Railway project, click **New** > **Database** > **Add PostgreSQL**
2. Railway will provision a PostgreSQL instance and generate a `DATABASE_URL`
3. The connection string is available under the PostgreSQL service's **Variables** tab

## Step 3: Create the Database Schema

Railway's PostgreSQL starts empty. Run the following SQL to create the tables and indexes that the application expects.

Connect to the Railway database using the credentials from the Variables tab:

```bash
# Using Railway CLI
railway link
railway connect postgres

# Or connect directly with psql using the connection string from Railway
psql "your-railway-database-url"
```

Then execute the schema:

```sql
-- Active weather data (last 90 days)
CREATE TABLE IF NOT EXISTS weather_data (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    file_size INTEGER
);

-- Parsed readings (unused, but created by the app)
CREATE TABLE IF NOT EXISTS weather_readings (
    id SERIAL PRIMARY KEY,
    capture_id INTEGER,
    timestamp TIMESTAMP,
    data_json TEXT,
    FOREIGN KEY (capture_id) REFERENCES weather_data(id)
);

-- Archive for records older than 90 days
CREATE TABLE IF NOT EXISTS weather_data_archive (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMP,
    content_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    file_size INTEGER,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parsed wind and pressure data
CREATE TABLE IF NOT EXISTS weather_update (
    device_utc_ts TIMESTAMP,
    wind_avg FLOAT,
    wind_xwind FLOAT,
    sea_press_hpa FLOAT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_captured_at ON weather_data(captured_at);
CREATE INDEX IF NOT EXISTS idx_content_hash ON weather_data(content_hash);
CREATE INDEX IF NOT EXISTS idx_archive_captured_at ON weather_data_archive(captured_at);
```

**Note:** The `weather_data`, `weather_readings`, and `weather_data_archive` tables are auto-created by `weather_monitor.py` on startup. The `weather_update` table must be created manually as it is not part of the auto-init. You can run the full script above to be safe — `IF NOT EXISTS` prevents duplicates.

## Step 4: Deploy the Services

Railway deploys services from the same repo. You need to create **separate services** for each component, each with its own start command.

### 4a. CORS Proxy (Web Service)

1. In your Railway project, click **New** > **GitHub Repo** > select your repo
2. Go to the service **Settings**:
   - **Service Name:** `weather-monitor-proxy`
   - **Start Command:** `node proxy-server.js`
3. Railway auto-assigns a port via the `PORT` environment variable (already used by the code)
4. Under **Networking**, generate a public domain

### 4b. Wind/Pressure API (Web Service)

1. **New** > **GitHub Repo** > select your repo
2. **Settings:**
   - **Service Name:** `weather-monitor-wind-api`
   - **Start Command:** `node query_page/wind-api.js`
3. Under **Variables**, add a reference to the PostgreSQL service's `DATABASE_URL`:
   - Click **New Variable** > **Add Reference** > select the PostgreSQL service > `DATABASE_URL`
4. Under **Networking**, generate a public domain

### 4c. Query Server (Web Service)

1. **New** > **GitHub Repo** > select your repo
2. **Settings:**
   - **Service Name:** `query-weather-db-service`
   - **Start Command:** `node query_page/query-server.js`
3. Under **Variables**:
   - Add `DATABASE_URL` reference (same as above)
   - Add `QUERY_PASSWORD` with your chosen password
4. Under **Networking**, generate a public domain

### 4d. Data Collector (Background Worker)

1. **New** > **GitHub Repo** > select your repo
2. **Settings:**
   - **Service Name:** `weather-monitor-worker`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python weather_monitor.py`
3. Under **Variables**, add `DATABASE_URL` reference
4. No public domain needed — this is a background worker

### 4e. Frontend (Static Site)

Railway doesn't have a dedicated static site type like Render. Options:

**Option A: Serve with a simple Node server**

Create a file `serve-frontend.js` in the repo root:

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    const file = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(__dirname, file);
    const ext = path.extname(filePath);
    const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}).listen(PORT, () => console.log(`Frontend on port ${PORT}`));
```

Then create a service with start command: `node serve-frontend.js`

**Option B: Use Nginx via Nixpacks**

Add a `nixpacks.toml` for the frontend service (more complex, Option A is simpler).

## Step 5: Update Frontend URLs

After all services are deployed and have public domains, update `index.html` to point to the new Railway URLs:

1. Replace the Render proxy URL with your Railway proxy domain
2. Replace the Render wind API URL with your Railway wind API domain

Look for these constants in `index.html` and update them:

```javascript
const PROXY_URL = 'https://your-proxy-service.up.railway.app/?url=';
const WIND_API_URL = 'https://weather-monitor-wind-api-production.up.railway.app/api/wind-history';
const PRESSURE_API_URL = 'https://weather-monitor-wind-api-production.up.railway.app/api/pressure-history';
```

## Step 6: Verify Deployment

1. Check each service's logs in the Railway dashboard for startup errors
2. Visit the frontend URL — the dashboard should load
3. Verify data is flowing:
   - Wind/pressure charts should populate within a few minutes
   - Camera feeds should load via the proxy
   - Check the worker logs to confirm data collection is running

## Railway vs Render: Key Differences

| Feature | Render | Railway |
|---------|--------|---------|
| Static sites | Built-in static site type | Use a simple Node server |
| Database URL | Auto-injected `DATABASE_URL` | Shared via variable references |
| Port | `PORT` env var (same) | `PORT` env var (same) |
| Sleep on free tier | Sleeps after 15 min inactivity | Depends on plan |
| Background workers | Dedicated worker type | Any service (no public domain) |
| Deployments | Auto-deploy on push | Auto-deploy on push |

## Troubleshooting

**Service can't connect to database:**
- Ensure `DATABASE_URL` is added as a variable reference to the PostgreSQL service, not hardcoded
- Check that the PostgreSQL service is running
- Railway's internal networking uses private URLs — use the reference variable, not the public URL

**Port errors:**
- Railway sets the `PORT` environment variable automatically
- All services already use `process.env.PORT`, so this should work out of the box

**Worker keeps restarting:**
- Check logs for Python errors
- Ensure `requirements.txt` dependencies installed correctly
- Verify `DATABASE_URL` is set in the worker's variables

**Frontend can't reach APIs:**
- Ensure each API service has a public domain generated under Networking
- Update the URLs in `index.html` to match the Railway domains
- Check browser console for CORS errors
