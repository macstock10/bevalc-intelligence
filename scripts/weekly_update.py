"""
weekly_update.py - Automated weekly COLA scraper and D1 sync

Runs every Friday at 9pm ET (via GitHub Actions):
1. Scrapes last 14 days from TTB
2. Adds new COLAs to local consolidated_colas.db
3. Syncs new records to Cloudflare D1
4. Classifies records (NEW_COMPANY, NEW_BRAND, etc.)
5. Logs results

USAGE:
    # Run manually
    python weekly_update.py

    # Dry run (no D1 push)
    python weekly_update.py --dry-run

    # Custom lookback period
    python weekly_update.py --days 7

    # Sync only (skip scraping, just push existing local data to D1)
    python weekly_update.py --sync-only

SETUP:
    1. Ensure cola_worker.py is in the same directory
    2. Configure paths below
    3. See .github/workflows/weekly-update.yml for GitHub Actions setup
"""

import os
import sys
import json
import sqlite3
import argparse
import logging
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

# Add scripts dir to path for imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

# Import shared D1 utilities
from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    escape_sql_value,
    d1_insert_batch,
    make_slug,
    update_brand_slugs,
    add_new_companies,
    get_company_id,
    normalize_company_for_match,
    classify_category,
)

# ============================================================================
# CONFIGURATION - Auto-detect paths (works on Windows and Linux/GitHub Actions)
# ============================================================================

# Base directory (goes up from /scripts to repo root)
BASE_DIR = SCRIPT_DIR.parent

# Paths relative to repo
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
EMAILS_DIR = BASE_DIR / "emails"

DB_PATH = str(DATA_DIR / "consolidated_colas.db")
LOG_FILE = str(LOGS_DIR / "weekly_update.log")
ENV_FILE = str(BASE_DIR / ".env")

# Default lookback period (days)
DEFAULT_LOOKBACK_DAYS = 7

# Load environment variables from .env file
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

# Cloudflare D1 Configuration (read from env, passed to lib.d1_utils)
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

# Batch size for D1 inserts (D1 has limits on query size)
D1_BATCH_SIZE = 500

# Validate required env vars
def validate_config():
    """Check config. D1 no longer required — data flows through JSON export only."""
    # D1 is DISABLED. No more writes to Cloudflare D1.
    # If D1 vars happen to be set, init them (for backward compat with classify_new_records
    # if someone ever re-enables it), but don't require them.
    if CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN:
        init_d1_config(
            account_id=CLOUDFLARE_ACCOUNT_ID,
            database_id=CLOUDFLARE_D1_DATABASE_ID,
            api_token=CLOUDFLARE_API_TOKEN,
            batch_size=D1_BATCH_SIZE,
            logger=logger
        )
        logger.info("D1 config loaded (but D1 sync is DISABLED)")
    else:
        logger.info("D1 credentials not set — D1 sync disabled (expected)")

# ============================================================================
# LOGGING SETUP
# ============================================================================

def setup_logging():
    """Setup logging to file and console."""
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

logger = setup_logging()

# ============================================================================
# CLOUDFLARE D1 SYNC FUNCTION
# ============================================================================

