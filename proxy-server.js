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
    'http://weather.nsac.co.nz/cams/'  // Allow all camera images
];

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
    if (age < CACHE_DURATION) {
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
        let data = '';
        let chunks = [];
        let isBinary = false;

        // Check if response is binary (images)
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
            isBinary = true;
        }

        proxyRes.on('data', (chunk) => {
            if (isBinary) {
                chunks.push(chunk);
            } else {
                data += chunk;
            }
        });

        proxyRes.on('end', () => {
            const headers = {
                'Content-Type': proxyRes.headers['content-type'] || 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'public, max-age=60',
                'X-Cache': 'MISS'
            };

            // Cache the response
            const responseData = isBinary ? Buffer.concat(chunks) : data;
            setCachedData(targetUrl, responseData, isBinary, proxyRes.headers['content-type'] || 'text/plain');

            res.writeHead(200, headers);
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
