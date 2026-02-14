// Simple CORS proxy server for North Shore Airport weather data
// This fetches data from weather.nsac.co.nz and serves it with CORS headers

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
                'Cache-Control': 'no-cache'
            };

            res.writeHead(200, headers);
            
            if (isBinary) {
                res.end(Buffer.concat(chunks));
            } else {
                res.end(data);
            }
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
    console.log(`CORS proxy server running on port ${PORT}`);
    console.log(`\nAllowed URLs:`);
    ALLOWED_URLS.forEach(u => console.log(`  - ${u}`));
});
