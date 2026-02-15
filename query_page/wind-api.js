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
    if (req.method !== 'GET' || pathname !== '/api/wind-history') {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

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
});

server.listen(PORT, () => {
    console.log(`Wind API server running on port ${PORT}`);
});
