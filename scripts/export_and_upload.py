#!/usr/bin/env python3
"""
Export COLA database and upload NEW records to Cloudflare D1.
Only uploads records that don't already exist in D1 (incremental sync).

Usage:
    python export_and_upload.py
    python export_and_upload.py --full   # Force full re-upload (drops and recreates table)

This script:
1. Compares local DB record count with D1
2. Uploads only new records using INSERT OR IGNORE
3. Uses D1 REST API for efficient batching
"""

import sqlite3
import os
import sys
import requests
import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

# =============================================================================
# CONFIG - Auto-detect paths (works on Windows and Linux/GitHub Actions)
# =============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent  # Goes up from /scripts to repo root

DATA_DIR = BASE_DIR / "data"
DB_PATH = str(DATA_DIR / "consolidated_colas.db")
ENV_FILE = str(BASE_DIR / ".env")

# D1 API batch size (using inline values, not parameters, so can be larger)
D1_BATCH_SIZE = 5000

# =============================================================================
# ENVIRONMENT LOADING
# =============================================================================

def load_env():
    """Load environment variables from .env file."""
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()

load_env()

# Cloudflare D1 Configuration
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

def validate_config():
    """Check that all required config is present."""
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not CLOUDFLARE_D1_DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if not CLOUDFLARE_API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")

    if missing:
        print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
        print(f"Please create a .env file at: {ENV_FILE}")
        sys.exit(1)

# D1 API endpoint
D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query" if CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID else None

# =============================================================================
# D1 API FUNCTIONS
# =============================================================================

def d1_execute(sql: str, params: List[Any] = None) -> Dict:
    """Execute a SQL query against Cloudflare D1."""
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    payload = {"sql": sql}
    if params:
        payload["params"] = params

    response = requests.post(D1_API_URL, headers=headers, json=payload)

    if response.status_code != 200:
        print(f"D1 API error: {response.status_code} - {response.text}")
        return {"success": False, "error": response.text}

    return response.json()


def d1_get_count() -> int:
    """Get current record count in D1."""
    result = d1_execute("SELECT COUNT(*) as cnt FROM colas")
    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [{}])[0].get("cnt", 0)
    return 0


def escape_sql_value(value) -> str:
    """Escape a value for inline SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    # Escape single quotes by doubling them
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def d1_insert_batch(records: List[Dict]) -> Dict:
    """Insert a batch of records into D1 using INSERT OR IGNORE with inline values."""
    if not records:
        return {"success": True, "inserted": 0}

    columns = [
        'ttb_id', 'status', 'vendor_code', 'serial_number', 'class_type_code',
        'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
        'for_sale_in', 'total_bottle_capacity', 'formula', 'approval_date',
        'qualifications', 'grape_varietal', 'wine_vintage', 'appellation',
        'alcohol_content', 'ph_level', 'plant_registry', 'company_name',
        'street', 'state', 'contact_person', 'phone_number', 'year', 'month'
    ]

    columns_str = ', '.join(columns)

    # Build individual INSERT statements (more reliable for large batches)
    statements = []
    for record in records:
        values = [escape_sql_value(record.get(col)) for col in columns]
        values_str = ', '.join(values)
        statements.append(f"INSERT OR IGNORE INTO colas ({columns_str}) VALUES ({values_str});")

    # Join all statements into one SQL block
    sql = '\n'.join(statements)

    result = d1_execute(sql)

    if result.get("success"):
        # Sum up changes from all statements
        total_changes = 0
        for res in result.get("result", []):
            total_changes += res.get("meta", {}).get("changes", 0)
        return {"success": True, "inserted": total_changes}
    else:
        return {"success": False, "inserted": 0, "error": result.get("error", "Unknown error")}


def d1_create_schema():
    """Create the colas table if it doesn't exist."""
    schema_sql = """
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
        month INTEGER,
        signal TEXT
    )
    """
    result = d1_execute(schema_sql)
    if not result.get("success"):
        print(f"Warning: Could not create schema: {result.get('error')}")
        return False

    # Create indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_colas_ttb ON colas(ttb_id)",
        "CREATE INDEX IF NOT EXISTS idx_colas_brand ON colas(brand_name)",
        "CREATE INDEX IF NOT EXISTS idx_colas_date ON colas(approval_date)",
        "CREATE INDEX IF NOT EXISTS idx_colas_origin ON colas(origin_code)",
        "CREATE INDEX IF NOT EXISTS idx_colas_class ON colas(class_type_code)",
        "CREATE INDEX IF NOT EXISTS idx_colas_status ON colas(status)",
        "CREATE INDEX IF NOT EXISTS idx_colas_ym ON colas(year, month)",
    ]
    for idx_sql in indexes:
        d1_execute(idx_sql)

    return True


