#!/usr/bin/env python3
"""
daily_sync.py - Daily TTB COLA scraper with D1 sync and classification

Uses cola_worker.py for scraping (exact same battle-tested logic) and
lib/d1_utils.py for D1 operations. Classifies records after upload.

USAGE:
    # Scrape today's data
    python daily_sync.py

    # Scrape specific date
    python daily_sync.py --date 2026-01-07

    # Scrape last N days (catch up)
    python daily_sync.py --days 3

    # Dry run (scrape but don't push to D1)
    python daily_sync.py --dry-run

    # Headless mode (for automation)
    python daily_sync.py --headless

SCHEDULING:
    See .github/workflows/daily-sync.yml for GitHub Actions scheduling.
"""

import os
import sys
import sqlite3
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

# Add scripts dir to path for imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

# Import from existing modules
from cola_worker import ColaWorker, parse_date

# Import shared D1 utilities
from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    escape_sql_value,
    d1_insert_batch,
    update_brand_slugs,
    add_new_companies,
    get_company_id,
)

# =============================================================================
# CONFIGURATION
# =============================================================================

BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
TEMP_DB = str(DATA_DIR / "daily_sync.db")
LOG_FILE = str(LOGS_DIR / "daily_sync.log")
ENV_FILE = str(BASE_DIR / ".env")

# D1 batch size for inserts
D1_BATCH_SIZE = 500

# =============================================================================
# ENVIRONMENT
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

# Cloudflare D1 Configuration (read from env, passed to lib.d1_utils)
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

# =============================================================================
# LOGGING
# =============================================================================

