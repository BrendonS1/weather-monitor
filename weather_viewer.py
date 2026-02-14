#!/usr/bin/env python3
"""
Weather Data Viewer
Query and display captured weather data from the database
"""

import sqlite3
import argparse
from datetime import datetime
from pathlib import Path


def connect_db(db_path='weather_data.db'):
    """Connect to the database"""
    if not Path(db_path).exists():
        print(f"Error: Database not found at {db_path}")
        return None
    return sqlite3.connect(db_path)


def show_stats(conn):
    """Display database statistics"""
    cursor = conn.cursor()
    
    # Total captures
    cursor.execute('SELECT COUNT(*) FROM weather_data')
    total = cursor.fetchone()[0]
    
    # Archived captures
    cursor.execute('SELECT COUNT(*) FROM weather_data_archive')
    archived = cursor.fetchone()[0]
    
    # First capture
    cursor.execute('SELECT captured_at FROM weather_data ORDER BY captured_at ASC LIMIT 1')
    first = cursor.fetchone()
    first_date = first[0] if first else "N/A"
    
    # Last capture
    cursor.execute('SELECT captured_at FROM weather_data ORDER BY captured_at DESC LIMIT 1')
    last = cursor.fetchone()
    last_date = last[0] if last else "N/A"
    
    # Average file size
    cursor.execute('SELECT AVG(file_size) FROM weather_data')
    avg_size = cursor.fetchone()[0] or 0
    
    print("\n" + "="*60)
    print("WEATHER DATA STATISTICS")
    print("="*60)
    print(f"Active captures:    {total}")
    print(f"Archived captures:  {archived}")
    print(f"Total captures:     {total + archived}")
    print(f"First capture:      {first_date}")
    print(f"Last capture:       {last_date}")
    print(f"Average file size:  {avg_size:.0f} bytes")
    print("="*60 + "\n")


def list_captures(conn, limit=20):
    """List recent captures"""
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, captured_at, file_size, content_hash
        FROM weather_data 
        ORDER BY captured_at DESC 
        LIMIT ?
    ''', (limit,))
    
    print(f"\nLast {limit} Captures:")
    print("-" * 80)
    print(f"{'ID':<6} {'Date/Time':<20} {'Size':<10} {'Hash':<20}")
    print("-" * 80)
    
    for row in cursor.fetchall():
        id_, captured_at, file_size, content_hash = row
        hash_short = content_hash[:16] + "..."
        print(f"{id_:<6} {captured_at:<20} {file_size:<10} {hash_short:<20}")
    
    print("-" * 80 + "\n")


def show_content(conn, capture_id):
    """Display content of a specific capture"""
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT captured_at, raw_content, file_size 
        FROM weather_data 
        WHERE id = ?
    ''', (capture_id,))
    
    result = cursor.fetchone()
    
    if not result:
        print(f"Error: No capture found with ID {capture_id}")
        return
    
    captured_at, raw_content, file_size = result
    
    print("\n" + "="*80)
    print(f"CAPTURE ID: {capture_id}")
    print(f"Date/Time:  {captured_at}")
    print(f"Size:       {file_size} bytes")
    print("="*80)
    print("\nContent:")
    print("-" * 80)
    print(raw_content)
    print("-" * 80 + "\n")


def show_latest(conn):
    """Display the latest capture"""
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, captured_at, raw_content, file_size 
        FROM weather_data 
        ORDER BY captured_at DESC 
        LIMIT 1
    ''')
    
    result = cursor.fetchone()
    
    if not result:
        print("No captures found in database")
        return
    
    id_, captured_at, raw_content, file_size = result
    
    print("\n" + "="*80)
    print(f"LATEST CAPTURE (ID: {id_})")
    print(f"Date/Time: {captured_at}")
    print(f"Size:      {file_size} bytes")
    print("="*80)
    print("\nContent:")
    print("-" * 80)
    print(raw_content)
    print("-" * 80 + "\n")


def search_by_date(conn, date_str):
    """Search captures by date (YYYY-MM-DD)"""
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, captured_at, file_size 
        FROM weather_data 
        WHERE DATE(captured_at) = ?
        ORDER BY captured_at
    ''', (date_str,))
    
    results = cursor.fetchall()
    
    if not results:
        print(f"No captures found for date: {date_str}")
        return
    
    print(f"\nCaptures for {date_str}:")
    print("-" * 60)
    print(f"{'ID':<6} {'Time':<20} {'Size':<10}")
    print("-" * 60)
    
    for row in results:
        id_, captured_at, file_size = row
        time_part = captured_at.split()[1] if ' ' in captured_at else captured_at
        print(f"{id_:<6} {time_part:<20} {file_size:<10}")
    
    print("-" * 60)
    print(f"Total: {len(results)} captures\n")


def export_to_csv(conn, output_file='weather_export.csv'):
    """Export all data to CSV"""
    import csv
    
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, captured_at, file_size, content_hash, raw_content
        FROM weather_data 
        ORDER BY captured_at
    ''')
    
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['ID', 'Captured At', 'File Size', 'Content Hash', 'Raw Content'])
        writer.writerows(cursor.fetchall())
    
    print(f"\nData exported to: {output_file}\n")


def main():
    parser = argparse.ArgumentParser(description='View weather data from SQLite database')
    parser.add_argument('--db', default='weather_data.db', help='Database file path')
    parser.add_argument('--stats', action='store_true', help='Show statistics')
    parser.add_argument('--list', type=int, metavar='N', help='List N most recent captures')
    parser.add_argument('--show', type=int, metavar='ID', help='Show content of specific capture ID')
    parser.add_argument('--latest', action='store_true', help='Show latest capture')
    parser.add_argument('--date', metavar='YYYY-MM-DD', help='Search by date')
    parser.add_argument('--export', metavar='FILE', help='Export all data to CSV')
    
    args = parser.parse_args()
    
    conn = connect_db(args.db)
    if not conn:
        return
    
    try:
        # If no arguments, show stats and list
        if not any([args.stats, args.list, args.show, args.latest, args.date, args.export]):
            show_stats(conn)
            list_captures(conn, 10)
        else:
            if args.stats:
                show_stats(conn)
            if args.list:
                list_captures(conn, args.list)
            if args.show:
                show_content(conn, args.show)
            if args.latest:
                show_latest(conn)
            if args.date:
                search_by_date(conn, args.date)
            if args.export:
                export_to_csv(conn, args.export)
    
    finally:
        conn.close()


if __name__ == '__main__':
    main()