def d1_drop_and_recreate():
    """Drop and recreate the colas table (for --full mode)."""
    print("Dropping existing table...")
    d1_execute("DROP TABLE IF EXISTS colas")
    print("Creating new table...")
    return d1_create_schema()

# =============================================================================
# MAIN SYNC FUNCTION
# =============================================================================

def sync_to_d1(full_mode: bool = False):
    """Sync local database to D1, uploading only new records."""

    print(f"\n{'='*60}")
    print("SYNC LOCAL DATABASE TO CLOUDFLARE D1")
    print(f"{'='*60}\n")

    # Check database exists
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        return False

    # Connect to local database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get local count
    local_count = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
    print(f"Local database: {local_count:,} records")

    # Full mode: drop and recreate
    if full_mode:
        print("\n[FULL MODE] Dropping and recreating D1 table...")
        if not d1_drop_and_recreate():
            print("ERROR: Failed to create schema")
            conn.close()
            return False
        d1_count = 0
    else:
        # Ensure schema exists
        d1_create_schema()
        # Get D1 count
        d1_count = d1_get_count()

    print(f"D1 database: {d1_count:,} records")

    # Calculate difference
    new_count = local_count - d1_count

    if new_count <= 0 and not full_mode:
        print(f"\nDatabases are in sync - nothing to upload!")
        conn.close()
        return True

    print(f"\nRecords to upload: {new_count:,}")

    # Fetch records to upload
    # We fetch the most recent records (highest IDs) that aren't in D1
    # Using LIMIT with ORDER BY id DESC gets the newest records
    if full_mode:
        print(f"\nFetching all {local_count:,} records...")
        cursor = conn.execute("SELECT * FROM colas ORDER BY id ASC")
    else:
        # Get records ordered by ID descending, limited to the difference + buffer
        # The buffer helps in case of any timing issues
        fetch_limit = new_count + 1000
        print(f"\nFetching up to {fetch_limit:,} recent records...")
        cursor = conn.execute(f"SELECT * FROM colas ORDER BY id DESC LIMIT {fetch_limit}")

    records = [dict(row) for row in cursor]
    conn.close()

    print(f"Fetched {len(records):,} records")

    # Upload in batches
    print(f"\nUploading to D1 (batch size: {D1_BATCH_SIZE})...")

    total_inserted = 0
    total_batches = (len(records) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE

    for i in range(0, len(records), D1_BATCH_SIZE):
        batch = records[i:i + D1_BATCH_SIZE]
        batch_num = i // D1_BATCH_SIZE + 1

        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} records)...", end=" ", flush=True)

        result = d1_insert_batch(batch)

        if result.get("success"):
            inserted = result.get("inserted", 0)
            total_inserted += inserted
            print(f"OK ({inserted} new)")
        else:
            print(f"ERROR: {result.get('error', 'Unknown')}")

    # Final count
    final_d1_count = d1_get_count()

    print(f"\n{'='*60}")
    print("SYNC COMPLETE")
    print(f"{'='*60}")
    print(f"Records uploaded: {total_inserted:,}")
    print(f"D1 now has: {final_d1_count:,} records")
    print(f"Local has: {local_count:,} records")

    if final_d1_count == local_count:
        print("\nDatabases are now in sync!")
    else:
        diff = local_count - final_d1_count
        print(f"\nNote: {diff:,} records difference (may be duplicates or schema differences)")

    return True

# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Sync local COLA database to Cloudflare D1')
    parser.add_argument('--full', action='store_true',
                        help='Force full re-upload (drops and recreates table)')

    args = parser.parse_args()

    validate_config()
    success = sync_to_d1(full_mode=args.full)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