def setup_logging(verbose: bool = False) -> logging.Logger:
    """Setup logging to file and console."""
    os.makedirs(LOGS_DIR, exist_ok=True)

    level = logging.DEBUG if verbose else logging.INFO

    logging.basicConfig(
        level=level,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

logger = setup_logging()

# =============================================================================
# SYNC FUNCTION
# =============================================================================

def sync_to_d1(records: List[Dict], dry_run: bool = False) -> Dict:
    """Sync records to D1."""
    logger.info(f"Syncing {len(records):,} records to D1...")

    if dry_run:
        logger.info("[DRY RUN] Would insert records to D1")
        return {"success": True, "dry_run": True, "inserted": 0}

    if not records:
        logger.info("No records to sync")
        return {"success": True, "inserted": 0}

    total_inserted = 0
    all_errors = []

    for i in range(0, len(records), D1_BATCH_SIZE):
        batch = records[i:i + D1_BATCH_SIZE]
        batch_num = i // D1_BATCH_SIZE + 1
        total_batches = (len(records) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE

        logger.info(f"  Batch {batch_num}/{total_batches} ({len(batch)} records)...")

        result = d1_insert_batch(batch)
        total_inserted += result.get("inserted", 0)

        if result.get("error"):
            all_errors.append(result["error"])

    logger.info(f"Sync complete: {total_inserted:,} records inserted")

    # Update brand_slugs
    update_brand_slugs(records)

    # Add new companies to companies/company_aliases tables
    add_new_companies(records)

    return {
        "success": True,
        "inserted": total_inserted,
        "attempted": len(records),
        "errors": all_errors[:5] if all_errors else []
    }

# =============================================================================
# CLASSIFICATION
# =============================================================================

def classify_records(records: List[Dict], dry_run: bool = False) -> Dict:
    """
    Classify records using normalized company IDs.

    Priority:
    1. NEW_COMPANY = first time seeing this normalized company
    2. NEW_BRAND = company exists, but new brand
    3. NEW_SKU = company+brand exists, but new fanciful name
    4. REFILE = seen before

    Fix: Excludes ALL records from current batch when checking D1,
    and tracks what's seen within the batch to handle duplicates.
    """
    if not records or dry_run:
        return {'total': 0, 'new_companies': 0, 'new_brands': 0, 'new_skus': 0, 'refiles': 0}

    logger.info(f"Classifying {len(records):,} records...")

    stats = {
        'total': len(records),
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0
    }

    # Get all TTB IDs in this batch to exclude from D1 queries
    batch_ttb_ids = set(r.get('ttb_id') for r in records if r.get('ttb_id'))

    # Track what we've seen within this batch (for handling duplicates)
    seen_companies = set()  # company_ids seen in this batch
    seen_brands = set()     # (company_id, brand_name) tuples
    seen_skus = set()       # (company_id, brand_name, fanciful_name) tuples

    # Also track unknown companies by name (not in aliases table)
    seen_unknown_companies = set()
    seen_unknown_brands = set()
    seen_unknown_skus = set()

    # Build list of classifications to apply
    classifications = []

    for record in records:
        ttb_id = record.get('ttb_id')
        company_name = record.get('company_name', '') or ''
        brand_name = record.get('brand_name', '') or ''
        fanciful_name = record.get('fanciful_name', '') or ''

        if not company_name or not brand_name:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            continue

        company_id = get_company_id(company_name)

        if company_id is None:
            # Company not in aliases table - track by company_name
            if company_name not in seen_unknown_companies:
                classifications.append((ttb_id, 'NEW_COMPANY'))
                stats['new_companies'] += 1
                seen_unknown_companies.add(company_name)
                seen_unknown_brands.add((company_name, brand_name))
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            elif (company_name, brand_name) not in seen_unknown_brands:
                classifications.append((ttb_id, 'NEW_BRAND'))
                stats['new_brands'] += 1
                seen_unknown_brands.add((company_name, brand_name))
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            elif (company_name, brand_name, fanciful_name) not in seen_unknown_skus:
                classifications.append((ttb_id, 'NEW_SKU'))
                stats['new_skus'] += 1
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            else:
                classifications.append((ttb_id, 'REFILE'))
                stats['refiles'] += 1
            continue

        # Check if company existed BEFORE this batch (exclude all batch ttb_ids)
        company_existed_before = False
        if company_id not in seen_companies:
            company_result = d1_execute(
                """SELECT 1 FROM colas c
                   JOIN company_aliases ca ON c.company_name = ca.raw_name
                   WHERE ca.company_id = ? LIMIT 1""",
                [company_id]
            )
            if company_result.get("success") and company_result.get("result"):
                results = company_result["result"][0].get("results", [])
                # Check if any result is NOT in our batch
                for row in results:
                    company_existed_before = True
                    break
                # Actually we need to check if records exist outside our batch
                # Query count excluding our batch
                company_result2 = d1_execute(
                    f"""SELECT COUNT(*) as cnt FROM colas c
                       JOIN company_aliases ca ON c.company_name = ca.raw_name
                       WHERE ca.company_id = ?""",
                    [company_id]
                )
                if company_result2.get("success") and company_result2.get("result"):
                    total_cnt = company_result2["result"][0].get("results", [{}])[0].get("cnt", 0)
                    # Count how many are in our batch
                    batch_cnt = sum(1 for r in records if get_company_id(r.get('company_name', '')) == company_id)
                    company_existed_before = (total_cnt - batch_cnt) > 0

        if not company_existed_before and company_id not in seen_companies:
            classifications.append((ttb_id, 'NEW_COMPANY'))
            stats['new_companies'] += 1
            seen_companies.add(company_id)
            seen_brands.add((company_id, brand_name))
            seen_skus.add((company_id, brand_name, fanciful_name))
            continue

        seen_companies.add(company_id)

        # Check if brand existed BEFORE this batch
        brand_key = (company_id, brand_name)
        brand_existed_before = False
        if brand_key not in seen_brands:
            brand_result = d1_execute(
                f"""SELECT COUNT(*) as cnt FROM colas c
                   JOIN company_aliases ca ON c.company_name = ca.raw_name
                   WHERE ca.company_id = ? AND c.brand_name = ?""",
                [company_id, brand_name]
            )
            if brand_result.get("success") and brand_result.get("result"):
                total_cnt = brand_result["result"][0].get("results", [{}])[0].get("cnt", 0)
                # Count how many are in our batch with this company+brand
                batch_cnt = sum(1 for r in records
                               if get_company_id(r.get('company_name', '')) == company_id
                               and r.get('brand_name', '') == brand_name)
                brand_existed_before = (total_cnt - batch_cnt) > 0

        if not brand_existed_before and brand_key not in seen_brands:
            classifications.append((ttb_id, 'NEW_BRAND'))
            stats['new_brands'] += 1
            seen_brands.add(brand_key)
            seen_skus.add((company_id, brand_name, fanciful_name))
            continue

        seen_brands.add(brand_key)

        # Check if SKU existed BEFORE this batch
        sku_key = (company_id, brand_name, fanciful_name)
        sku_existed_before = False
        if sku_key not in seen_skus:
            sku_result = d1_execute(
                f"""SELECT COUNT(*) as cnt FROM colas c
                   JOIN company_aliases ca ON c.company_name = ca.raw_name
                   WHERE ca.company_id = ? AND c.brand_name = ? AND c.fanciful_name = ?""",
                [company_id, brand_name, fanciful_name]
            )
            if sku_result.get("success") and sku_result.get("result"):
                total_cnt = sku_result["result"][0].get("results", [{}])[0].get("cnt", 0)
                # Count how many are in our batch with this exact combo
                batch_cnt = sum(1 for r in records
                               if get_company_id(r.get('company_name', '')) == company_id
                               and r.get('brand_name', '') == brand_name
                               and (r.get('fanciful_name', '') or '') == fanciful_name)
                sku_existed_before = (total_cnt - batch_cnt) > 0

        if not sku_existed_before and sku_key not in seen_skus:
            classifications.append((ttb_id, 'NEW_SKU'))
            stats['new_skus'] += 1
            seen_skus.add(sku_key)
        else:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            seen_skus.add(sku_key)

    # Apply all classifications to D1
    logger.info(f"Applying {len(classifications)} classifications to D1...")
    for ttb_id, signal in classifications:
        d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", [signal, ttb_id])

    logger.info(f"Classification: {stats['new_companies']} new companies, "
                f"{stats['new_brands']} new brands, {stats['new_skus']} new SKUs, "
                f"{stats['refiles']} refiles")
    return stats

# =============================================================================
# MAIN
# =============================================================================

def validate_config():
    """Check required configuration and initialize D1."""
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not CLOUDFLARE_D1_DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if not CLOUDFLARE_API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")

    if missing:
        logger.error(f"Missing environment variables: {', '.join(missing)}")
        logger.error(f"Create .env file at: {ENV_FILE}")
        sys.exit(1)

    # Initialize D1 configuration for shared module
    init_d1_config(
        account_id=CLOUDFLARE_ACCOUNT_ID,
        database_id=CLOUDFLARE_D1_DATABASE_ID,
        api_token=CLOUDFLARE_API_TOKEN,
        batch_size=D1_BATCH_SIZE,
        logger=logger
    )


def run_daily_sync(
    target_date: datetime = None,
    days: int = 1,
    dry_run: bool = False,
    headless: bool = True,
    verbose: bool = False
) -> Dict:
    """
    Run the daily sync pipeline.

    1. Scrape using ColaWorker (exact same logic as cola_worker.py)
    2. Sync to D1
    3. Classify records

    Args:
        target_date: Specific date to scrape (default: today)
        days: Number of days to scrape if no target_date (default: 1)
        dry_run: Skip D1 sync and classification
        headless: Run browser headless
        verbose: Enable debug logging
    """
    if verbose:
        global logger
        logger = setup_logging(verbose=True)

    logger.info("=" * 60)
    logger.info("DAILY TTB SYNC")
    logger.info(f"Started: {datetime.now()}")
    logger.info("=" * 60)

    validate_config()

    # Determine dates to scrape
    if target_date:
        dates = [(target_date, target_date)]
    else:
        dates = []
        for i in range(days):
            d = datetime.now() - timedelta(days=i)
            dates.append((d, d))

    logger.info(f"Dates to scrape: {len(dates)}")
    for start, end in dates:
        logger.info(f"  - {start.strftime('%Y-%m-%d')}")

    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)

    # Remove old temp db if exists
    if os.path.exists(TEMP_DB):
        os.remove(TEMP_DB)

    all_records = []

    try:
        # Create worker using cola_worker.py's ColaWorker class
        worker = ColaWorker(
            name="daily_sync",
            db_path=TEMP_DB,
            headless=headless
        )

        # Scrape each date using the exact same logic as cola_worker.py
        for start_date, end_date in dates:
            logger.info(f"\n--- Scraping {start_date.strftime('%Y-%m-%d')} ---")
            result = worker.process_date_range(start_date, end_date)

            if result.get('error'):
                logger.warning(f"Error scraping {start_date.strftime('%Y-%m-%d')}: {result['error']}")

        # Close worker browser
        worker.close()

        # Read scraped records from worker's database
        if os.path.exists(TEMP_DB):
            conn = sqlite3.connect(TEMP_DB)
            conn.row_factory = sqlite3.Row
            all_records = [dict(row) for row in conn.execute("SELECT * FROM colas")]
            conn.close()

            # Fix year/month/day based on approval_date (not scrape date)
            # approval_date format is MM/DD/YYYY
            for record in all_records:
                approval_date = record.get('approval_date', '')
                if approval_date and '/' in approval_date:
                    parts = approval_date.split('/')
                    if len(parts) == 3:
                        try:
                            record['month'] = int(parts[0])
                            record['day'] = int(parts[1])
                            record['year'] = int(parts[2])
                        except ValueError:
                            pass

    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

    logger.info(f"\nTotal records scraped: {len(all_records):,}")

    if not all_records:
        logger.info("No new records found")
        return {'success': True, 'scraped': 0, 'synced': 0}

    # Sync to D1
    logger.info("\nSyncing to D1...")
    sync_result = sync_to_d1(all_records, dry_run=dry_run)

    # Classify records
    if not dry_run and sync_result.get('inserted', 0) > 0:
        logger.info("\nClassifying records...")
        classify_result = classify_records(all_records, dry_run=dry_run)
    else:
        classify_result = {'total': 0}

    # Clean up temp database
    if os.path.exists(TEMP_DB):
        os.remove(TEMP_DB)
        logger.info("Cleaned up temp database")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Dates scraped: {len(dates)}")
    logger.info(f"Records scraped: {len(all_records):,}")
    logger.info(f"Records synced to D1: {sync_result.get('inserted', 0):,}")
    if classify_result.get('total', 0) > 0:
        logger.info(f"New companies: {classify_result.get('new_companies', 0):,}")
        logger.info(f"New brands: {classify_result.get('new_brands', 0):,}")
        logger.info(f"New SKUs: {classify_result.get('new_skus', 0):,}")
        logger.info(f"Refiles: {classify_result.get('refiles', 0):,}")
    logger.info(f"Completed: {datetime.now()}")
    logger.info("=" * 60)

    return {
        'success': True,
        'dates': [d[0].strftime('%Y-%m-%d') for d in dates],
        'scraped': len(all_records),
        'synced': sync_result.get('inserted', 0),
        'classification': classify_result
    }


def main():
    parser = argparse.ArgumentParser(
        description='Daily TTB COLA scraper with D1 sync and classification',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape today's data
  python daily_sync.py

  # Scrape specific date
  python daily_sync.py --date 2026-01-07

  # Scrape last 3 days (catch up)
  python daily_sync.py --days 3

  # Dry run (no D1 push)
  python daily_sync.py --dry-run

  # Headless mode for automation
  python daily_sync.py --headless
        """
    )
    parser.add_argument('--date', metavar='DATE',
                        help='Specific date to scrape (e.g., 2026-01-07)')
    parser.add_argument('--days', type=int, default=1,
                        help='Number of days to scrape from today (default: 1)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Run without pushing to D1')
    parser.add_argument('--headless', action='store_true', default=True,
                        help='Run browser in headless mode (default: True)')
    parser.add_argument('--no-headless', action='store_true',
                        help='Show browser window (for debugging)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose/debug output')

    args = parser.parse_args()

    headless = not args.no_headless

    if args.date:
        target_date = parse_date(args.date)
        result = run_daily_sync(
            target_date=target_date,
            dry_run=args.dry_run,
            headless=headless,
            verbose=args.verbose
        )
    else:
        result = run_daily_sync(
            days=args.days,
            dry_run=args.dry_run,
            headless=headless,
            verbose=args.verbose
        )

    sys.exit(0 if result.get('success') else 1)


if __name__ == '__main__':
    main()
