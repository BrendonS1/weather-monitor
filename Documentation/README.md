# Weather Data Monitor for weather.nsac.co.nz

Automatically monitors and captures weather data from http://weather.nsac.co.nz/NEmetData.txt to a SQLite database.

## Features

- ✅ Monitors weather data file for changes
- ✅ Only stores data when content actually changes (no duplicates)
- ✅ SQLite database storage with timestamps
- ✅ Configurable check interval
- ✅ Logging to both file and console
- ✅ Can run continuously or as a one-time check (for cron)
- ✅ Built-in statistics

## Installation

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Make the script executable (optional):**
   ```bash
   chmod +x weather_monitor.py
   ```

## Usage

### Run Continuously (Default: 5 minutes)

```bash
python weather_monitor.py
```

### Run with Custom Interval

```bash
# Check every 10 minutes (600 seconds)
python weather_monitor.py --interval 600

# Check every 2 minutes (120 seconds)
python weather_monitor.py --interval 120

# Check every hour (3600 seconds)
python weather_monitor.py --interval 3600
```

### Run Once (for Cron Jobs)

```bash
python weather_monitor.py --once
```

### View Statistics

```bash
python weather_monitor.py --stats
```

## Configuration

Edit the `CONFIG` dictionary in `weather_monitor.py`:

```python
CONFIG = {
    'url': 'http://weather.nsac.co.nz/NEmetData.txt',
    'database': 'weather_data.db',
    'check_interval': 300,  # seconds (default check interval)
    'timeout': 30,          # request timeout
    'log_file': 'weather_monitor.log'
}
```

## Database Schema

### weather_data table
- `id` - Auto-increment primary key
- `captured_at` - Timestamp when data was captured
- `content_hash` - SHA256 hash of content (for duplicate detection)
- `raw_content` - Full text content of the file
- `file_size` - Size in bytes

### weather_readings table
- `id` - Auto-increment primary key
- `capture_id` - Foreign key to weather_data
- `timestamp` - Data timestamp (if parseable)
- `data_json` - Parsed data in JSON format

## Setting Up as a Background Service

### Linux (systemd)

1. Create service file `/etc/systemd/system/weather-monitor.service`:

```ini
[Unit]
Description=Weather Data Monitor
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/weather_monitor
ExecStart=/usr/bin/python3 /path/to/weather_monitor/weather_monitor.py --interval 300
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

2. Enable and start:
```bash
sudo systemctl enable weather-monitor
sudo systemctl start weather-monitor
sudo systemctl status weather-monitor
```

### Using Cron (Alternative)

Add to crontab (`crontab -e`):

```bash
# Run every 5 minutes
*/5 * * * * cd /path/to/weather_monitor && /usr/bin/python3 weather_monitor.py --once >> weather_monitor.log 2>&1
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (e.g., "Daily" then "Repeat every 5 minutes")
4. Action: Start a program
   - Program: `python.exe`
   - Arguments: `C:\path\to\weather_monitor.py --interval 300`
   - Start in: `C:\path\to\`

## Querying the Database

### Using Python

```python
import sqlite3

conn = sqlite3.connect('weather_data.db')
cursor = conn.cursor()

# Get latest 10 captures
cursor.execute('''
    SELECT id, captured_at, file_size 
    FROM weather_data 
    ORDER BY captured_at DESC 
    LIMIT 10
''')

for row in cursor.fetchall():
    print(row)

conn.close()
```

### Using SQLite CLI

```bash
sqlite3 weather_data.db

# Show all captures
SELECT id, captured_at, file_size FROM weather_data ORDER BY captured_at DESC;

# Count total captures
SELECT COUNT(*) FROM weather_data;

# Get latest capture content
SELECT raw_content FROM weather_data ORDER BY captured_at DESC LIMIT 1;
```

## Logs

Check `weather_monitor.log` for:
- Successful captures
- Errors
- Duplicate detections
- Statistics

## Troubleshooting

**No data being captured:**
- Check if the URL is accessible: `curl http://weather.nsac.co.nz/NEmetData.txt`
- Check logs for errors
- Verify network connectivity

**Database locked errors:**
- Ensure only one instance is running
- Check file permissions

**Import errors:**
- Install requirements: `pip install -r requirements.txt`

## License

Free to use and modify as needed.
