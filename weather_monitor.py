#!/usr/bin/env python3
"""
Weather Data Monitor for weather.nsac.co.nz
Monitors NEmetData.txt file and stores changes to PostgreSQL database
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
import hashlib
import time
import logging
import os
from datetime import datetime
from pathlib import Path

# Configuration
CONFIG = {
    'url': 'http://weather.nsac.co.nz/NEmetData.txt',
    'database_url': os.environ.get('DATABASE_URL'),  # Render provides this automatically
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
        self.database_url = config['database_url']
        self.url = config['url']
        
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable is not set")
        
        self.init_database()
        
    def get_connection(self):
        """Get a new database connection"""
        return psycopg2.connect(
            self.database_url,
            connect_timeout=10,
            options="-c statement_timeout=30000"
        )
        
    def init_database(self):
        """Initialize PostgreSQL database with required tables"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Table for raw data captures
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weather_data (
                id SERIAL PRIMARY KEY,
                captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                content_hash TEXT NOT NULL,
                raw_content JSONB NOT NULL,
                file_size INTEGER
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
        
        conn.commit()
        conn.close()
        logger.info("Database initialized successfully")
    
    def get_content_hash(self, content):
        """Generate SHA256 hash of content"""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()
    
    def is_duplicate(self, content_hash):
        """Check if this content hash already exists in database"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT COUNT(*) FROM weather_data 
            WHERE content_hash = %s
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
        conn = self.get_connection()
        cursor = conn.cursor()
        
        content_hash = self.get_content_hash(content)
        file_size = len(content)
        
        cursor.execute('''
            INSERT INTO weather_data (content_hash, raw_content, file_size)
            VALUES (%s, %s, %s)
            RETURNING id
        ''', (content_hash, content, file_size))
        
        capture_id = cursor.fetchone()[0]
        conn.commit()
        conn.close()
        
        logger.info(f"New data stored (ID: {capture_id}, Size: {file_size} bytes, Hash: {content_hash[:16]}...)")
        return capture_id
    
    def get_stats(self):
        """Get statistics about captured data"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM weather_data')
        total_captures = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT captured_at FROM weather_data 
            ORDER BY captured_at DESC LIMIT 1
        ''')
        result = cursor.fetchone()
        last_capture = result[0] if result else "Never"
        
        conn.close()

        return {
            'total_captures': total_captures,
            'last_capture': last_capture,
        }
    
    def cleanup_old_data(self):
        """Delete trend data older than 5 days, raw data older than 30 days, weather_update older than 2 years"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            DELETE FROM weather_windtrend
            WHERE update_id IN (
                SELECT id FROM weather_data
                WHERE captured_at < NOW() - INTERVAL '5 days'
            )
        ''')
        windtrend_count = cursor.rowcount

        cursor.execute('''
            DELETE FROM weather_winddirtrend
            WHERE update_id IN (
                SELECT id FROM weather_data
                WHERE captured_at < NOW() - INTERVAL '5 days'
            )
        ''')
        winddirtrend_count = cursor.rowcount

        cursor.execute('''
            DELETE FROM weather_data
            WHERE captured_at < NOW() - INTERVAL '30 days'
        ''')
        data_count = cursor.rowcount

        cursor.execute('''
            DELETE FROM weather_update
            WHERE captured_at < NOW() - INTERVAL '2 years'
        ''')
        update_count = cursor.rowcount

        conn.commit()
        conn.close()

        logger.info(
            f"Cleanup: removed {windtrend_count} windtrend, {winddirtrend_count} winddirtrend rows (>5 days); "
            f"{data_count} weather_data rows (>30 days); "
            f"{update_count} weather_update rows (>2 years)"
        )
        return data_count
    
    def run_once(self):
        """Run a single check"""
        logger.info("Checking for new data...")
        
        content = self.fetch_data()
        
        if not content:
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
        logger.info(f"Database: PostgreSQL (Render)")
        logger.info(f"Auto-cleanup: trends >5 days, weather_data >30 days, weather_update >2 years (runs daily)")
        
        # Track when we last ran archive
        last_archive_check = datetime.now()
        
        try:
            while True:
                try:
                    self.run_once()

                    # Check if we should run archive (once per day)
                    if (datetime.now() - last_archive_check).days >= 1:
                        logger.info("Running daily cleanup...")
                        self.cleanup_old_data()
                        last_archive_check = datetime.now()

                    # Show stats periodically
                    stats = self.get_stats()
                    logger.info(f"Stats - Active: {stats['total_captures']}, Last: {stats['last_capture']}")

                except Exception as e:
                    logger.error(f"Error during check cycle (will retry): {e}", exc_info=True)

                logger.info(f"Waiting {interval} seconds until next check...")
                time.sleep(interval)

        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Fatal error: {e}", exc_info=True)
            raise SystemExit(1)


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
        '--cleanup',
        action='store_true',
        help='Run cleanup (trends >5 days, weather_data >30 days, weather_update >2 years) and exit'
    )
    
    args = parser.parse_args()
    
    monitor = WeatherMonitor(CONFIG)
    
    if args.stats:
        stats = monitor.get_stats()
        print(f"\n=== Weather Monitor Statistics ===")
        print(f"Database: PostgreSQL (Render)")
        print(f"Active records: {stats['total_captures']}")
        print(f"Last capture: {stats['last_capture']}")
        print(f"===================================\n")
    elif args.cleanup:
        print(f"\nRunning cleanup...")
        monitor.cleanup_old_data()
        print(f"Cleanup complete\n")
    elif args.once:
        monitor.run_once()
    else:
        monitor.run_continuous(args.interval)


if __name__ == '__main__':
    main()
