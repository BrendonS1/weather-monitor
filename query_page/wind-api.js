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
                `SELECT device_utc_ts, wind_avg, wind_xwind
                 FROM weather_update
                 WHERE device_utc_ts >= NOW() - INTERVAL '60 minutes'
                 ORDER BY device_utc_ts ASC`
            );

            const timestamps = result.rows.map(r => r.device_utc_ts);
            const wind_avg = result.rows.map(r => parseFloat(r.wind_avg));
            const wind_xwind = result.rows.map(r => parseFloat(r.wind_xwind));

            res.writeHead(200, headers);
            res.end(JSON.stringify({ timestamps, wind_avg, wind_xwind }));
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
                     WHERE device_utc_ts >= NOW() - INTERVAL $1
                       AND wind_dir_deg_mag IS NOT NULL
                     GROUP BY sector`,
                    [interval]
                );
            }

            function runwayQ(interval) {
                return pool.query(
                    `SELECT wind_rwy_fav AS runway, COUNT(*)::integer AS count
                     FROM weather_update
                     WHERE device_utc_ts >= NOW() - INTERVAL $1
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
