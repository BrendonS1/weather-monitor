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

Railway's PostgreSQL starts empty. The full schema migration script is provided at `Documentation/railway-schema.sql`. This includes all tables, indexes, the trigger function, and the trigger.

**Important:** Run the migration script *before* deploying the worker service. If the worker starts first, `weather_monitor.py` will auto-create the `weather_data` table with incorrect column types (TEXT instead of JSONB for `raw_content`), which will cause the trigger to fail.

Connect to the Railway database and run the migration:

```bash
# Using Railway CLI
railway link
railway connect postgres

# Then paste the contents of Documentation/railway-schema.sql

# Or run it directly with psql
psql "your-railway-database-url" -f Documentation/railway-schema.sql
```

The migration creates:

| Object | Type | Description |
|--------|------|-------------|
| `weather_data` | Table | Raw JSONB snapshots (active, last 90 days) |
| `weather_data_archive` | Table | Archived snapshots older than 90 days |
| `weather_update` | Table | Parsed weather data (30+ columns, populated by trigger) |
| `weather_windtrend` | Table | Wind trend array data |
| `weather_winddirtrend` | Table | Wind direction trend array data |
| `tr_weather_data_parse()` | Function | Parses raw JSONB into weather_update, calculates magnetic heading, favoured runway, and crosswind |
| `trg_weather_data_parse` | Trigger | Fires after each INSERT on weather_data, calls the parse function |

**Note:** The `weather_data` and `weather_data_archive` tables are also auto-created by `weather_monitor.py` on startup, but the trigger, function, `weather_update`, `weather_windtrend`, and `weather_winddirtrend` tables must be created via the migration script.

## Step 4: Dockerfiles

Railway's auto-detect builder (Railpack) gets confused when a repo contains both Python and Node.js files (`package.json` and `requirements.txt` in the same root). To avoid this, the repo includes two Dockerfiles — one per runtime. Each service **must** be configured to use the Dockerfile builder, not Railpack.

### Dockerfile.node (for proxy, wind-api, query-server, frontend)

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json ./
COPY query_page/package.json ./query_page/
RUN npm install
COPY . .
```

### Dockerfile.python (for the data collector worker)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "weather_monitor.py"]
```

## Step 5: Deploy the Services

Railway deploys services from the same repo. You need to create **separate services** for each component. For each service, set the **Builder** to **Dockerfile** in the service Settings and point it to the correct Dockerfile.

**Important:** All Node.js services must bind to `0.0.0.0` (not localhost) for Railway's networking to route traffic. This is already done in the code via `.listen(PORT, '0.0.0.0', ...)`.

### 5a. CORS Proxy (Web Service)

1. In your Railway project, click **New** > **GitHub Repo** > select your repo
2. Go to the service **Settings** > **Build**:
   - **Builder:** Dockerfile
   - **Dockerfile Path:** `Dockerfile.node`
   - **Start Command:** `node proxy-server.js`
   - **Service Name:** `weather-monitor-proxy`
3. Under **Variables**, add `PORT=8080`
4. Under **Networking**, generate a public domain (enter port `8080` when prompted)

### 5b. Wind/Pressure API (Web Service)

1. **New** > **GitHub Repo** > select your repo
2. **Settings** > **Build**:
   - **Builder:** Dockerfile
   - **Dockerfile Path:** `Dockerfile.node`
   - **Start Command:** `node query_page/wind-api.js`
   - **Service Name:** `weather-monitor-wind-api`
3. Under **Variables**:
   - Add `PORT=8080`
   - Add a reference to the PostgreSQL service's `DATABASE_URL`: click **New Variable** > **Add Reference** > select the PostgreSQL service > `DATABASE_URL`
4. Under **Networking**, generate a public domain (enter port `8080` when prompted)

### 5c. Query Server (Web Service)

1. **New** > **GitHub Repo** > select your repo
2. **Settings** > **Build**:
   - **Builder:** Dockerfile
   - **Dockerfile Path:** `Dockerfile.node`
   - **Start Command:** `node query_page/query-server.js`
   - **Service Name:** `query-weather-db-service`
3. Under **Variables**:
   - Add `PORT=8080`
   - Add `DATABASE_URL` reference (same as above)
   - Add `QUERY_PASSWORD` with your chosen password
4. Under **Networking**, generate a public domain (enter port `8080` when prompted)

### 5d. Data Collector (Background Worker)

