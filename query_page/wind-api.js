const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// Month and year records from the station log, for the values the station
// feed doesn't provide (month/year min temp, year max wind, year rain,
// month/year pressure range). Periods follow New Zealand local time.
// Year aggregates scan up to a year of per-minute rows, so the result is
// cached in memory and recomputed at most every 10 minutes.
const RECORDS_TTL_MS = 10 * 60 * 1000;
let recordsCache = { at: 0, body: null, pending: null };

const RECORDS_SQL = `
WITH bounds AS (
    SELECT
        (date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland') AT TIME ZONE 'Pacific/Auckland') AS month_start,
        (date_trunc('year',  now() AT TIME ZONE 'Pacific/Auckland') AT TIME ZONE 'Pacific/Auckland') AS year_start
),
yr AS (
    SELECT
        u.device_utc_ts,
        CASE WHEN u.temp_out_c    BETWEEN -20 AND 50   THEN u.temp_out_c    END AS temp,
        CASE WHEN u.sea_press_hpa BETWEEN 900 AND 1100 THEN u.sea_press_hpa END AS press,
        CASE WHEN u.wind_max_10   BETWEEN 0 AND 150    THEN u.wind_max_10   END AS gust,
        u.rain_total - LAG(u.rain_total) OVER (ORDER BY u.device_utc_ts)      AS rain_delta
    FROM weather_update u, bounds b
    WHERE u.device_utc_ts >= b.year_start
)
SELECT
    b.month_start,
    b.year_start,
    MIN(yr.device_utc_ts)                                           AS first_sample,
    MIN(yr.temp)  FILTER (WHERE yr.device_utc_ts >= b.month_start)  AS month_min_temp,
    MIN(yr.temp)                                                    AS year_min_temp,
    MAX(yr.temp)                                                    AS year_max_temp,
    MAX(yr.gust)  FILTER (WHERE yr.device_utc_ts >= b.month_start)  AS month_max_wind,
    MAX(yr.gust)                                                    AS year_max_wind,
    MAX(yr.press) FILTER (WHERE yr.device_utc_ts >= b.month_start)  AS month_max_press,
    MIN(yr.press) FILTER (WHERE yr.device_utc_ts >= b.month_start)  AS month_min_press,
    MAX(yr.press)                                                   AS year_max_press,
    MIN(yr.press)                                                   AS year_min_press,
    -- Rain: sum of increases in the station's running total. Drops (counter
    -- resets) and jumps over 25 mm between samples (glitches) are ignored.
    COALESCE(SUM(yr.rain_delta) FILTER (WHERE yr.rain_delta > 0 AND yr.rain_delta < 25), 0) AS year_rain
FROM bounds b
LEFT JOIN yr ON true
GROUP BY b.month_start, b.year_start
`;

function num(v, dp) {
    if (v === null || v === undefined) return null;
    const n = parseFloat(v);
    if (!isFinite(n)) return null;
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
}

async function computeRecords() {
    const { rows } = await pool.query(RECORDS_SQL);
    const r = rows[0];
    return {
        generated_at: new Date().toISOString(),
        month_start: r.month_start,
        year_start: r.year_start,
        first_sample: r.first_sample,
        month: {
            min_temp: num(r.month_min_temp, 1),
            max_wind: num(r.month_max_wind, 0),
            max_press: num(r.month_max_press, 1),
            min_press: num(r.month_min_press, 1),
        },
        year: {
            min_temp: num(r.year_min_temp, 1),
            max_temp: num(r.year_max_temp, 1),
            max_wind: num(r.year_max_wind, 0),
            max_press: num(r.year_max_press, 1),
            min_press: num(r.year_min_press, 1),
            rain: num(r.year_rain, 1),
        },
    };
}

