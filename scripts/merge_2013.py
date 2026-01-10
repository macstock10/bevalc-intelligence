#!/usr/bin/env python3
"""Merge 2013 monthly DBs into consolidated_colas.db"""
import sqlite3
import os
from pathlib import Path

DATA_DIR = Path(r"C:\Projects\bevalc-intelligence\scripts\data")
CONSOLIDATED = Path(r"C:\Projects\bevalc-intelligence\data\consolidated_colas.db")

# Get all 2013 files
files = sorted([f for f in DATA_DIR.glob("*.2013.db")])
print(f"Found {len(files)} 2013 database files")

conn = sqlite3.connect(CONSOLIDATED)

total_inserted = 0
for f in files:
    print(f"Merging: {f.name}...", end=" ")

    # Attach and merge
    conn.execute(f"ATTACH DATABASE '{f}' AS src")

    # Get count before
    before = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]

    # Insert records
    conn.execute("""
        INSERT OR IGNORE INTO colas
        (ttb_id, status, vendor_code, serial_number, class_type_code, origin_code,
         brand_name, fanciful_name, type_of_application, for_sale_in,
         total_bottle_capacity, formula, approval_date, qualifications,
         grape_varietal, wine_vintage, appellation, alcohol_content, ph_level,
         plant_registry, company_name, street, state, contact_person, phone_number,
         year, month)
        SELECT ttb_id, status, vendor_code, serial_number, class_type_code, origin_code,
               brand_name, fanciful_name, type_of_application, for_sale_in,
               total_bottle_capacity, formula, approval_date, qualifications,
               grape_varietal, wine_vintage, appellation, alcohol_content, ph_level,
               plant_registry, company_name, street, state, contact_person, phone_number,
               year, month
        FROM src.colas
    """)
    conn.commit()

    # Get count after
    after = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
    inserted = after - before
    total_inserted += inserted

    conn.execute("DETACH DATABASE src")
    print(f"{inserted:,} new records")

conn.close()
print(f"\nTotal inserted: {total_inserted:,}")
