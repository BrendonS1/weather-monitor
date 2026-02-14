# North Shore Airport Weather - CORS Proxy Solution

This solution uses a local proxy server to bypass CORS restrictions and fetch data from weather.nsac.co.nz.

## Quick Start

### Option 1: Using Node.js (Recommended)

1. **Install Node.js** (if not already installed)
   - Download from https://nodejs.org/
   - Or use your package manager: `brew install node` (Mac) or `apt install nodejs` (Linux)

2. **Start the proxy server**
   ```bash
   node proxy-server.js
   ```
   
   You should see:
   ```
   CORS proxy server running on http://localhost:3000
   ```

3. **Open the weather page**
   - Open `weather-live.html` in your browser
   - The page will now fetch data through the proxy

4. **Keep the proxy running** while viewing the weather page

### Option 2: Using Python (Alternative)

If you prefer Python, here's a simple alternative:

1. Create `proxy-server.py`:
   ```python
   from http.server import HTTPServer, BaseHTTPRequestHandler
   import urllib.request
   from urllib.parse import urlparse, parse_qs
   
   class ProxyHandler(BaseHTTPRequestHandler):
       ALLOWED_URLS = [
           'http://weather.nsac.co.nz/NEmetData.txt',
           'http://weather.nsac.co.nz/awibexport.txt',
           'http://weather.nsac.co.nz/cams/CamInfo.txt'
       ]
       
       def do_GET(self):
           parsed = urlparse(self.path)
           params = parse_qs(parsed.query)
           
           if 'url' not in params:
               self.send_error(400, 'Missing url parameter')
               return
           
           target_url = params['url'][0]
           
           if not any(target_url.startswith(allowed) for allowed in self.ALLOWED_URLS):
               self.send_error(403, 'URL not allowed')
               return
           
           try:
               with urllib.request.urlopen(target_url) as response:
                   data = response.read()
                   
                   self.send_response(200)
                   self.send_header('Content-Type', 'application/json')
                   self.send_header('Access-Control-Allow-Origin', '*')
                   self.send_header('Cache-Control', 'no-cache')
                   self.end_headers()
                   self.wfile.write(data)
           except Exception as e:
               self.send_error(500, f'Error: {str(e)}')
       
       def do_OPTIONS(self):
           self.send_response(200)
           self.send_header('Access-Control-Allow-Origin', '*')
           self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
           self.end_headers()
   
   if __name__ == '__main__':
       server = HTTPServer(('localhost', 3000), ProxyHandler)
       print('CORS proxy server running on http://localhost:3000')
       server.serve_forever()
   ```

2. Run it:
   ```bash
   python3 proxy-server.py
   ```

## How It Works

1. The HTML page makes requests to `http://localhost:3000/?url=http://weather.nsac.co.nz/...`
2. The proxy server fetches the data from weather.nsac.co.nz
3. The proxy adds CORS headers to the response
4. Your browser receives the data without CORS errors

## Troubleshooting

**"Cannot GET /"**
- Make sure you're accessing the proxy with the `?url=` parameter
- The proxy is working correctly

**"Connection refused"**
- Make sure the proxy server is running
- Check that it's on port 3000: `http://localhost:3000`

**"URL not allowed"**
- The proxy only allows specific weather.nsac.co.nz URLs for security
- This is intentional to prevent abuse

**Data not loading**
- Check browser console for errors (F12)
- Verify proxy server is running
- Check that weather.nsac.co.nz is accessible

## Running as a Background Service

### Mac/Linux (using systemd)

Create `/etc/systemd/system/weather-proxy.service`:
```ini
[Unit]
Description=Weather CORS Proxy
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/proxy
ExecStart=/usr/bin/node /path/to/proxy/proxy-server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable weather-proxy
sudo systemctl start weather-proxy
```

### Windows

Create a batch file `start-proxy.bat`:
```batch
@echo off
node proxy-server.js
pause
```

Or use a tool like NSSM to run it as a Windows service.

## Security Note

This proxy is designed for **local development only**. It:
- Only allows specific weather.nsac.co.nz URLs
- Runs on localhost (not accessible from other computers)
- Should not be exposed to the internet

## Alternative: Deploy to Weather Server

The best long-term solution is to upload `weather-live.html` directly to the weather.nsac.co.nz server. Then you won't need any proxy at all!

Just change the URLs in the HTML back to relative paths:
```javascript
const DATA_URL = 'NEmetData.txt';
const NOTICE_URL = 'awibexport.txt';
const CAM_URL = 'cams/CamInfo.txt';
```
