# Simplification Suggestions - 2026-02-17

## Current State: 5 Railway Services

| Service | Runtime | File | Purpose |
|---------|---------|------|---------|
| Frontend | Node.js | `serve-frontend.js` | Serves `index.html` |
| CORS Proxy | Node.js | `proxy-server.js` | Proxies weather data + camera images |
| Wind/Pressure API | Node.js | `query_page/wind-api.js` | Queries DB for chart data |
| Query Server | Node.js | `query_page/query-server.js` | Ad-hoc SQL queries |
| Data Collector | Python | `weather_monitor.py` | Polls upstream, stores in Postgres |

5 services + a database for a single-page weather dashboard.

---

## Design Principles

- **Live data stays live.** The frontend continues to fetch `NEmetData.txt` directly from `weather.nsac.co.nz` (via proxy) for all display fields. This avoids any latency penalty from the worker's 30s polling cycle.
- **Calculated fields come from the DB.** Crosswind, favoured runway, and magnetic heading are computed once in the DB trigger — not duplicated in frontend JavaScript. Single source of truth, no risk of divergence.
- **Keep services separate where they have different responsibilities.** The proxy/frontend serves static files and bypasses CORS. The Wind/Pressure API queries the database. These remain independent.

---

## Recommended Changes

### 1. Merge Frontend Server + Proxy into one service (2 services to 1)

`serve-frontend.js` (17 lines) and `proxy-server.js` (191 lines) are both simple Node.js services. Combine into a single Express app that:
- Serves `index.html` and static assets at `/`
- Proxies weather text data at `/proxy?url=...`

Eliminates 1 Railway service and 1 domain. The Wind/Pressure API remains a separate service with its own DB connection.

### 2. Drop the proxy's in-memory cache

The proxy and the browser both cache with a 60s TTL — redundant. Keep only the browser localStorage cache, which provides instant display on page load. The proxy becomes a simple pass-through.

### 3. Stop proxying camera images

`<img>` tags are not subject to CORS restrictions. Camera images can be loaded directly from `weather.nsac.co.nz` without the proxy. This removes unnecessary bandwidth from the Railway bill and reduces proxy load.

### 4. Remove the Query Server service

`query-server.js` accepts arbitrary SQL and is only used by `query.html` for ad-hoc debugging. Remove it as a deployed Railway service. Run it locally when needed instead.

### 5. Use DB-derived calculated fields in the frontend

The DB trigger (`tr_weather_data_parse`) already calculates crosswind, magnetic heading, and favoured runway on every INSERT. The frontend currently recalculates these independently from the raw text data, which could diverge from the DB values.

Add a small endpoint to the Wind/Pressure API (e.g. `/api/current-derived`) that returns:
```json
{ "wind_xwind": 8.2, "wind_rwy_fav": "RWY03", "wind_dir_deg_mag": 342 }
```

The frontend fetches this in parallel with the live proxy data. The client-side crosswind/runway calculation JavaScript is then removed from `index.html`.

### 6. Rewrite the Python worker in Node.js

The Python worker does one thing: fetch a URL every 30s, hash it, and INSERT into Postgres. This is ~30 lines in Node.js. Rewriting eliminates `Dockerfile.python`, `requirements.txt`, and an entire runtime from the deployment. Single language across all services.

---

## Simplified Target Architecture (3 services + DB)

```
Browser
  |
  |-- GET /                --> Frontend+Proxy Server (Node.js)
  |-- GET /proxy?url=...   --> Frontend+Proxy Server (CORS pass-through, no cache)
  |
  |-- GET /api/wind-history    --> Wind/Pressure API (Node.js, queries DB)
  |-- GET /api/pressure-history --> Wind/Pressure API (queries DB)
  |-- GET /api/current-derived  --> Wind/Pressure API (crosswind, runway, mag heading)
  |
  |-- <img src="...">      --> weather.nsac.co.nz (direct, no proxy)

Data Collector (Node.js, setInterval)
  |-- Fetches NEmetData.txt every 30s
  |-- Hashes + INSERTs into weather_data
  |-- DB trigger parses into weather_update

PostgreSQL (Railway-managed)
```

**5 services reduced to 3 services + database.** One Dockerfile, one runtime.

---

## What Changes

| Item | Before | After |
|------|--------|-------|
| Railway services | 5 | 3 |
| Runtimes | Node.js + Python | Node.js only |
| Dockerfiles | 2 | 1 |
| Crosswind calculation | DB trigger + frontend JS (duplicated) | DB trigger only |
| Camera images | Proxied | Direct from source |
| Proxy cache | In-memory 60s TTL | Removed (browser cache sufficient) |
| Query server | Deployed service | Run locally when needed |
| Live weather display | Via proxy (live) | Via proxy (live, unchanged) |

## What Does NOT Change

- **The localStorage cache** - cheap and gives good UX on page load
- **The DB trigger parsing** - solid, keeps the data pipeline clean
- **The 60s browser polling interval** - appropriate for weather data
- **The archiving strategy** - sensible for keeping the DB lean
- **Live data freshness** - browser still reads directly from source via proxy, no worker delay
