// Simple CORS proxy server for North Shore Airport weather data
// This fetches data from weather.nsac.co.nz and serves it with CORS headers

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3000;

const ALLOWED_URLS = [
    'http://weather.nsac.co.nz/NEmetData.txt',
    'http://weather.nsac.co.nz/awibexport.txt',
    'http://weather.nsac.co.nz/cams/CamInfo.txt',
    'http://weather.nsac.co.nz/cams/'  // Allow all camera images
];

function isAllowedUrl(targetUrl) {
    return ALLOWED_URLS.some(allowed => targetUrl.startsWith(allowed));
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

    console.log(`Proxying request to: ${targetUrl}`);

    // Fetch the data from the target URL
    const protocol = targetUrl.startsWith('https') ? https : http;
    
    protocol.get(targetUrl, (proxyRes) => {
        let data = '';

        proxyRes.on('data', (chunk) => {
            data += chunk;
        });

        proxyRes.on('end', () => {
            res.writeHead(200, {
                'Content-Type': proxyRes.headers['content-type'] || 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        });

    }).on('error', (err) => {
        console.error('Proxy error:', err);
        res.writeHead(500, {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(`Error fetching data: ${err.message}`);
    });
});

server.listen(PORT, () => {
    console.log(`CORS proxy server running on http://localhost:${PORT}`);
    console.log(`\nExample usage:`);
    console.log(`http://localhost:${PORT}/?url=http://weather.nsac.co.nz/NEmetData.txt`);
    console.log(`\nAllowed URLs:`);
    ALLOWED_URLS.forEach(u => console.log(`  - ${u}`));
});
