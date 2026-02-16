const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    const file = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(__dirname, file);
    const ext = path.extname(filePath);
    const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}).listen(PORT, '0.0.0.0', () => console.log(`Frontend on port ${PORT}`));