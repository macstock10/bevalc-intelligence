#!/usr/bin/env python3
"""
Merge specific COLA database files into the consolidated database.

Usage:
    python merge_files.py file1.db file2.db file3.db
    
Examples:
    python merge_files.py data/jan.2022.db data/feb.2022.db
    python merge_files.py data/jan.2022.db data/jul.aug.2024.db data/dec.2023.db
    
You can list as many files as you want, in any order.
"""

import sqlite3
import os
import sys

# Configuration
DATA_DIR = "data"
CONSOLIDATED_DB = os.path.join(DATA_DIR, "consolidated_colas.db")

def ensure_consolidated_db():
    """Create consolidated DB with proper schema if it doesn't exist."""
    conn = sqlite3.connect(CONSOLIDATED_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS colas (
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
            month INTEGER
        )
    """)
    
    # Create indexes for faster queries
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ttb_id ON colas(ttb_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_brand ON colas(brand_name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON colas(approval_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_year_month ON colas(year, month)")
    
    conn.commit()
    conn.close()

def get_source_columns(source_conn):
    """Get column names from source database."""
    cursor = source_conn.execute("SELECT * FROM colas LIMIT 1")
    return [desc[0] for desc in cursor.description]

def merge_database(source_db_path):
    """Merge a single database file into consolidated."""
    
    source_conn = sqlite3.connect(source_db_path)
    source_conn.row_factory = sqlite3.Row
    
    dest_conn = sqlite3.connect(CONSOLIDATED_DB)
    
    # Target columns we want (excluding 'id' which auto-increments)
    target_columns = [
        'ttb_id', 'status', 'vendor_code', 'serial_number', 'class_type_code',
        'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
        'approval_date', 'qualifications', 'total_bottle_capacity', 'plant_registry',
        'company_name', 'street', 'state', 'contact_person', 'phone_number',
        'formula', 'for_sale_in', 'grape_varietal', 'wine_vintage', 'appellation',
        'alcohol_content', 'ph_level', 'year', 'month'
    ]
    
    # Get all records from source
    cursor = source_conn.execute("SELECT * FROM colas")
    
    inserted = 0
    skipped = 0
    
    for row in cursor:
        row_dict = dict(row)
        
        # Remove id field if present
        row_dict.pop('id', None)
        
        # Build values list matching target columns
        values = []
        columns_to_insert = []
        for col in target_columns:
            if col in row_dict:
                columns_to_insert.append(col)
                values.append(row_dict[col])
        
        placeholders = ['?' for _ in columns_to_insert]
        
        try:
            dest_conn.execute(
                f"INSERT OR IGNORE INTO colas ({', '.join(columns_to_insert)}) VALUES ({', '.join(placeholders)})",
                values
            )
            if dest_conn.total_changes > inserted + skipped:
                inserted += 1
            else:
                skipped += 1
        except sqlite3.IntegrityError:
            skipped += 1
    
    dest_conn.commit()
    source_conn.close()
    dest_conn.close()
    
    return inserted, skipped

def main():
    # Check if files were provided
    if len(sys.argv) < 2:
        print("\nUsage: python merge_files.py file1.db file2.db file3.db")
        print("\nExamples:")
        print("  python merge_files.py data/jan.2022.db data/feb.2022.db")
        print("  python merge_files.py data/jan.2022.db data/jul.aug.2024.db")
        print("\nYou can list as many files as you want.")
        return
    
    # Get list of files from command line
    files_to_merge = sys.argv[1:]
    
    print(f"\n{'='*60}")
    print("MERGING SPECIFIED FILES INTO CONSOLIDATED DATABASE")
    print(f"{'='*60}\n")
    
    # Ensure consolidated DB exists
    ensure_consolidated_db()
    
    # Get current count
    conn = sqlite3.connect(CONSOLIDATED_DB)
    before_count = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
    conn.close()
    print(f"Current consolidated DB: {before_count:,} records\n")
    
    print(f"Files to merge: {len(files_to_merge)}\n")
    
    total_inserted = 0
    total_skipped = 0
    successful = 0
    failed = 0
    
    for file_path in files_to_merge:
        # Check if file exists
        if not os.path.exists(file_path):
            print(f"  {file_path} - NOT FOUND (skipping)")
            failed += 1
            continue
        
        print(f"  Processing {file_path}...", end=" ", flush=True)
        
        try:
            inserted, skipped = merge_database(file_path)
            total_inserted += inserted
            total_skipped += skipped
            successful += 1
            print(f"OK - {inserted:,} new, {skipped:,} duplicates")
        except Exception as e:
            print(f"ERROR: {e}")
            failed += 1
    
    # Get final count
    conn = sqlite3.connect(CONSOLIDATED_DB)
    after_count = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
    conn.close()
    
    print(f"\n{'='*60}")
    print("MERGE COMPLETE")
    print(f"{'='*60}")
    print(f"Files processed: {successful} successful, {failed} failed")
    print(f"Records before:  {before_count:,}")
    print(f"Records after:   {after_count:,}")
    print(f"New records:     {after_count - before_count:,}")
    print(f"Duplicates:      {total_skipped:,}")

if __name__ == "__main__":
    main()