async function getRecords() {
    if (recordsCache.body && Date.now() - recordsCache.at < RECORDS_TTL_MS) return recordsCache.body;
    // Share one in-flight query between concurrent requests.
    if (!recordsCache.pending) {
        recordsCache.pending = computeRecords()
            .then(body => { recordsCache = { at: Date.now(), body, pending: null }; return body; })
            .catch(err => { recordsCache.pending = null; throw err; });
    }
    try {
        return await recordsCache.pending;
    } catch (err) {
        // Serve the last good result if the database is briefly unavailable.
        if (recordsCache.body) return recordsCache.body;
        throw err;
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, headers);
        res.end();
        return;
    }

    const pathname = req.url.split('?')[0];

    if (req.method === 'GET' && pathname === '/api/wind-history') {
        try {
            const result = await pool.query(
                `SELECT device_utc_ts, wind_avg, wind_max_10, wind_xwind
                 FROM weather_update
                 WHERE device_utc_ts >= NOW() - INTERVAL '60 minutes'
                 ORDER BY device_utc_ts ASC`
            );

            const timestamps = result.rows.map(r => r.device_utc_ts);
            const wind_avg = result.rows.map(r => parseFloat(r.wind_avg));
            const wind_gust = result.rows.map(r => parseFloat(r.wind_max_10));
            const wind_xwind = result.rows.map(r => parseFloat(r.wind_xwind));

            res.writeHead(200, headers);
            res.end(JSON.stringify({ timestamps, wind_avg, wind_gust, wind_xwind }));
        } catch (err) {
            console.error('Wind history query error:', err.message);
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: 'Query failed' }));
        }
    } else if (req.method === 'GET' && pathname === '/api/pressure-history') {
        try {
            const result = await pool.query(
                `SELECT device_utc_ts, sea_press_hpa
                 FROM weather_update
                 WHERE device_utc_ts >= NOW() - INTERVAL '12 hours'
                 ORDER BY device_utc_ts ASC`
            );

            const timestamps = result.rows.map(r => r.device_utc_ts);
            const sea_press_hpa = result.rows.map(r => parseFloat(r.sea_press_hpa));

            res.writeHead(200, headers);
            res.end(JSON.stringify({ timestamps, sea_press_hpa }));
        } catch (err) {
            console.error('Pressure history query error:', err.message);
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: 'Query failed' }));
        }
    } else if (req.method === 'GET' && pathname === '/api/records') {
        try {
            const body = await getRecords();
            res.writeHead(200, { ...headers, 'Cache-Control': 'public, max-age=300' });
            res.end(JSON.stringify(body));
        } catch (err) {
            console.error('Records query error:', err.message);
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: 'Query failed' }));
        }
    } else if (req.method === 'GET' && pathname === '/api/runway-timeline') {
        try {
            const result = await pool.query(
                `SELECT device_utc_ts, wind_rwy_fav, wind_avg
                 FROM weather_update
                 WHERE device_utc_ts >= NOW() - INTERVAL '7 days'
                   AND wind_rwy_fav IS NOT NULL
                   AND wind_avg IS NOT NULL
                 ORDER BY device_utc_ts ASC`
            );

            const timestamps = result.rows.map(r => r.device_utc_ts);
            const runway = result.rows.map(r => r.wind_rwy_fav === 'RWY21' ? 1 : 0);
            const wind_avg = result.rows.map(r => parseFloat(r.wind_avg));

            res.writeHead(200, headers);
            res.end(JSON.stringify({ timestamps, runway, wind_avg }));
        } catch (err) {
            console.error('Runway timeline error:', err.message);
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: 'Query failed' }));
        }
    } else if (req.method === 'GET' && pathname === '/api/stats') {
        try {
            function windDirQ(interval) {
                return pool.query(
                    `SELECT
                        CASE
                            WHEN wind_dir_deg_mag >= 337.5 OR wind_dir_deg_mag < 22.5  THEN 'N'
                            WHEN wind_dir_deg_mag >= 22.5  AND wind_dir_deg_mag < 67.5  THEN 'NE'
                            WHEN wind_dir_deg_mag >= 67.5  AND wind_dir_deg_mag < 112.5 THEN 'E'
                            WHEN wind_dir_deg_mag >= 112.5 AND wind_dir_deg_mag < 157.5 THEN 'SE'
                            WHEN wind_dir_deg_mag >= 157.5 AND wind_dir_deg_mag < 202.5 THEN 'S'
                            WHEN wind_dir_deg_mag >= 202.5 AND wind_dir_deg_mag < 247.5 THEN 'SW'
                            WHEN wind_dir_deg_mag >= 247.5 AND wind_dir_deg_mag < 292.5 THEN 'W'
                            WHEN wind_dir_deg_mag >= 292.5 AND wind_dir_deg_mag < 337.5 THEN 'NW'
                        END AS sector,
                        COUNT(*)::integer AS count
                     FROM weather_update
                     WHERE device_utc_ts >= NOW() - $1::interval
                       AND wind_dir_deg_mag IS NOT NULL
                     GROUP BY sector`,
                    [interval]
                );
            }

            function runwayQ(interval) {
                return pool.query(
                    `SELECT wind_rwy_fav AS runway, COUNT(*)::integer AS count
                     FROM weather_update
                     WHERE device_utc_ts >= NOW() - $1::interval
                       AND wind_rwy_fav IS NOT NULL
                     GROUP BY wind_rwy_fav`,
                    [interval]
                );
            }

            const [dir7d, dir365d, rwy24h, rwy7d, rwy365d] = await Promise.all([
                windDirQ('7 days'),
                windDirQ('365 days'),
                runwayQ('24 hours'),
                runwayQ('7 days'),
                runwayQ('365 days'),
            ]);

            res.writeHead(200, headers);
            res.end(JSON.stringify({
                windDir7d:   dir7d.rows,
                windDir365d: dir365d.rows,
                runway24h:   rwy24h.rows,
                runway7d:    rwy7d.rows,
                runway365d:  rwy365d.rows
            }));
        } catch (err) {
            console.error('Stats query error:', err.message);
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: 'Query failed' }));
        }
    } else {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Wind API server running on port ${PORT}`);
});
