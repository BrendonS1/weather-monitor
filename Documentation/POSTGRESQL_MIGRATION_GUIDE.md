# PostgreSQL Migration Guide for Weather Monitor

## Key Changes Made

### 1. Database Connection
**OLD (SQLite):**
```python
conn = sqlite3.connect('weather_data.db')
```

**NEW (PostgreSQL):**
```python
DATABASE_URL = os.environ.get('DATABASE_URL')  # Render provides this
conn = psycopg2.connect(DATABASE_URL)
```

### 2. SQL Syntax Changes
**Placeholders:**
- SQLite: `?` → PostgreSQL: `%s`
- Example: `WHERE content_hash = ?` → `WHERE content_hash = %s`

**Auto-increment:**
- SQLite: `INTEGER PRIMARY KEY AUTOINCREMENT` → PostgreSQL: `SERIAL PRIMARY KEY`

**Date Functions:**
- SQLite: `datetime('now', '-90 days')` → PostgreSQL: `NOW() - INTERVAL '90 days'`

**RETURNING clause:**
- SQLite: `cursor.lastrowid` → PostgreSQL: `RETURNING id`

### 3. Requirements Update
Added to requirements.txt:
```
psycopg2-binary>=2.9.9
```

## Deployment Steps on Render

### Step 1: Create PostgreSQL Database
1. Render Dashboard → **New +** → **PostgreSQL**
2. Name: `weather-monitor-db`
3. Plan: **Free**
4. Click **Create Database**
5. **Copy the "Internal Database URL"** (looks like: `postgresql://user:pass@host/db`)

### Step 2: Update Your GitHub Repo
1. Replace `weather_monitor.py` with the new PostgreSQL version
2. Update `requirements.txt` with the new version
3. Commit and push to GitHub

### Step 3: Create Background Worker on Render
1. Render Dashboard → **New +** → **Background Worker**
2. Connect to your GitHub repo: `BrendonS1/weather-monitor`
3. **Name**: `weather-monitor-worker`
4. **Runtime**: Python 3
5. **Build Command**: `pip install -r requirements.txt`
6. **Start Command**: `python weather_monitor.py`
7. **Environment Variables** → Add:
   - Key: `DATABASE_URL`
   - Value: (paste the Internal Database URL from Step 1)
8. Click **Create Background Worker**

### Step 4: Deploy Other Services

#### Static Site (Frontend):
1. **New +** → **Static Site**
2. Connect to `BrendonS1/weather-monitor`
3. **Publish Directory**: `.`
4. Click **Create Static Site**

#### Web Service (Proxy):
1. **New +** → **Web Service**
2. Connect to `BrendonS1/weather-monitor`
3. **Runtime**: Node
4. **Start Command**: `node proxy-server.js`
5. Add any needed environment variables
6. Click **Create Web Service**

## Important Notes

### Free Tier Limitations:
- **Background Worker**: Will sleep after 15 minutes of inactivity on free tier
- **Solution**: Upgrade to paid plan ($7/month) for 24/7 operation
- **PostgreSQL Free Tier**: Database expires after 90 days, then needs to be recreated

### Database URL Security:
- Never hardcode the DATABASE_URL in your code
- Always use environment variables
- Render automatically provides DATABASE_URL to your services

### Connection Management:
- PostgreSQL connections should be opened and closed per operation
- The code creates a new connection for each operation to avoid connection pool issues
- This is efficient for your 30-second interval

## Testing Locally (Optional)

To test locally before deploying:

1. Install PostgreSQL on your machine
2. Create a local database
3. Set environment variable:
   ```bash
   export DATABASE_URL="postgresql://localhost/weather_data"
   ```
4. Run the script:
   ```bash
   python weather_monitor.py
   ```

## Migration Checklist

- [ ] Create PostgreSQL database on Render
- [ ] Copy the Internal Database URL
- [ ] Update weather_monitor.py in your repo
- [ ] Update requirements.txt in your repo
- [ ] Commit and push changes
- [ ] Create Background Worker on Render
- [ ] Add DATABASE_URL environment variable
- [ ] Deploy and verify logs show successful connection
- [ ] Check database contains data after first run

## Troubleshooting

**Error: "DATABASE_URL environment variable is not set"**
- Make sure you added the DATABASE_URL in the environment variables section

**Error: "psycopg2 not found"**
- Verify requirements.txt includes `psycopg2-binary>=2.9.9`
- Check build logs to ensure it installed successfully

**No data appearing in database:**
- Check worker logs for errors
- Verify DATABASE_URL is correct
- Ensure weather URL is accessible

**Worker keeps sleeping (free tier):**
- This is expected on free tier
- Upgrade to paid plan for continuous operation