1. **New** > **GitHub Repo** > select your repo
2. **Settings** > **Build**:
   - **Builder:** Dockerfile
   - **Dockerfile Path:** `Dockerfile.python`
   - **Service Name:** `weather-monitor-worker`
3. Under **Variables**, add `DATABASE_URL` reference
4. No public domain needed — this is a background worker
5. The start command is set in the Dockerfile (`CMD ["python", "weather_monitor.py"]`)

### 5e. Frontend (Static Site)

Railway doesn't have a dedicated static site type like Render. The repo includes `serve-frontend.js`, a simple Node.js static file server.

1. **New** > **GitHub Repo** > select your repo
2. **Settings** > **Build**:
   - **Builder:** Dockerfile
   - **Dockerfile Path:** `Dockerfile.node`
   - **Start Command:** `node serve-frontend.js`
   - **Service Name:** `weather-monitor-frontend`
3. Under **Variables**, add `PORT=8080`
4. Under **Networking**, generate a public domain (enter port `8080` when prompted)

## Step 6: Update Frontend URLs

After all services are deployed and have public domains, update `index.html` to point to the new Railway URLs. **Include the `https://` protocol** — without it, the browser treats them as relative paths.

Look for these constants in `index.html` and update them:

```javascript
const PROXY_URL = 'https://your-proxy-service.up.railway.app/?url=';
const WIND_API_URL = 'https://weather-monitor-wind-api-production.up.railway.app/api/wind-history';
const PRESSURE_API_URL = 'https://weather-monitor-wind-api-production.up.railway.app/api/pressure-history';
```

## Step 7: Verify Deployment

1. Check each service's logs in the Railway dashboard for startup errors
2. Visit the frontend URL — the dashboard should load
3. Verify data is flowing:
   - Wind/pressure charts should populate within a few minutes
   - Camera feeds should load via the proxy
   - Check the worker logs to confirm data collection is running

## Railway vs Render: Key Differences

| Feature | Render | Railway |
|---------|--------|---------|
| Static sites | Built-in static site type | Use a Node server (`serve-frontend.js`) |
| Build system | Auto-detect | Must use Dockerfile for mixed-runtime repos |
| Mixed runtimes | Handled per-service type | Separate Dockerfiles (`Dockerfile.node`, `Dockerfile.python`) |
| Database URL | Auto-injected `DATABASE_URL` | Shared via variable references |
| Port binding | Automatic | Must bind to `0.0.0.0`; set `PORT` variable explicitly |
| Network port | Auto-detected | Must specify port when generating public domain |
| Background workers | Dedicated worker type | Any service (no public domain) |
| Deployments | Auto-deploy on push | Auto-deploy on push (connected to branch) |

## Troubleshooting

**"No start command found" or wrong runtime detected:**
- Ensure the service's **Builder** is set to **Dockerfile** (not Railpack)
- Verify the **Dockerfile Path** points to the correct file (`Dockerfile.node` or `Dockerfile.python`)
- Railpack auto-detect picks the wrong runtime when both `package.json` and `requirements.txt` exist in the repo root

**502 Bad Gateway or "Application failed to respond":**
- Check that `PORT` is set as a variable (e.g. `PORT=8080`) and the Networking port matches
- Verify the server binds to `0.0.0.0`, not just localhost — Railway can't route to `127.0.0.1`
- Check deploy logs to confirm the service started and is listening

**JSONB / trigger errors (operator does not exist: text ->> unknown):**
- The `weather_data.raw_content` column must be `JSONB`, not `TEXT`
- If the worker auto-created the table before the migration script ran, fix it with:
  ```sql
  ALTER TABLE weather_data ALTER COLUMN raw_content TYPE JSONB USING raw_content::jsonb;
  ```
- Always run the migration script *before* starting the worker for the first time

**Service can't connect to database:**
- Ensure `DATABASE_URL` is added as a variable reference to the PostgreSQL service, not hardcoded
- Check that the PostgreSQL service is running

**Deployment not updating after push:**
- Verify the service is connected to the correct GitHub repo and branch in **Settings** > **Source**
- If a deployment shows as "successful" but isn't active, delete the service and recreate it
- To force a redeploy: `git commit --allow-empty -m "trigger redeploy" && git push origin railway`

**Frontend can't reach APIs:**
- Ensure each API service has a public domain generated under Networking
- Update the URLs in `index.html` to match the Railway domains — include `https://` protocol
- Check browser console for CORS errors
