// Simple CORS proxy server for North Shore Airport weather data
// This  fetches data from weather.nsac.co.nz and serves it with CORS headers

const http = require('http');
const https = require('https');
const url = require('url');

// Render provides PORT via environment variable
const PORT = process.env.PORT || 3000;

const ALLOWED_URLS = [
    'http://weather.nsac.co.nz/NEmetData.txt',
    'http://weather.nsac.co.nz/awibexport.txt',
    'http://weather.nsac.co.nz/cams/CamInfo.txt',
    'http://weather.nsac.co.nz/cams/',  // Allow all camera images
    // openAIP's nightly NZ airspace export. The old Google bucket
    // (storage.googleapis.com/29f98e10-...) became Requester Pays in July 2026
    // and refuses anonymous downloads; openAIP serves the same files here.
    'https://s3.openaip.net/openaip-system-exports/nz_asp.geojson',
];

// Longer cache for files that change at most daily, to go easy on the
// rate-limited openAIP host. Everything else uses CACHE_DURATION.
const LONG_CACHE = [
    { prefix: 'https://s3.openaip.net/', ms: 6 * 60 * 60 * 1000 },
];

function cacheDurationFor(targetUrl) {
    const rule = LONG_CACHE.find(r => targetUrl.startsWith(r.prefix));
    return rule ? rule.ms : CACHE_DURATION;
}

// Cache configuration
const cache = new Map();
const CACHE_DURATION = 60000; // 60 seconds (matches NemetData update frequency)
const MAX_CACHE_SIZE = 50;

function getCacheKey(targetUrl) {
    try {
        const u = new URL(targetUrl);
        u.searchParams.delete('t');
        u.searchParams.delete('_');
        return u.toString();
    } catch {
        return targetUrl;
    }
}

function getCachedData(targetUrl) {
    const key = getCacheKey(targetUrl);
    const cached = cache.get(key);
    
    if (!cached) return null;
    
    const now = Date.now();
    const age = now - cached.timestamp;
    
    // Return cached data if it's fresh enough
    if (age < cacheDurationFor(targetUrl)) {
        console.log(`Cache HIT for ${targetUrl} (age: ${Math.round(age/1000)}s)`);
        return cached;
    }
    
    console.log(`Cache EXPIRED for ${targetUrl} (age: ${Math.round(age/1000)}s)`);
    return null;
}

function setCachedData(targetUrl, data, isBinary, contentType) {
    const key = getCacheKey(targetUrl);
    if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
        console.log(`Cache evicted (size limit): ${oldestKey}`);
    }
    cache.set(key, {
        data: data,
        isBinary: isBinary,
        contentType: contentType,
        timestamp: Date.now()
    });
    console.log(`Cache SET for ${key}`);
}

function isAllowedUrl(targetUrl) {
    // Allow exact matches
    for (const allowed of ALLOWED_URLS) {
        if (targetUrl === allowed || targetUrl.startsWith(allowed)) {
            return true;
        }
    }
    
    // Specifically allow camera images (any .jpg in cams folder)
    if (targetUrl.startsWith('http://weather.nsac.co.nz/cams/') && 
        (targetUrl.includes('.jpg') || targetUrl.includes('.jpeg') || targetUrl.includes('.png'))) {
        return true;
    }
    
    return false;
}

const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // Parse the target URL from query parameter
    const parsedUrl = url.parse(req.url, true);

    // ── ADS-B Exchange proxy ────────────────────────────────────────────────
    if (parsedUrl.pathname === '/api/adsb') {
        const apiKey = process.env.ADSB_API_KEY;
        if (!apiKey) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'ADSB_API_KEY not configured on server' }));
            return;
        }
        const { lat, lon, dist } = parsedUrl.query;
        if (!lat || !lon || !dist) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Missing lat, lon or dist query params' }));
            return;
        }
        const adsbUrl = `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/${dist}/`;
        console.log(`ADS-B proxy request: ${adsbUrl}`);
        https.get(adsbUrl, {
            headers: {
                'x-rapidapi-host': 'adsbexchange-com1.p.rapidapi.com',
                'x-rapidapi-key': apiKey,
            }
        }, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => { data += chunk; });
            proxyRes.on('end', () => {
                res.writeHead(proxyRes.statusCode, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(data);
            });
        }).on('error', (err) => {
            console.error('ADS-B proxy error:', err);
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }
    // ───────────────────────────────────────────────────────────────────────

    const targetUrl = parsedUrl.query.url;

    if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing url parameter');
        return;
    }

    if (!isAllowedUrl(targetUrl)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('URL not allowed');
        return;
    }

    // Check cache first
    const cached = getCachedData(targetUrl);
    if (cached) {
        const headers = {
            'Content-Type': cached.contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cache-Control': 'public, max-age=60',
            'X-Cache': 'HIT'
        };
        
        res.writeHead(200, headers);
        res.end(cached.data);
        return;
    }

    console.log(`Proxying request to: ${targetUrl}`);

    // Fetch the data from the target URL
    const protocol = targetUrl.startsWith('https') ? https : http;
    
    protocol.get(targetUrl, (proxyRes) => {
        // Collect raw bytes for every response. Joining text chunks as strings
        // can split multi-byte characters (macrons in place names).
        const chunks = [];
        const contentType = proxyRes.headers['content-type'] || 'text/plain';
        const status = proxyRes.statusCode || 502;

        proxyRes.on('data', (chunk) => chunks.push(chunk));

        proxyRes.on('end', () => {
            const responseData = Buffer.concat(chunks);

            // Pass upstream failures through as failures, and never cache
            // them. Previously an error page came back as 200 and was cached,
            // so the browser tried to read an error message as data.
            if (status < 200 || status >= 300) {
                console.error(`Upstream ${status} for ${targetUrl}`);
                const stale = cache.get(getCacheKey(targetUrl));
                if (stale) {
                    console.log(`Serving STALE cache for ${targetUrl} after upstream ${status}`);
                    res.writeHead(200, {
                        'Content-Type': stale.contentType,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, OPTIONS',
                        'Cache-Control': 'public, max-age=60',
                        'X-Cache': 'STALE'
                    });
                    res.end(stale.data);
                    return;
                }
                res.writeHead(502, {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                    'X-Upstream-Status': String(status)
                });
                res.end(`Upstream returned ${status} for ${targetUrl}`);
                return;
            }

            const isBinary = contentType.includes('image/') || contentType.includes('application/octet-stream');
            setCachedData(targetUrl, responseData, isBinary, contentType);

            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'public, max-age=60',
                'X-Cache': 'MISS'
            });
            res.end(responseData);
        });

    }).on('error', (err) => {
        console.error('Proxy error:', err);
        
        // If we have cached data, serve it even if it's stale (better than nothing)
        const staleCache = cache.get(getCacheKey(targetUrl));
        if (staleCache) {
            console.log(`Serving STALE cache for ${targetUrl} due to error`);
            const headers = {
                'Content-Type': staleCache.contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'public, max-age=60',
                'X-Cache': 'STALE'
            };
            res.writeHead(200, headers);
            res.end(staleCache.data);
            return;
        }
        
        res.writeHead(500, {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(`Error fetching data: ${err.message}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`CORS proxy server running on port ${PORT}`);
    console.log(`Cache duration: ${CACHE_DURATION/1000} seconds`);
    console.log(`\nAllowed URLs:`);
    ALLOWED_URLS.forEach(u => console.log(`  - ${u}`));
});
