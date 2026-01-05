#!/usr/bin/env python3
"""
Export COLA database and upload to Cloudflare D1.
Handles chunking automatically to avoid memory limits.

Usage:
    python export_and_upload.py

This script:
1. Exports your consolidated_colas.db into chunks
2. Uploads each chunk to D1 using wrangler
3. Shows progress along the way
"""

import sqlite3
import os
import subprocess
import sys
from datetime import datetime

# Configuration
DB_PATH = "data/consolidated_colas.db"
OUTPUT_DIR = "d1_chunks"
RECORDS_PER_CHUNK = 25000
D1_DATABASE_NAME = "bevalc-colas"

def escape_sql(value):
    """Escape single quotes for SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"

def run_wrangler(sql_file):
    """Run wrangler to upload a SQL file to D1."""
    cmd = f'wrangler d1 execute {D1_DATABASE_NAME} --remote --file={sql_file} --yes'
    
    result = subprocess.run(
        cmd,
        shell=True,
        stdout=subprocess.DEVNULL,  # Ignore stdout to avoid encoding issues
        stderr=subprocess.DEVNULL   # Ignore stderr to avoid encoding issues
    )
    
    return result.returncode == 0

def export_and_upload():
    """Export database in chunks and upload each to D1."""
    
    print(f"\n{'='*60}")
    print("EXPORT AND UPLOAD TO CLOUDFLARE D1")
    print(f"{'='*60}\n")
    
    # Check database exists
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        return False
    
    # Check wrangler is available
    try:
        result = subprocess.run(
            "wrangler --version",
            shell=True,
            capture_output=True
        )
        if result.returncode != 0:
            print("ERROR: wrangler not found. Install with: npm install -g wrangler")
            return False
        print(f"Using wrangler (version check passed)")
    except Exception as e:
        print(f"ERROR: Could not run wrangler: {e}")
        return False
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Clear old chunk files
    for f in os.listdir(OUTPUT_DIR):
        if f.startswith("d1_chunk_"):
            os.remove(os.path.join(OUTPUT_DIR, f))
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Get total count
    total = conn.execute("SELECT COUNT(*) as cnt FROM colas").fetchone()['cnt']
    num_chunks = (total // RECORDS_PER_CHUNK) + 1
    
    print(f"Total records: {total:,}")
    print(f"Chunk size: {RECORDS_PER_CHUNK:,}")
    print(f"Total chunks: {num_chunks + 1} (1 schema + {num_chunks} data)")
    print()
    
    # Target columns
    target_columns = [
        'ttb_id', 'status', 'vendor_code', 'serial_number', 'class_type_code',
        'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
        'approval_date', 'qualifications', 'total_bottle_capacity', 'plant_registry',
        'company_name', 'street', 'state', 'contact_person', 'phone_number',
        'formula', 'for_sale_in', 'grape_varietal', 'wine_vintage', 'appellation',
        'alcohol_content', 'ph_level', 'year', 'month', 'day'
    ]
    
    # ==================== STEP 1: Create and upload schema ====================
    print(f"[1/{num_chunks + 1}] Creating and uploading schema...", end=" ", flush=True)
    
    schema_file = os.path.join(OUTPUT_DIR, "d1_chunk_00_schema.sql")
    with open(schema_file, 'w', encoding='utf-8') as f:
        f.write(f"""-- BevAlc Intelligence D1 Schema
-- Generated: {datetime.now().isoformat()}

DROP TABLE IF EXISTS colas;

CREATE TABLE colas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ttb_id TEXT UNIQUE NOT NULL,
    status TEXT,
    vendor_code TEXT,
    serial_number TEXT,
    class_type_code TEXT,
    origin_code TEXT,
    brand_name TEXT,
    fanciful_name TEXT,
    type_of_application TEXT,
    approval_date TEXT,
    qualifications TEXT,
    total_bottle_capacity TEXT,
    plant_registry TEXT,
    company_name TEXT,
    street TEXT,
    state TEXT,
    contact_person TEXT,
    phone_number TEXT,
    formula TEXT,
    for_sale_in TEXT,
    grape_varietal TEXT,
    wine_vintage TEXT,
    appellation TEXT,
    alcohol_content TEXT,
    ph_level TEXT,
    year INTEGER,
    month INTEGER,
    day INTEGER
);

CREATE INDEX idx_colas_ttb ON colas(ttb_id);
CREATE INDEX idx_colas_brand ON colas(brand_name);
CREATE INDEX idx_colas_date ON colas(approval_date);
CREATE INDEX idx_colas_origin ON colas(origin_code);
CREATE INDEX idx_colas_class ON colas(class_type_code);
CREATE INDEX idx_colas_status ON colas(status);
CREATE INDEX idx_colas_ymd ON colas(year, month, day);
""")
    
    success = run_wrangler(schema_file)
    
    if not success:
        print("FAILED!")
        print("Schema upload failed. Check your wrangler login status.")
        print("Try running: wrangler d1 list")
        return False
    print("OK")
    
    # ==================== STEP 2: Export and upload data chunks ====================
    chunk_num = 1
    offset = 0
    total_uploaded = 0
    
    while offset < total:
        chunk_filename = f"d1_chunk_{chunk_num:02d}_data.sql"
        chunk_path = os.path.join(OUTPUT_DIR, chunk_filename)
        
        # Fetch rows
        rows = conn.execute(
            f"SELECT * FROM colas LIMIT {RECORDS_PER_CHUNK} OFFSET {offset}"
        ).fetchall()
        
        if not rows:
            break
        
        print(f"[{chunk_num + 1}/{num_chunks + 1}] Chunk {chunk_num:02d}: {len(rows):,} records...", end=" ", flush=True)
        
        # Write chunk file
        with open(chunk_path, 'w', encoding='utf-8') as f:
            f.write(f"-- Chunk {chunk_num:02d}: Records {offset+1:,} to {offset+len(rows):,}\n\n")
            
            for row in rows:
                row_dict = dict(row)
                
                # Extract day from approval_date (MM/DD/YYYY format)
                approval_date = row_dict.get('approval_date')
                if approval_date and '/' in str(approval_date):
                    try:
                        parts = str(approval_date).split('/')
                        if len(parts) == 3:
                            row_dict['day'] = int(parts[1])  # DD is the second part
                    except (ValueError, IndexError):
                        row_dict['day'] = None
                else:
                    row_dict['day'] = None
                
                values = []
                for col in target_columns:
                    val = row_dict.get(col)
                    values.append(escape_sql(val))
                
                columns_str = ', '.join(target_columns)
                values_str = ', '.join(values)
                
                f.write(f"INSERT INTO colas ({columns_str}) VALUES ({values_str});\n")
        
        success = run_wrangler(chunk_path)
        
        if not success:
            print("FAILED!")
            print(f"\nUpload failed at chunk {chunk_num}.")
            print(f"Records uploaded so far: {total_uploaded:,}")
            print(f"\nTo retry this chunk manually:")
            print(f"  wrangler d1 execute {D1_DATABASE_NAME} --remote --file={chunk_path}")
            return False
        
        total_uploaded += len(rows)
        print("OK")
        
        offset += RECORDS_PER_CHUNK
        chunk_num += 1
    
    conn.close()
    
    # ==================== DONE ====================
    print(f"\n{'='*60}")
    print("UPLOAD COMPLETE!")
    print(f"{'='*60}")
    print(f"Total records uploaded: {total_uploaded:,}")
    print(f"Database: {D1_DATABASE_NAME}")
    print(f"\nYour D1 database is now up to date.")
    
    return True

if __name__ == "__main__":
    success = export_and_upload()
    sys.exit(0 if success else 1)
