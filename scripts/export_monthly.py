#!/usr/bin/env python3
"""
Export COLA database to monthly JSON files for web consumption.
Creates a data/ folder with:
  - index.json (metadata about all months)
  - YYYY-MM.json (data for each month)
"""

import sqlite3
import json
import os
from datetime import datetime
from collections import defaultdict
import re

# Configuration
DB_PATH = "data/consolidated_colas.db"  # Your merged database
OUTPUT_DIR = "web/data"                  # Output folder for JSON files

def parse_approval_date(date_str):
    """Parse various date formats and return (year, month) tuple."""
    if not date_str:
        return None, None
    
    # Try MM/DD/YYYY format
    match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_str)
    if match:
        return int(match.group(3)), int(match.group(1))
    
    # Try YYYY-MM-DD format
    match = re.match(r'(\d{4})-(\d{2})-(\d{2})', date_str)
    if match:
        return int(match.group(1)), int(match.group(2))
    
    return None, None

def get_month_key(year, month):
    """Return YYYY-MM format."""
    return f"{year:04d}-{month:02d}"

def export_monthly_data():
    """Export database to monthly JSON files."""
    
    print(f"\n{'='*60}")
    print("EXPORTING DATABASE TO MONTHLY JSON FILES")
    print(f"{'='*60}\n")
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get all COLAs
    print("Loading data from database...")
    cursor = conn.execute("""
        SELECT * FROM colas ORDER BY approval_date DESC
    """)
    
    # Group by month
    monthly_data = defaultdict(list)
    all_origins = set()
    all_class_types = set()
    all_statuses = set()
    
    total_records = 0
    
    for row in cursor:
        total_records += 1
        
        record = dict(row)
        
        # Parse approval date to get year/month
        year, month = parse_approval_date(record.get('approval_date'))
        
        if year and month:
            month_key = get_month_key(year, month)
        else:
            # Put records without valid dates in 'unknown' bucket
            month_key = 'unknown'
        
        monthly_data[month_key].append(record)
        
        # Collect filter values
        if record.get('origin_code'):
            all_origins.add(record['origin_code'])
        if record.get('class_type_code'):
            all_class_types.add(record['class_type_code'])
        if record.get('status'):
            all_statuses.add(record['status'])
    
    conn.close()
    
    print(f"Total records: {total_records:,}")
    print(f"Months found: {len(monthly_data)}")
    
    # Sort months (newest first)
    sorted_months = sorted(monthly_data.keys(), reverse=True)
    
    # Create index file
    index = {
        'generated_at': datetime.now().isoformat(),
        'total_records': total_records,
        'months': [],
        'filters': {
            'origins': sorted(list(all_origins)),
            'class_types': sorted(list(all_class_types)),
            'statuses': sorted(list(all_statuses))
        }
    }
    
    # Export each month
    print(f"\nExporting monthly files to {OUTPUT_DIR}/")
    
    for month_key in sorted_months:
        records = monthly_data[month_key]
        count = len(records)
        
        # Add to index
        index['months'].append({
            'key': month_key,
            'count': count
        })
        
        # Create monthly JSON file
        month_file = os.path.join(OUTPUT_DIR, f"{month_key}.json")
        
        month_data = {
            'month': month_key,
            'count': count,
            'generated_at': datetime.now().isoformat(),
            'colas': records
        }
        
        with open(month_file, 'w') as f:
            json.dump(month_data, f)
        
        file_size = os.path.getsize(month_file) / (1024 * 1024)  # MB
        print(f"  {month_key}.json: {count:,} records ({file_size:.1f} MB)")
    
    # Save index file
    index_file = os.path.join(OUTPUT_DIR, "index.json")
    with open(index_file, 'w') as f:
        json.dump(index, f, indent=2)
    
    index_size = os.path.getsize(index_file) / 1024  # KB
    print(f"\n  index.json: {len(index['months'])} months ({index_size:.1f} KB)")
    
    # Summary
    print(f"\n{'='*60}")
    print("EXPORT COMPLETE")
    print(f"{'='*60}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Total files: {len(sorted_months) + 1}")
    print(f"Total records: {total_records:,}")
    
    # Calculate total size
    total_size = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
        if f.endswith('.json')
    ) / (1024 * 1024)
    print(f"Total size: {total_size:.1f} MB")
    
    return index

if __name__ == "__main__":
    export_monthly_data()
