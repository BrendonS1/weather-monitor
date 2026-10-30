const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.geojson': 'application/geo+json',
};

function notFound(res) {
    res.writeHead(404);
    res.end('Not found');
}

http.createServer((req, res) => {
    let url;
    let pathname;
    try {
        url = new URL(req.url, 'http://localhost');
        pathname = decodeURIComponent(url.pathname);
    } catch (e) {
        res.writeHead(400);
        res.end('Bad request');
        return;
    }

    // Never serve hidden files or folders (.git, .claude, .env and so on).
    if (pathname.split('/').some(part => part.startsWith('.'))) return notFound(res);

    // Resolve inside the site folder only.
    let filePath = path.normalize(path.join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return notFound(res);

    fs.stat(filePath, (statErr, stats) => {
        if (!statErr && stats.isDirectory()) {
            // /2 -> /2/ so relative links inside the folder resolve correctly.
            if (!pathname.endsWith('/')) {
                res.writeHead(301, { Location: pathname + '/' + url.search });
                res.end();
                return;
            }
            filePath = path.join(filePath, 'index.html');
        }

        fs.readFile(filePath, (err, data) => {
            if (err) return notFound(res);
            const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });
}).listen(PORT, '0.0.0.0', () => console.log(`Frontend on port ${PORT}`));
