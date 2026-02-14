#!/usr/bin/env python3
"""
Weather Data Monitor for weather.nsac.co.nz
Monitors NEmetData.txt file and stores changes to SQLite database
"""

import sqlite3
import requests
import hashlib
import time
import logging
from datetime import datetime
from pathlib import Path

# Configuration
CONFIG = {
    'url': 'http://weather.nsac.co.nz/NEmetData.txt',
    'database': 'weather_data.db',
    'check_interval': 30,  # seconds (30 = 30 seconds) - CHANGE THIS AS NEEDED
    'timeout': 30,  # request timeout in seconds
    'log_file': 'weather_monitor.log'
}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(CONFIG['log_file']),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


class WeatherMonitor:
    def __init__(self, config):
        self.config = config
        self.db_path = config['database']
        self.url = config['url']
        self.init_database()
        
    def init_database(self):
        """Initialize SQLite database with required tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Table for raw data captures
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weather_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                content_hash TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                file_size INTEGER
            )
        ''')
        
        # Table for parsed data (optional - customize based on actual data format)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weather_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                capture_id INTEGER,
                timestamp TIMESTAMP,
                data_json TEXT,
                FOREIGN KEY (capture_id) REFERENCES weather_data(id)
            )
        ''')
        
        # Archive table for old data
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weather_data_archive (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TIMESTAMP,
                content_hash TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                file_size INTEGER,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Index for faster lookups
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_captured_at 
            ON weather_data(captured_at)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_content_hash 
            ON weather_data(content_hash)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_archive_captured_at 
            ON weather_data_archive(captured_at)
        ''')
        
        conn.commit()
        conn.close()
        logger.info(f"Database initialized: {self.db_path}")
    
    def get_content_hash(self, content):
        """Generate SHA256 hash of content"""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()
    
    def is_duplicate(self, content_hash):
        """Check if this content hash already exists in database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT COUNT(*) FROM weather_data 
            WHERE content_hash = ?
        ''', (content_hash,))
        
        count = cursor.fetchone()[0]
        conn.close()
        
        return count > 0
    
    def fetch_data(self):
        """Fetch data from the weather URL"""
        try:
            # Add cache-busting timestamp
            timestamp = int(time.time() * 1000)
            url_with_timestamp = f"{self.url}?t={timestamp}"
            
            response = requests.get(
                url_with_timestamp,
                timeout=self.config['timeout']
            )
            response.raise_for_status()
            
            return response.text
            
        except requests.RequestException as e:
            logger.error(f"Error fetching data: {e}")
            return None
    
    def store_data(self, content):
        """Store new data in database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        content_hash = self.get_content_hash(content)
        file_size = len(content)
        
        cursor.execute('''
            INSERT INTO weather_data (content_hash, raw_content, file_size)
            VALUES (?, ?, ?)
        ''', (content_hash, content, file_size))
        
        capture_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        logger.info(f"New data stored (ID: {capture_id}, Size: {file_size} bytes, Hash: {content_hash[:16]}...)")
        return capture_id
    
    def get_stats(self):
        """Get statistics about captured data"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM weather_data')
        total_captures = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT captured_at FROM weather_data 
            ORDER BY captured_at DESC LIMIT 1
        ''')
        result = cursor.fetchone()
        last_capture = result[0] if result else "Never"
        
        cursor.execute('SELECT COUNT(*) FROM weather_data_archive')
        archived_count = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            'total_captures': total_captures,
            'last_capture': last_capture,
            'archived_records': archived_count
        }
    
    def archive_old_data(self, days=90):
        """Archive data older than specified days"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Find records to archive
        cursor.execute('''
            SELECT id, captured_at, content_hash, raw_content, file_size
            FROM weather_data
            WHERE captured_at < datetime('now', '-' || ? || ' days')
        ''', (days,))
        
        records = cursor.fetchall()
        
        if not records:
            logger.info(f"No records older than {days} days to archive")
            conn.close()
            return 0
        
        # Insert into archive
        cursor.executemany('''
            INSERT INTO weather_data_archive (id, captured_at, content_hash, raw_content, file_size)
            VALUES (?, ?, ?, ?, ?)
        ''', records)
        
        # Delete from main table
        cursor.execute('''
            DELETE FROM weather_data
            WHERE captured_at < datetime('now', '-' || ? || ' days')
        ''', (days,))
        
        conn.commit()
        archived_count = len(records)
        conn.close()
        
        logger.info(f"Archived {archived_count} records older than {days} days")
        return archived_count
    
    def run_once(self):
        """Run a single check"""
        logger.info("Checking for new data...")
        
        content = self.fetch_data()
        
        if content is None:
            logger.warning("Failed to fetch data")
            return False
        
        content_hash = self.get_content_hash(content)
        
        if self.is_duplicate(content_hash):
            logger.info("No changes detected (duplicate content)")
            return False
        
        self.store_data(content)
        return True
    
    def run_continuous(self, interval=None):
        """Run continuously with specified interval"""
        if interval is None:
            interval = self.config['check_interval']
        
        logger.info(f"Starting continuous monitoring (interval: {interval}s)")
        logger.info(f"Monitoring URL: {self.url}")
        logger.info(f"Database: {self.db_path}")
        logger.info(f"Auto-archive: Data older than 90 days will be archived daily")
        
        # Track when we last ran archive
        last_archive_check = datetime.now()
        
        try:
            while True:
                self.run_once()
                
                # Check if we should run archive (once per day)
                if (datetime.now() - last_archive_check).days >= 1:
                    logger.info("Running daily archive check...")
                    self.archive_old_data(days=90)
                    last_archive_check = datetime.now()
                
                # Show stats periodically
                stats = self.get_stats()
                logger.info(f"Stats - Active: {stats['total_captures']}, Archived: {stats['archived_records']}, Last: {stats['last_capture']}")
                
                logger.info(f"Waiting {interval} seconds until next check...")
                time.sleep(interval)
                
        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Unexpected error: {e}", exc_info=True)


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Monitor weather data from weather.nsac.co.nz')
    parser.add_argument(
        '--interval', 
        type=int, 
        default=CONFIG['check_interval'],
        help=f'Check interval in seconds (default: {CONFIG["check_interval"]})'
    )
    parser.add_argument(
        '--once', 
        action='store_true',
        help='Run once and exit (useful for cron jobs)'
    )
    parser.add_argument(
        '--stats', 
        action='store_true',
        help='Show statistics and exit'
    )
    parser.add_argument(
        '--archive', 
        type=int,
        metavar='DAYS',
        help='Archive data older than DAYS and exit (default: 90)'
    )
    
    args = parser.parse_args()
    
    monitor = WeatherMonitor(CONFIG)
    
    if args.stats:
        stats = monitor.get_stats()
        print(f"\n=== Weather Monitor Statistics ===")
        print(f"Database: {CONFIG['database']}")
        print(f"Active records: {stats['total_captures']}")
        print(f"Archived records: {stats['archived_records']}")
        print(f"Last capture: {stats['last_capture']}")
        print(f"===================================\n")
    elif args.archive:
        days = args.archive if args.archive else 90
        print(f"\nArchiving data older than {days} days...")
        archived = monitor.archive_old_data(days)
        print(f"Archived {archived} records\n")
    elif args.once:
        monitor.run_once()
    else:
        monitor.run_continuous(args.interval)


if __name__ == '__main__':
    main()
