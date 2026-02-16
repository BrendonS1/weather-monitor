# Weather Data Monitor for weather.nsac.co.nz

Real-time weather dashboard for North Shore Airport (NZNE) with historical data collection, wind/pressure history charts, and camera feeds.

## Features

- Monitors weather data file for changes every 30 seconds
- SHA256-based duplicate detection (only stores when content changes)
- PostgreSQL database storage with timestamps
- Automatic archiving of records older than 90 days
- CORS proxy for browser access to weather data and camera feeds
- Interactive wind history (60 min) and pressure history (12 hr) charts
- Password-protected database query interface (SELECT only)
- Logging to both file and console

## Architecture

The solution consists of 5 services:

| Service | Type | File | Description |
|---------|------|------|-------------|
| Frontend | Static Site | `index.html` | Main dashboard with charts and camera feeds |
| CORS Proxy | Web Service | `proxy-server.js` | Proxies requests to weather.nsac.co.nz |
| Data Collector | Background Worker | `weather_monitor.py` | Fetches and stores weather data every 30s |
| Query Server | Web Service | `query_page/query-server.js` | Password-protected SQL query interface |
| Wind/Pressure API | Web Service | `query_page/wind-api.js` | Public API for wind and pressure history |

## Tech Stack

- **Frontend:** HTML5, CSS, Plotly.js (2.27.0)
- **Backend:** Python 3 (data collector), Node.js (proxy, APIs)
- **Database:** PostgreSQL
- **Hosting:** Railway

## Project Structure

```
weather-monitor/
├── index.html                  Main dashboard (HTML + JS + CSS)
├── proxy-server.js             CORS proxy service
├── weather_monitor.py          Data collector (Python)
├── requirements.txt            Python dependencies
├── query_page/
│   ├── query.html              Database query UI
│   ├── query-server.js         Query API (password protected)
│   ├── wind-api.js             Wind/pressure history API (public)
│   └── package.json            Node dependencies (pg)
├── Dockerfile.node                 Docker build for Node.js services
├── Dockerfile.python               Docker build for Python worker
├── serve-frontend.js               Static file server for Railway
└── Documentation/
    ├── README.md                   This file
    ├── PROJECT_ARCHITECTURE.txt    System design and diagrams
    ├── RAILWAY_DEPLOYMENT.md       Railway deployment and DB migration guide
    ├── railway-schema.sql          Full database schema migration script
    ├── POSTGRESQL_MIGRATION_GUIDE.md  SQLite to PostgreSQL migration
    ├── PROXY-README.md             CORS proxy setup
    ├── ARCHIVING-AND-POLLING-EXPLAINED.md
    └── VISUAL-STUDIO-CODE-SETUP.md
```

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `DATABASE_URL` | weather_monitor.py, query-server.js, wind-api.js | PostgreSQL connection string |
| `QUERY_PASSWORD` | query-server.js | Password for the query interface |

## Database Schema

The full schema is in `Documentation/railway-schema.sql`.

### weather_data (active records, last 90 days)
- `id` - SERIAL PRIMARY KEY
- `captured_at` - TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- `content_hash` - TEXT (SHA256 for duplicate detection)
- `raw_content` - JSONB (full parsed weather data)
- `file_size` - INTEGER

### weather_data_archive (historical records > 90 days)
- `id` - SERIAL PRIMARY KEY
- `captured_at` - TIMESTAMP
- `content_hash` - TEXT
- `raw_content` - TEXT
- `file_size` - INTEGER
- `archived_at` - TIMESTAMP DEFAULT CURRENT_TIMESTAMP

### weather_update (parsed weather data, populated by trigger)
- `update_id` - BIGINT PRIMARY KEY (FK to weather_data.id)
- `captured_at` - TIMESTAMPTZ
- `device_utc_ts` - TIMESTAMPTZ
- `device_local_ts` - TIMESTAMP
- `wind_speed`, `wind_max_10`, `wind_max_60`, `wind_avg` - NUMERIC
- `wind_dir_deg`, `wind_dir_deg_mag` - INTEGER (true and magnetic heading)
- `wind_rwy_fav` - TEXT (favoured runway: RWY03 or RWY21)
- `wind_xwind` - NUMERIC (crosswind component)
- `temp_out_c`, `hum_out_pct`, `dew_out_c` - NUMERIC
- `press_hpa`, `sea_press_hpa` - NUMERIC
- `raw` - JSONB (full raw data)
- Plus: station, timezone, lan_ip, indoor sensors, rain, battery status

### weather_windtrend / weather_winddirtrend (trend arrays)
- `update_id` - BIGINT (FK to weather_update)
- `idx` - INTEGER (array index)
- `wind` / `dir_deg` - NUMERIC

### Trigger: trg_weather_data_parse
Fires after each INSERT on `weather_data`. Calls `tr_weather_data_parse()` which:
- Parses the JSONB `raw_content` into `weather_update` columns
- Converts true heading to magnetic (NZNE variation 19E)
- Determines favoured runway and calculates crosswind
- Populates wind/direction trend tables

### Indexes
- `idx_captured_at` on weather_data(captured_at)
- `idx_content_hash` on weather_data(content_hash)
- `idx_archive_captured_at` on weather_data_archive(captured_at)

## API Endpoints

### CORS Proxy
`GET /?url=[TARGET]` - Proxies whitelisted URLs from weather.nsac.co.nz

### Wind History API (public)
`GET /api/wind-history` - Returns last 60 minutes of wind data
```json
{ "timestamps": [], "wind_avg": [], "wind_xwind": [] }
```

### Pressure History API (public)
`GET /api/pressure-history` - Returns last 12 hours of pressure data
```json
{ "timestamps": [], "sea_press_hpa": [] }
```

### Query Server (password protected)
`POST /query` - Execute SELECT queries against the database
```json
{ "password": "...", "sql": "SELECT ..." }
```

## Local Development

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
cd query_page && npm install && cd ..

# Run services (each in a separate terminal)
node proxy-server.js          # Port 3000
node query_page/query-server.js  # Port 3001
node query_page/wind-api.js      # Port 3002
python weather_monitor.py        # Background worker
```

Set `DATABASE_URL` and `QUERY_PASSWORD` environment variables before running.

## Usage

```bash
# Run continuously (default: 30 second interval)
python weather_monitor.py

# Run with custom interval
python weather_monitor.py --interval 60

# Run once (for cron/scheduled tasks)
python weather_monitor.py --once

# View statistics
python weather_monitor.py --stats

# Run archiving manually
python weather_monitor.py --archive
```

## License

Free to use and modify as needed.