def sync_to_d1(local_db_path: str, dry_run: bool = False, records_to_sync: List[Dict] = None) -> Dict:
    """
    Sync records to Cloudflare D1.
    
    If records_to_sync is provided, only sync those records (fast path).
    Otherwise, sync all local records using INSERT OR IGNORE (D1 handles dedup).
    """
    logger.info("Starting D1 sync...")
    
    # Fast path: we already know which records to sync
    if records_to_sync is not None:
        logger.info(f"Syncing {len(records_to_sync):,} new records to D1...")
        
        if dry_run:
            logger.info("[DRY RUN] Would insert records to D1")
            return {"success": True, "dry_run": True, "inserted": 0, "new_records": records_to_sync}
        
        if not records_to_sync:
            logger.info("No records to sync")
            return {"success": True, "inserted": 0, "new_records": []}
        
        total_inserted = 0
        all_errors = []
        
        for i in range(0, len(records_to_sync), D1_BATCH_SIZE):
            batch = records_to_sync[i:i + D1_BATCH_SIZE]
            batch_num = i // D1_BATCH_SIZE + 1
            total_batches = (len(records_to_sync) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE
            
            logger.info(f"  Inserting batch {batch_num}/{total_batches} ({len(batch)} records)...")
            
            result = d1_insert_batch(batch)
            total_inserted += result.get("inserted", 0)
            
            if result.get("errors"):
                all_errors.extend(result["errors"])
        
        logger.info(f"Sync complete: {total_inserted:,} records inserted")

        # Update brand_slugs table with new brands for SEO pages
        update_brand_slugs(records_to_sync, dry_run)

        # Add new companies to companies/company_aliases tables
        add_new_companies(records_to_sync, dry_run)

        return {
            "success": True,
            "inserted": total_inserted,
            "attempted": len(records_to_sync),
            "errors": all_errors[:5] if all_errors else [],
            "new_records": records_to_sync
        }
    
    # Sync-only mode: Get local records and use INSERT OR IGNORE
    # D1 will handle duplicates - no need to fetch existing IDs
    if not os.path.exists(local_db_path):
        return {"success": False, "error": f"Local database not found: {local_db_path}"}
    
    try:
        # Get D1 count first for comparison
        count_result = d1_execute("SELECT COUNT(*) as cnt FROM colas")
        d1_count = 0
        if count_result.get("success") and count_result.get("result"):
            d1_count = count_result["result"][0].get("results", [{}])[0].get("cnt", 0)
        
        # Get local count
        conn = sqlite3.connect(local_db_path)
        conn.row_factory = sqlite3.Row
        local_count = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        logger.info(f"Local database has {local_count:,} records")
        logger.info(f"D1 database has {d1_count:,} records")
        
        if local_count == d1_count:
            logger.info("Databases are in sync - nothing to do")
            conn.close()
            return {"success": True, "inserted": 0, "new_records": []}
        
        new_count = local_count - d1_count
        logger.info(f"New records to sync: {new_count:,}")
        
        if dry_run:
            logger.info("[DRY RUN] Would insert records to D1")
            conn.close()
            return {
                "success": True,
                "dry_run": True,
                "new_records_count": new_count,
                "total_local": local_count,
                "total_d1": d1_count
            }
        
        # Get all local records and insert with INSERT OR IGNORE
        # D1 will skip duplicates automatically
        logger.info("Fetching local records for sync...")
        cursor = conn.execute("SELECT * FROM colas ORDER BY id DESC LIMIT ?", [new_count + 1000])  # Small buffer
        
        records = [dict(row) for row in cursor]
        conn.close()
        
        logger.info(f"Syncing {len(records):,} records (INSERT OR IGNORE)...")
        
        total_inserted = 0
        all_errors = []
        
        for i in range(0, len(records), D1_BATCH_SIZE):
            batch = records[i:i + D1_BATCH_SIZE]
            batch_num = i // D1_BATCH_SIZE + 1
            total_batches = (len(records) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE
            
            logger.info(f"  Inserting batch {batch_num}/{total_batches} ({len(batch)} records)...")
            
            result = d1_insert_batch(batch)
            total_inserted += result.get("inserted", 0)
            
            if result.get("errors"):
                all_errors.extend(result["errors"])
        
        logger.info(f"Sync complete: {total_inserted:,} records inserted")

        # Update brand_slugs table with new brands for SEO pages
        synced_records = records[:total_inserted] if total_inserted > 0 else []
        update_brand_slugs(synced_records, dry_run)

        # Add new companies to companies/company_aliases tables
        add_new_companies(synced_records, dry_run)

        return {
            "success": True,
            "inserted": total_inserted,
            "attempted": len(records),
            "errors": all_errors[:5] if all_errors else [],
            "new_records": synced_records
        }
        
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

# ============================================================================
# SCRAPING - Using ColaWorker
# ============================================================================

# Import ColaWorker for scraping (consolidated, robust scraper)
try:
    from cola_worker import ColaWorker
    SCRAPER_AVAILABLE = True
except ImportError:
    SCRAPER_AVAILABLE = False
    logger.warning("ColaWorker not available - scraping disabled")


def scrape_recent_days(days: int = 7) -> Dict:
    """
    Scrape the last N days of COLAs using ColaWorker.
    Returns stats dict with temp_db path for further processing.
    """
    if not SCRAPER_AVAILABLE:
        return {'success': False, 'error': 'ColaWorker not available'}

    logger.info(f"Scraping last {days} days from TTB...")

    # Calculate exact date range
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    logger.info(f"Date range: {start_date.date()} to {end_date.date()}")

    # Create a temporary database for this scrape
    temp_db = os.path.join(os.path.dirname(DB_PATH), "weekly_temp.db")

    # Remove old temp db if exists
    if os.path.exists(temp_db):
        os.remove(temp_db)

    worker = None
    try:
        # Use ColaWorker with robust retry logic
        worker = ColaWorker(
            name="weekly_update",
            db_path=temp_db,
            headless=True,
            request_delay=1.5,
            page_timeout=30,
            max_retries=3
        )

        # Process the date range
        result = worker.process_date_range(start_date, end_date)

        # Get total COLAs from the temp database
        conn = sqlite3.connect(temp_db)
        total_colas = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        conn.close()

        worker.close()

        return {
            'success': True,
            'temp_db': temp_db,
            'links': result.get('collected_links', 0),
            'colas': total_colas,
            'start_date': start_date.date().isoformat(),
            'end_date': end_date.date().isoformat(),
            'verified': result.get('details_verified', False),
        }

    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        if worker:
            worker.close()
        return {
            'success': False,
            'error': str(e)
        }


def scrape_date_range(start_date: datetime, end_date: datetime) -> Dict:
    """
    Scrape COLAs for a specific date range using ColaWorker.
    Returns stats dict with temp_db path for further processing.
    """
    if not SCRAPER_AVAILABLE:
        return {'success': False, 'error': 'ColaWorker not available'}

    logger.info(f"Scraping date range: {start_date.date()} to {end_date.date()}")

    # Create a temporary database for this scrape
    temp_db = os.path.join(os.path.dirname(DB_PATH), "weekly_temp.db")

    # Remove old temp db if exists
    if os.path.exists(temp_db):
        os.remove(temp_db)

    worker = None
    try:
        # Use ColaWorker with robust retry logic
        worker = ColaWorker(
            name="weekly_update",
            db_path=temp_db,
            headless=True,
            request_delay=1.5,
            page_timeout=30,
            max_retries=3
        )

        # Process the date range
        result = worker.process_date_range(start_date, end_date)

        # Get total COLAs from the temp database
        conn = sqlite3.connect(temp_db)
        total_colas = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        conn.close()

        worker.close()

        return {
            'success': True,
            'temp_db': temp_db,
            'links': result.get('collected_links', 0),
            'colas': total_colas,
            'start_date': start_date.date().isoformat(),
            'end_date': end_date.date().isoformat(),
            'verified': result.get('details_verified', False),
        }

    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        if worker:
            worker.close()
        return {
            'success': False,
            'error': str(e)
        }


# ============================================================================
# MERGING
# ============================================================================

def merge_new_data(temp_db: str) -> Dict:
    """
    Merge new data from temp database into consolidated database.
    Returns stats dict INCLUDING the actual new records for D1 sync.
    """
    logger.info(f"Merging new data into {DB_PATH}...")

    if not os.path.exists(temp_db):
        return {'success': False, 'error': 'Temp database not found'}

    try:
        # Connect to both databases
        src = sqlite3.connect(temp_db)
        src.row_factory = sqlite3.Row
        dst = sqlite3.connect(DB_PATH)

        # Get column names from destination to handle schema differences
        dst_cols = set(row[1] for row in dst.execute("PRAGMA table_info(colas)").fetchall())
        has_day_column = 'day' in dst_cols

        # Merge COLAs
        rows = src.execute("SELECT * FROM colas").fetchall()

        added = 0
        new_records = []  # Track the actual records that were added

        for row in rows:
            r = dict(row)
            try:
                if has_day_column:
                    dst.execute("""
                        INSERT OR IGNORE INTO colas
                        (ttb_id, status, vendor_code, serial_number, class_type_code,
                         origin_code, brand_name, fanciful_name, type_of_application,
                         for_sale_in, total_bottle_capacity, formula, approval_date,
                         qualifications, grape_varietal, wine_vintage, appellation,
                         alcohol_content, ph_level, plant_registry, company_name,
                         street, state, contact_person, phone_number, year, month, day)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        r.get('ttb_id'), r.get('status'), r.get('vendor_code'),
                        r.get('serial_number'), r.get('class_type_code'),
                        r.get('origin_code'), r.get('brand_name'),
                        r.get('fanciful_name'), r.get('type_of_application'),
                        r.get('for_sale_in'), r.get('total_bottle_capacity'),
                        r.get('formula'), r.get('approval_date'),
                        r.get('qualifications'), r.get('grape_varietal'),
                        r.get('wine_vintage'), r.get('appellation'),
                        r.get('alcohol_content'), r.get('ph_level'),
                        r.get('plant_registry'), r.get('company_name'),
                        r.get('street'), r.get('state'),
                        r.get('contact_person'), r.get('phone_number'),
                        r.get('year'), r.get('month'), r.get('day')
                    ))
                else:
                    # Local DB doesn't have 'day' column - skip it
                    dst.execute("""
                        INSERT OR IGNORE INTO colas
                        (ttb_id, status, vendor_code, serial_number, class_type_code,
                         origin_code, brand_name, fanciful_name, type_of_application,
                         for_sale_in, total_bottle_capacity, formula, approval_date,
                         qualifications, grape_varietal, wine_vintage, appellation,
                         alcohol_content, ph_level, plant_registry, company_name,
                         street, state, contact_person, phone_number, year, month)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        r.get('ttb_id'), r.get('status'), r.get('vendor_code'),
                        r.get('serial_number'), r.get('class_type_code'),
                        r.get('origin_code'), r.get('brand_name'),
                        r.get('fanciful_name'), r.get('type_of_application'),
                        r.get('for_sale_in'), r.get('total_bottle_capacity'),
                        r.get('formula'), r.get('approval_date'),
                        r.get('qualifications'), r.get('grape_varietal'),
                        r.get('wine_vintage'), r.get('appellation'),
                        r.get('alcohol_content'), r.get('ph_level'),
                        r.get('plant_registry'), r.get('company_name'),
                        r.get('street'), r.get('state'),
                        r.get('contact_person'), r.get('phone_number'),
                        r.get('year'), r.get('month')
                    ))
                if dst.execute("SELECT changes()").fetchone()[0] > 0:
                    added += 1
                    new_records.append(r)  # Save the record that was actually added
            except Exception as e:
                logger.warning(f"Failed to insert {r.get('ttb_id')}: {e}")
        
        dst.commit()
        
        # Get total count
        total = dst.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        src.close()
        dst.close()
        
        # Clean up temp database
        os.remove(temp_db)
        logger.info(f"Removed temp database: {temp_db}")
        
        return {
            'success': True,
            'added': added,
            'total': total,
            'new_records': new_records  # Return the actual records
        }
        
    except Exception as e:
        logger.error(f"Merge failed: {e}")
        return {'success': False, 'error': str(e)}

# ============================================================================
# BATCH CLASSIFICATION (optimized - fetches all data upfront)
# ============================================================================

def classify_new_records(new_records: List[Dict]) -> Dict:
    """
    Classify new records using NORMALIZED company IDs and UPDATE their signal in D1.

    OPTIMIZED VERSION: Fetches all existing data in 3 queries instead of per-record.

    Uses company_aliases to map raw company_name to normalized company_id.
    This ensures "ABC Inc" and "ABC Inc." are treated as the same company.

    Priority order (highest to lowest):
    1. NEW_COMPANY = first time seeing this normalized company
    2. NEW_BRAND = company exists, but first time seeing company_id + brand_name
    3. NEW_SKU = company+brand exists, but first time seeing company_id + brand + fanciful_name
    4. REFILE = we've seen company_id + brand + fanciful_name before
    """
    if not new_records:
        return {'total': 0, 'new_companies': 0, 'new_brands': 0, 'new_skus': 0, 'refiles': 0}

    logger.info(f"Classifying {len(new_records):,} new records (batch mode)...")

    stats = {
        'total': len(new_records),
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0,
        'new_company_list': [],
        'new_brand_list': [],
        'new_sku_list': []
    }

    # Step 1: Fetch ALL company_aliases into memory (one query)
    logger.info("  Fetching company aliases...")
    aliases_result = d1_execute("SELECT raw_name, company_id FROM company_aliases")
    company_aliases = {}
    if aliases_result.get("success") and aliases_result.get("result"):
        for row in aliases_result["result"][0].get("results", []):
            raw_name = (row.get('raw_name') or '').strip()
            if raw_name:
                company_aliases[raw_name.upper()] = row.get('company_id')
                normalized = normalize_company_for_match(raw_name)
                if normalized:
                    company_aliases[normalized] = row.get('company_id')
    logger.info(f"  Loaded {len(company_aliases):,} company aliases")

    # Helpers to normalize names and get company_id from local cache
    def normalize_company_key(company_name: str) -> str:
        return normalize_company_for_match(company_name)

    def get_company_id_cached(company_name: str) -> int:
        return company_aliases.get(normalize_company_key(company_name))

    # Step 2: Get all unique company_ids from new records
    batch_company_ids = set()
    for record in new_records:
        company_name = record.get('company_name', '') or ''
        cid = get_company_id_cached(company_name)
        if cid is not None:
            batch_company_ids.add(cid)

    # Step 3: Fetch existing companies (company_ids that have filings BEFORE this batch)
    logger.info("  Fetching existing companies...")
    existing_companies = set()
    if batch_company_ids:
        # Get company_ids that have existing filings (not in current batch)
        # We need to get ttb_ids from current batch to exclude them
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                existing_companies.add(row.get('company_id'))
    logger.info(f"  Found {len(existing_companies):,} companies with prior filings")

    # Step 4: Fetch existing brands (company_id + brand_name pairs that exist BEFORE this batch)
    # Use .lower() for case-insensitive matching (consistent with batch_classify.py)
    logger.info("  Fetching existing brands...")
    existing_brands = set()
    if batch_company_ids:
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id, c.brand_name
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
            AND c.brand_name IS NOT NULL
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                cid = row.get('company_id')
                brand = row.get('brand_name', '')
                if cid and brand:
                    existing_brands.add((cid, brand.lower()))
    logger.info(f"  Found {len(existing_brands):,} existing company-brand pairs")

    # Step 5: Fetch existing SKUs (company_id + brand_name + fanciful_name that exist BEFORE this batch)
    # Use .lower() for case-insensitive matching (consistent with batch_classify.py)
    logger.info("  Fetching existing SKUs...")
    existing_skus = set()
    if batch_company_ids:
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id, c.brand_name, c.fanciful_name
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
            AND c.brand_name IS NOT NULL
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                cid = row.get('company_id')
                brand = row.get('brand_name', '')
                fanciful = row.get('fanciful_name', '') or ''
                if cid and brand:
                    existing_skus.add((cid, brand.lower(), fanciful.lower()))
    logger.info(f"  Found {len(existing_skus):,} existing SKUs")

    # Step 6: Classify each record (all in memory, no API calls)
    logger.info("  Classifying records...")

    # Track what we've seen within this batch (for handling duplicates)
    seen_companies = set()
    seen_brands = set()
    seen_skus = set()

    # Track unknown companies (not in aliases table)
    seen_unknown_companies = set()
    seen_unknown_brands = set()
    seen_unknown_skus = set()

    classifications = []

    for record in new_records:
        ttb_id = record.get('ttb_id')
        company_name = (record.get('company_name', '') or '').strip()
        brand_name = (record.get('brand_name', '') or '').strip()
        fanciful_name = (record.get('fanciful_name', '') or '').strip()

        if not company_name or not brand_name:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            continue

        company_id = get_company_id_cached(company_name)

        if company_id is None:
            # Company not in aliases table - track by normalized company_name (uppercase for consistency)
            company_key_unknown = normalize_company_key(company_name)
            brand_key_unknown = (company_key_unknown, brand_name.lower())
            sku_key_unknown = (company_key_unknown, brand_name.lower(), fanciful_name.lower())

            if company_key_unknown not in seen_unknown_companies:
                classifications.append((ttb_id, 'NEW_COMPANY'))
                stats['new_companies'] += 1
                if len(stats['new_company_list']) < 20:
                    stats['new_company_list'].append(company_name[:40])
                seen_unknown_companies.add(company_key_unknown)
                seen_unknown_brands.add(brand_key_unknown)
                seen_unknown_skus.add(sku_key_unknown)
            elif brand_key_unknown not in seen_unknown_brands:
                classifications.append((ttb_id, 'NEW_BRAND'))
                stats['new_brands'] += 1
                if len(stats['new_brand_list']) < 20:
                    stats['new_brand_list'].append(f"{brand_name} ({company_name[:25]})")
                seen_unknown_brands.add(brand_key_unknown)
                seen_unknown_skus.add(sku_key_unknown)
            elif sku_key_unknown not in seen_unknown_skus:
                classifications.append((ttb_id, 'NEW_SKU'))
                stats['new_skus'] += 1
                if len(stats['new_sku_list']) < 20:
                    stats['new_sku_list'].append(f"{brand_name} - {fanciful_name[:30]}")
                seen_unknown_skus.add(sku_key_unknown)
            else:
                classifications.append((ttb_id, 'REFILE'))
                stats['refiles'] += 1
            continue

        # Check if company existed BEFORE this batch (using pre-fetched data)
        company_existed_before = company_id in existing_companies

        # Use .lower() for brand/sku matching (consistent with existing_brands/existing_skus sets)
        brand_key = (company_id, brand_name.lower())
        sku_key = (company_id, brand_name.lower(), fanciful_name.lower())

        if not company_existed_before and company_id not in seen_companies:
            classifications.append((ttb_id, 'NEW_COMPANY'))
            stats['new_companies'] += 1
            if len(stats['new_company_list']) < 20:
                stats['new_company_list'].append(company_name[:40])
            seen_companies.add(company_id)
            seen_brands.add(brand_key)
            seen_skus.add(sku_key)
            continue

        seen_companies.add(company_id)

        # Check if brand existed BEFORE this batch
        brand_existed_before = brand_key in existing_brands

        if not brand_existed_before and brand_key not in seen_brands:
            classifications.append((ttb_id, 'NEW_BRAND'))
            stats['new_brands'] += 1
            if len(stats['new_brand_list']) < 20:
                stats['new_brand_list'].append(f"{brand_name} ({company_name[:25]})")
            seen_brands.add(brand_key)
            seen_skus.add(sku_key)
            continue

        seen_brands.add(brand_key)

        # Check if SKU existed BEFORE this batch
        sku_existed_before = sku_key in existing_skus

        if not sku_existed_before and sku_key not in seen_skus:
            classifications.append((ttb_id, 'NEW_SKU'))
            stats['new_skus'] += 1
            if len(stats['new_sku_list']) < 20:
                stats['new_sku_list'].append(f"{brand_name} - {fanciful_name[:30]}")
            seen_skus.add(sku_key)
        else:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            seen_skus.add(sku_key)

    # Step 7: Apply all classifications to D1 (batch updates)
    logger.info(f"  Applying {len(classifications)} classifications to D1...")

    # Group by signal for batch updates
    by_signal = {}
    for ttb_id, signal in classifications:
        if signal not in by_signal:
            by_signal[signal] = []
        by_signal[signal].append(ttb_id)

    for signal, ttb_ids in by_signal.items():
        # Update in batches of 100 to avoid query size limits
        for i in range(0, len(ttb_ids), 100):
            batch = ttb_ids[i:i+100]
            ids_str = ','.join(f"'{tid}'" for tid in batch)
            d1_execute(f"UPDATE colas SET signal = '{signal}' WHERE ttb_id IN ({ids_str})")

    logger.info(f"Classification complete:")
    logger.info(f"  New companies: {stats['new_companies']:,}")
    logger.info(f"  New brands: {stats['new_brands']:,}")
    logger.info(f"  New SKUs: {stats['new_skus']:,}")
    logger.info(f"  Refiles: {stats['refiles']:,}")

    # Include signal map so callers can access per-record signals
    stats['signal_map'] = {ttb_id: signal for ttb_id, signal in classifications}

    return stats

# ============================================================================
# WEBSITE ENRICHMENT OUTPUT
# ============================================================================

def output_enrichment_list(new_records: List[Dict], classify_result: Dict):
    """
    Output a list of new brands/companies that need website enrichment.
    Only includes NEW_COMPANY and NEW_BRAND signals (not NEW_SKU or REFILE).
    Creates a file that can be used for manual enrichment with Claude.
    """
    if not new_records:
        return

    # Query D1 for records needing website enrichment
    # CRITICAL ORDER:
    # 1. All NEW_COMPANY/NEW_BRAND/NEW_SKU first (by date DESC, then signal priority)
    # 2. Then ALL REFILE records last (by date DESC)
    # This ensures high-value signals get enriched across all dates before touching refiles
    query = """
        SELECT DISTINCT c.brand_name, c.company_name, c.class_type_code, c.signal, c.approval_date
        FROM colas c
        LEFT JOIN brand_websites bw ON UPPER(c.brand_name) = UPPER(bw.brand_name)
        WHERE c.signal IN ('NEW_COMPANY', 'NEW_BRAND', 'NEW_SKU', 'REFILE')
        AND bw.brand_name IS NULL
        AND c.brand_name IS NOT NULL
        AND c.brand_name != ''
        ORDER BY
            CASE c.signal WHEN 'REFILE' THEN 1 ELSE 0 END,
            substr(c.approval_date, 7, 4) || substr(c.approval_date, 1, 2) || substr(c.approval_date, 4, 2) DESC,
            CASE c.signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 ELSE 4 END,
            c.brand_name
    """

    result = d1_execute(query)
    if not result.get("success") or not result.get("result"):
        logger.warning("Failed to query for enrichment candidates")
        return

    rows = result["result"][0].get("results", [])
    if not rows:
        logger.info("No new brands need website enrichment")
        return

    # Build enrichment list (already deduplicated by DISTINCT)
    # Sorted by: most recent approval_date DESC, then NEW_COMPANY before NEW_BRAND
    needs_enrichment = []
    for row in rows:
        needs_enrichment.append({
            'brand_name': row.get('brand_name', ''),
            'company_name': row.get('company_name', ''),
            'class_type_code': row.get('class_type_code', ''),
            'signal': row.get('signal', ''),
            'approval_date': row.get('approval_date', '')
        })

    # Output to file
    enrichment_file = os.path.join(LOGS_DIR, "needs_enrichment.json")
    with open(enrichment_file, 'w') as f:
        json.dump(needs_enrichment, f, indent=2)

    # Count by signal type
    new_companies = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_COMPANY')
    new_brands = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_BRAND')
    new_skus = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_SKU')
    refiles = sum(1 for x in needs_enrichment if x.get('signal') == 'REFILE')

    logger.info(f"Brands needing website enrichment: {len(needs_enrichment)} ({new_companies} NEW_COMPANY, {new_brands} NEW_BRAND, {new_skus} NEW_SKU, {refiles} REFILE)")
    logger.info(f"Enrichment list saved to: {enrichment_file}")

    # Also log first 10 for visibility (now sorted by approval_date DESC)
    if needs_enrichment:
        logger.info("First 10 brands needing enrichment (most recent first):")
        for item in needs_enrichment[:10]:
            signal = item.get('signal', '')
            date = item.get('approval_date', '')
            logger.info(f"  [{date}] [{signal}] {item['brand_name']} ({item['company_name'][:30]})")


# ============================================================================
# WATCHLIST ALERTS
# ============================================================================

def check_watchlist_and_alert(new_records: List[Dict], dry_run: bool = False) -> Dict:
    """
    Check new records against user watchlists and send real-time alerts.

    Returns dict with stats on matches and alerts sent.
    """
    if not new_records:
        return {'matches': 0, 'alerts_sent': 0}

    logger.info(f"Checking {len(new_records):,} new records against watchlists...")

    # Get all watchlist entries
    watchlist_result = d1_execute("SELECT email, type, value FROM watchlist")
    if not watchlist_result.get("success") or not watchlist_result.get("result"):
        logger.warning("Failed to fetch watchlist entries")
        return {'matches': 0, 'alerts_sent': 0, 'error': 'Failed to fetch watchlist'}

    watchlist_entries = watchlist_result["result"][0].get("results", [])
    if not watchlist_entries:
        logger.info("No watchlist entries found")
        return {'matches': 0, 'alerts_sent': 0}

    logger.info(f"Found {len(watchlist_entries)} watchlist entries")

    # Group watchlist by email for efficient matching
    # Structure: {email: {'brands': set(), 'companies': set()}}
    watchlist_by_user = {}
    for entry in watchlist_entries:
        email = entry.get('email', '').lower()
        entry_type = entry.get('type', '')
        value = entry.get('value', '').upper()  # Normalize to uppercase for matching

        if email not in watchlist_by_user:
            watchlist_by_user[email] = {'brands': set(), 'companies': set()}

        if entry_type == 'brand':
            watchlist_by_user[email]['brands'].add(value)
        elif entry_type == 'company':
            watchlist_by_user[email]['companies'].add(value)

    # Check each new record against watchlists
    # Structure: {email: [matched_records]}
    matches_by_user = {}
    total_matches = 0

    for record in new_records:
        brand_name = (record.get('brand_name', '') or '').upper()
        company_name = (record.get('company_name', '') or '').upper()

        for email, watches in watchlist_by_user.items():
            matched = False
            match_type = None

            # Check brand match
            if brand_name and brand_name in watches['brands']:
                matched = True
                match_type = 'brand'

            # Check company match (partial match for company names)
            if not matched and company_name:
                for watched_company in watches['companies']:
                    if watched_company in company_name or company_name in watched_company:
                        matched = True
                        match_type = 'company'
                        break

            if matched:
                if email not in matches_by_user:
                    matches_by_user[email] = []
                matches_by_user[email].append({
                    'record': record,
                    'match_type': match_type
                })
                total_matches += 1

    logger.info(f"Found {total_matches} watchlist matches for {len(matches_by_user)} users")

    if not matches_by_user:
        return {'matches': 0, 'alerts_sent': 0}

    if dry_run:
        logger.info("[DRY RUN] Would send alerts to:")
        for email, matches in matches_by_user.items():
            logger.info(f"  {email}: {len(matches)} matches")
        return {'matches': total_matches, 'alerts_sent': 0, 'dry_run': True}

    # Send alerts via Node.js email sender (uses React Email templates)
    alerts_sent = 0
    resend_api_key = os.environ.get('RESEND_API_KEY')

    if not resend_api_key:
        logger.warning("RESEND_API_KEY not set, skipping alert emails")
        return {'matches': total_matches, 'alerts_sent': 0, 'error': 'No RESEND_API_KEY'}

    for email, matches in matches_by_user.items():
        try:
            # Build matches array for the template
            matches_data = []
            for m in matches[:20]:  # Limit to 20 matches per email
                r = m['record']
                matches_data.append({
                    'brandName': r.get('brand_name', 'Unknown'),
                    'fancifulName': r.get('fanciful_name', '') or '',
                    'companyName': (r.get('company_name', 'Unknown') or '')[:50],
                    'signal': r.get('signal', 'FILING')
                })

            # Create the Node.js script to send the email
            matches_json = json.dumps(matches_data)

            email_json = json.dumps(email)
            send_script = f'''
import {{ sendWatchlistAlert }} from './send.js';

const result = await sendWatchlistAlert({{
    to: {email_json},
    matchCount: {len(matches)},
    matches: {matches_json}
}});

if (result.error) {{
    console.error("Error:", result.error.message);
    process.exit(1);
}} else {{
    console.log("Success:", result.data?.id);
}}
'''
            # Write temp script
            temp_script = EMAILS_DIR / "_send_alert_temp.js"
            with open(temp_script, 'w') as f:
                f.write(send_script)

            try:
                result = subprocess.run(
                    f"npx tsx {temp_script.name}",
                    cwd=str(EMAILS_DIR),
                    capture_output=True,
                    text=True,
                    timeout=30,
                    shell=True  # Required on Windows
                )

                if result.returncode == 0:
                    alerts_sent += 1
                    logger.info(f"  Sent alert to {email}: {len(matches)} matches")
                else:
                    logger.warning(f"  Failed to send alert to {email}: {result.stderr}")

            except subprocess.TimeoutExpired:
                logger.error(f"  Timeout sending alert to {email}")
            finally:
                # Clean up temp script
                if temp_script.exists():
                    temp_script.unlink()

        except Exception as e:
            logger.error(f"  Error sending alert to {email}: {e}")

    logger.info(f"Sent {alerts_sent} watchlist alerts")

    return {
        'matches': total_matches,
        'alerts_sent': alerts_sent,
        'users_notified': len(matches_by_user)
    }


# ============================================================================
# MAIN
# ============================================================================

def get_records_from_temp_db(temp_db: str) -> List[Dict]:
    """
    Read all COLA records from the temp scrape database.
    Used when there's no local consolidated DB (GitHub Actions).
    """
    if not os.path.exists(temp_db):
        return []

    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM colas").fetchall()
    records = [dict(row) for row in rows]
    conn.close()
    return records


def export_records_to_json(records: List[Dict], signal_map: Dict[str, str]) -> str:
    """
    Export new COLA records to a JSON file for local DB ingestion via git pull.

    Writes to local-browser/daily_sync/YYYY-MM-DD.json with all scraped fields
    plus signal classification and category.

    Args:
        records: List of COLA record dicts from scraper
        signal_map: Dict mapping ttb_id -> signal (from classify_new_records)

    Returns:
        Path to the written JSON file, or None if no records
    """
    if not records:
        logger.info("No records to export to JSON")
        return None

    # Build output directory
    sync_dir = os.path.join(os.path.dirname(__file__), '..', 'local-browser', 'daily_sync')
    os.makedirs(sync_dir, exist_ok=True)

    # Use today's date for the filename
    today = datetime.now().strftime('%Y-%m-%d')
    output_path = os.path.join(sync_dir, f'{today}.json')

    # If file already exists (e.g. multiple runs in one day), append a counter
    if os.path.exists(output_path):
        counter = 2
        while os.path.exists(os.path.join(sync_dir, f'{today}-{counter}.json')):
            counter += 1
        output_path = os.path.join(sync_dir, f'{today}-{counter}.json')

    # Enrich each record with signal and category
    enriched_records = []
    for record in records:
        r = dict(record)  # copy
        ttb_id = r.get('ttb_id', '')
        r['signal'] = signal_map.get(ttb_id, 'REFILE')
        r['category'] = classify_category(r.get('class_type_code', ''))
        enriched_records.append(r)

    payload = {
        'exported_at': datetime.now().isoformat(),
        'count': len(enriched_records),
        'records': enriched_records,
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, default=str)

    logger.info(f"Exported {len(enriched_records)} records to {output_path}")
    return output_path


def run_weekly_update(days: int = DEFAULT_LOOKBACK_DAYS, dry_run: bool = False, sync_only: bool = False,
                      start_date: datetime = None, end_date: datetime = None):
    """
    Run the full weekly update pipeline.

    Handles two scenarios:
    - Local machine (Windows): consolidated_colas.db exists, merge new data into it
    - GitHub Actions: No local DB, sync scraped records directly to D1

    Args:
        days: Lookback period (used if start_date/end_date not provided)
        dry_run: If True, skip D1 push
        sync_only: If True, skip scraping
        start_date: Explicit start date (optional)
        end_date: Explicit end date (optional)
    """
    logger.info("=" * 60)
    logger.info("WEEKLY COLA UPDATE")
    logger.info(f"Started: {datetime.now()}")
    logger.info("=" * 60)

    # Check if we have a local consolidated DB
    has_local_db = os.path.exists(DB_PATH)
    if has_local_db:
        logger.info(f"Local DB found: {DB_PATH}")
    else:
        logger.info(f"No local DB at {DB_PATH} (GitHub Actions mode)")

    results = {}
    new_records = []

    if not sync_only:
        # Step 1: Scrape
        logger.info("\n[STEP 1/4] Scraping TTB...")
        if start_date and end_date:
            scrape_result = scrape_date_range(start_date, end_date)
        else:
            scrape_result = scrape_recent_days(days)
        results['scrape'] = scrape_result

        if not scrape_result.get('success'):
            logger.error("Scraping failed, aborting")
            return results

        temp_db = scrape_result['temp_db']

        # Step 2: Merge to local DB OR read directly from temp DB
        if has_local_db:
            # Local machine: merge into consolidated DB
            logger.info("\n[STEP 2/4] Merging new data to local DB...")
            merge_result = merge_new_data(temp_db)
            results['merge'] = merge_result

            if not merge_result.get('success'):
                logger.error("Merge failed, aborting")
                return results

            # Get the new records from merge
            new_records = merge_result.get('new_records', [])
        else:
            # GitHub Actions: no local DB, read records directly from temp DB
            logger.info("\n[STEP 2/4] No local DB - reading scraped records directly...")
            new_records = get_records_from_temp_db(temp_db)
            results['merge'] = {
                'skipped': True,
                'reason': 'No local consolidated DB',
                'records_from_temp': len(new_records)
            }
            logger.info(f"Read {len(new_records):,} records from temp DB")

            # Clean up temp DB
            if os.path.exists(temp_db):
                os.remove(temp_db)
                logger.info(f"Removed temp database: {temp_db}")

        # Step 3: D1 sync DISABLED — all data flows through JSON export now.
        # D1 was costing $2K+/month from unindexed queries. Local SQLite replaces it.
        logger.info("\n[STEP 3/4] D1 sync DISABLED — using JSON export to local SQLite instead")
        results['sync'] = {'skipped': True, 'reason': 'D1 disabled — local-only mode'}

    else:
        # Sync-only mode no longer supported (D1 disabled)
        logger.error("--sync-only is no longer supported (D1 disabled)")
        results['sync'] = {'success': False, 'error': 'D1 disabled'}
        return results

    # Step 4 (was Step 5): Export records to JSON for local DB sync via git pull
    # Signal classification happens locally in merge-daily.py against full 2.8M row history
    logger.info("\n[STEP 4/4] Exporting records to JSON for local sync...")
    if not dry_run and new_records:
        # No D1 classification — pass empty signal_map. merge-daily.py re-classifies locally.
        json_path = export_records_to_json(new_records, {})
        results['json_export'] = {'path': json_path, 'count': len(new_records)}
        results['classify'] = {'total': len(new_records), 'note': 'Classification deferred to local merge-daily.py'}
    else:
        logger.info("Skipped JSON export (dry run or no new records)")
        results['json_export'] = {'path': None, 'count': 0}
        results['classify'] = {'total': 0}
    results['alerts'] = {'matches': 0, 'alerts_sent': 0, 'note': 'Handled by watchlist-alerts.yml'}
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    
    if not sync_only:
        logger.info(f"Scraped: {results.get('scrape', {}).get('colas', 0):,} COLAs")
        logger.info(f"Added to local: {results.get('merge', {}).get('added', 0):,} new COLAs")
        logger.info(f"Local total: {results.get('merge', {}).get('total', 0):,} COLAs")
    
    # JSON export summary (D1 sync disabled)
    json_export = results.get('json_export', {})
    logger.info(f"Exported to JSON: {json_export.get('count', 0):,} new COLAs")
    if json_export.get('path'):
        logger.info(f"  File: {json_export['path']}")

    logger.info(f"Completed: {datetime.now()}")
    logger.info("=" * 60)

    # Write inserted count for downstream workflows to read
    # Use JSON export count since D1 sync is disabled
    inserted = results.get('json_export', {}).get('count', 0)
    count_file = os.path.join(os.path.dirname(__file__), '..', 'data', 'sync_inserted_count.txt')
    os.makedirs(os.path.dirname(count_file), exist_ok=True)
    with open(count_file, 'w') as f:
        f.write(str(inserted))

    return results


def parse_date(s: str) -> datetime:
    """Parse date string in various formats."""
    formats = [
        '%Y-%m-%d',   # 2026-01-05
        '%m/%d/%Y',   # 01/05/2026
        '%m-%d-%Y',   # 01-05-2026
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Invalid date format: {s}. Use YYYY-MM-DD or MM/DD/YYYY")


def main():
    parser = argparse.ArgumentParser(
        description='Weekly COLA update with D1 sync',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Default: last 14 days
  python weekly_update.py

  # Custom lookback
  python weekly_update.py --days 7

  # Specific single date
  python weekly_update.py --date 2026-01-05
  python weekly_update.py --date 01/05/2026

  # Date range
  python weekly_update.py --dates 2026-01-01 2026-01-07

  # Dry run (no D1 push)
  python weekly_update.py --date 2026-01-05 --dry-run
        """
    )
    parser.add_argument('--days', type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f'Days to look back (default: {DEFAULT_LOOKBACK_DAYS})')
    parser.add_argument('--date', metavar='DATE',
                        help='Single date to scrape (e.g., 2026-01-05 or 01/05/2026)')
    parser.add_argument('--dates', nargs=2, metavar=('START', 'END'),
                        help='Date range to scrape (e.g., --dates 2026-01-01 2026-01-07)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Run without pushing to D1')
    parser.add_argument('--sync-only', action='store_true',
                        help='Skip scraping, only sync existing local data to D1')

    args = parser.parse_args()

    # Validate configuration before running
    validate_config()

    # Determine date range
    if args.date:
        # Single date
        start_date = parse_date(args.date)
        end_date = start_date
        logger.info(f"Scraping single date: {start_date.date()}")
        run_weekly_update(start_date=start_date, end_date=end_date, dry_run=args.dry_run, sync_only=args.sync_only)
    elif args.dates:
        # Date range
        start_date = parse_date(args.dates[0])
        end_date = parse_date(args.dates[1])
        logger.info(f"Scraping date range: {start_date.date()} to {end_date.date()}")
        run_weekly_update(start_date=start_date, end_date=end_date, dry_run=args.dry_run, sync_only=args.sync_only)
    else:
        # Default: use --days lookback
        run_weekly_update(days=args.days, dry_run=args.dry_run, sync_only=args.sync_only)


if __name__ == '__main__':
    main()


# ============================================================================
# WINDOWS TASK SCHEDULER SETUP
# ============================================================================
"""
To set up Windows Task Scheduler to run this script every Sunday at 2am:

1. Open Task Scheduler (search "Task Scheduler" in Start menu)

2. Click "Create Task" (not "Create Basic Task")

3. General tab:
   - Name: "Weekly COLA Update"
   - Check "Run whether user is logged on or not"
   - Check "Run with highest privileges"

4. Triggers tab:
   - Click "New"
   - Begin the task: "On a schedule"
   - Settings: Weekly
   - Start: [pick next Sunday] at 2:00:00 AM
   - Recur every: 1 week
   - Check "Sunday"
   - Check "Enabled"

5. Actions tab:
   - Click "New"
   - Action: "Start a program"
   - Program/script: C:\\Users\\MacRo\\Anaconda3\\python.exe
   - Add arguments: "C:\\Projects\\bevalc-intelligence\\scripts\\weekly_update.py"
   - Start in: C:\\Projects\\bevalc-intelligence\\scripts

6. Conditions tab:
   - Check "Wake the computer to run this task"
   - Uncheck "Start only if on AC power" (optional)

7. Settings tab:
   - Check "Allow task to be run on demand"
   - Check "Run task as soon as possible after a scheduled start is missed"
   - Check "If the task fails, restart every: 1 hour"
   - Attempt to restart up to: 3 times

8. Click OK and enter your Windows password when prompted

To test:
   - Right-click the task and select "Run"
   - Check the log file at: C:\\Projects\\bevalc-intelligence\\logs\\weekly_update.log
   
MANUAL TESTING:
   # Test D1 sync without scraping (uses existing local data)
   python weekly_update.py --sync-only --dry-run
   
   # Actually sync existing local data to D1
   python weekly_update.py --sync-only
   
   # Full run with scraping
   python weekly_update.py
"""
