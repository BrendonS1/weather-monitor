# Weather Monitor Project Files

All files needed for the North Shore Airport Weather Monitor system.

## Project Structure

```
weather-monitor/
├── weather_monitor.py          # Main monitoring script
├── weather_viewer.py            # Data viewer/query tool
├── requirements.txt             # Python dependencies
├── README.md                    # Setup and usage instructions
├── proxy-server.js              # CORS proxy (for web UI)
├── weather-live.html            # Live weather dashboard (needs proxy)
├── weather-ui-mockup.html       # Static UI mockup
├── PROXY-README.md              # Proxy server instructions
└── ARCHIVING-AND-POLLING-EXPLAINED.md  # Technical documentation
```

## Quick Start in Visual Studio Code

### 1. Create Project Folder
```bash
mkdir weather-monitor
cd weather-monitor
```

### 2. Copy All Files
Download all the files from this conversation and place them in the `weather-monitor` folder.

### 3. Open in VS Code
```bash
code .
```

### 4. Set Up Python Environment

**Option A: Using VS Code integrated terminal**
```bash
# Create virtual environment
python -m venv venv

# Activate it
# On Windows:
venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Option B: Using VS Code Python extension**
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
- Type "Python: Create Environment"
- Select "Venv"
- Choose your Python interpreter
- Check "requirements.txt" to install dependencies

### 5. Run the Monitor

**In VS Code terminal:**
```bash
# Check every 30 seconds (default)
python weather_monitor.py

# Custom interval
python weather_monitor.py --interval 60

# Run once (for testing)
python weather_monitor.py --once

# View stats
python weather_monitor.py --stats
```

### 6. View Your Data

```bash
# See latest capture
python weather_viewer.py --latest

# List recent captures
python weather_viewer.py --list 20

# Export to CSV
python weather_viewer.py --export weather_export.csv
```

## File Descriptions

### Core Scripts

**weather_monitor.py**
- Main monitoring script
- Polls weather data every 30 seconds
- Stores changes in SQLite database
- Auto-archives data older than 90 days
- Configurable via command-line arguments

**weather_viewer.py**
- Query and display captured weather data
- Show statistics
- Export to CSV
- Search by date

**requirements.txt**
- Python package dependencies
- Currently just `requests>=2.31.0`

### Web Interface Files

**weather-live.html**
- Live weather dashboard with modern UI
- Uses Plotly for charts
- Auto-refreshes every 60 seconds
- Requires proxy-server.js to run

**proxy-server.js**
- Node.js CORS proxy server
- Allows web UI to fetch data from weather.nsac.co.nz
- Only needed if running the web interface locally

**weather-ui-mockup.html**
- Static mockup of the weather UI
- Uses North Shore Airport brand colors (#007e33)
- Shows runway indicators for 03/21 and 09/27
- Can be opened directly in browser (no server needed)

### Documentation

**README.md**
- Complete setup and usage instructions
- Systemd service setup
- Cron job examples
- Database querying examples

**PROXY-README.md**
- Instructions for running the CORS proxy
- Python alternative included
- Troubleshooting guide

**ARCHIVING-AND-POLLING-EXPLAINED.md**
- Technical explanation of archiving strategy
- Polling vs event-based monitoring
- Performance considerations

## Current Configuration

- **Poll interval:** 30 seconds
- **Archive after:** 90 days
- **Database:** SQLite (weather_data.db)
- **Log file:** weather_monitor.log

## VS Code Recommended Extensions

For best experience, install these VS Code extensions:
- **Python** (ms-python.python)
- **Pylance** (ms-python.vscode-pylance)
- **SQLite Viewer** (alexcvzz.vscode-sqlite) - to view database
- **Live Server** (ritwickdey.LiveServer) - for HTML files

## Debugging in VS Code

Create `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Weather Monitor",
            "type": "python",
            "request": "launch",
            "program": "weather_monitor.py",
            "console": "integratedTerminal",
            "args": ["--interval", "30"]
        },
        {
            "name": "Weather Viewer",
            "type": "python",
            "request": "launch",
            "program": "weather_viewer.py",
            "console": "integratedTerminal",
            "args": ["--latest"]
        }
    ]
}
```

Then press `F5` to run with debugging!

## Database Files (Created Automatically)

When you run the monitor, these will be created:
- `weather_data.db` - Main SQLite database
- `weather_monitor.log` - Application logs

**Don't check these into git!** Add to `.gitignore`:
```
weather_data.db
weather_monitor.log
venv/
__pycache__/
*.pyc
```

## Next Steps

1. ✅ Import all files into VS Code
2. ✅ Set up Python environment
3. ✅ Test with `python weather_monitor.py --once`
4. ✅ Run continuously with `python weather_monitor.py`
5. ✅ View data with `python weather_viewer.py --latest`
6. Optional: Set up as a system service (see README.md)
7. Optional: Run web interface (see PROXY-README.md)

## Need Help?

Check the documentation files:
- Setup issues → README.md
- Web UI issues → PROXY-README.md  
- Technical questions → ARCHIVING-AND-POLLING-EXPLAINED.md
