const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3001;
const QUERY_PASSWORD = process.env.QUERY_PASSWORD;
const DATABASE_URL = process.env.DATABASE_URL;

if (!QUERY_PASSWORD) {
    console.error('QUERY_PASSWORD environment variable is required');
    process.exit(1);
}

if (!DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function isSelectOnly(sql) {
    const trimmed = sql.trim().replace(/;+$/, '').trim();
    // Strip leading comments (-- and /* */) then check first keyword
    const stripped = trimmed
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
    return /^SELECT\b/i.test(stripped);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // CORS headers on every response
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') {
        res.writeHead(200, headers);
        res.end();
        return;
    }

    if (req.method !== 'POST' || req.url !== '/query') {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    try {
        const { password, sql } = await parseBody(req);

        if (!password || password !== QUERY_PASSWORD) {
            res.writeHead(403, headers);
            res.end(JSON.stringify({ error: 'Invalid password' }));
            return;
        }

        if (!sql || typeof sql !== 'string') {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: 'Missing sql parameter' }));
            return;
        }

        if (!isSelectOnly(sql)) {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: 'Only SELECT queries are allowed' }));
            return;
        }

        const result = await pool.query(sql);
        const columns = result.fields.map(f => f.name);
        const rows = result.rows.map(row => columns.map(c => row[c]));

        res.writeHead(200, headers);
        res.end(JSON.stringify({ columns, rows }));
    } catch (err) {
        console.error('Query error:', err.message);
        res.writeHead(500, headers);
        res.end(JSON.stringify({ error: 'Query failed. Check your SQL syntax.' }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Query server running on port ${PORT}`);
});
