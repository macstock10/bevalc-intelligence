"""
batch_classify.py - Batch classify historical records with signals

This script classifies all existing COLA records that have null signals.
It processes records chronologically to properly assign:
- NEW_COMPANY: First record from a company
- NEW_BRAND: First record of a brand from a known company
- NEW_SKU: First record of a SKU from a known brand
- REFILE: Subsequent records of existing SKUs

Additionally, it calculates refile_count for first instances:
- If a SKU was filed 5 times, the first gets refile_count=4 (4 future refilings)
- Helps display "(current)" vs "(X future refilings)" in UI

USAGE:
    # Analyze current state (no changes)
    python batch_classify.py --analyze

    # Dry run (show what would be done)
    python batch_classify.py --dry-run

    # Actually run classification
    python batch_classify.py

    # Run with smaller batches (for testing)
    python batch_classify.py --batch-size 1000
"""

import os
import sys
import json
import argparse
import logging
import requests
from datetime import datetime
from pathlib import Path
from typing import Dict, Set, List, Any, Tuple, Union
from collections import defaultdict

# Setup paths
SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = str(BASE_DIR / ".env")

# Load environment variables
def load_env():
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()

load_env()

# Cloudflare config
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


def d1_execute(sql: str, params: List[Any] = None, max_retries: int = 3) -> Dict:
    """Execute SQL against D1 with retry logic."""
    import time

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    payload = {"sql": sql}
    if params:
        payload["params"] = params

    for attempt in range(max_retries):
        try:
            response = requests.post(D1_API_URL, headers=headers, json=payload, timeout=60)

            if response.status_code != 200:
                logger.error(f"D1 API error: {response.status_code} - {response.text}")
                return {"success": False, "error": response.text}

            return response.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff: 1, 2, 4 seconds
                logger.warning(f"Connection error, retrying in {wait_time}s... ({attempt + 1}/{max_retries})")
                time.sleep(wait_time)
            else:
                logger.error(f"D1 API connection failed after {max_retries} attempts: {e}")
                raise


def escape_sql_value(value) -> str:
    """Escape a value for inline SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def analyze_current_state():
    """Analyze current signal distribution."""
    logger.info("Analyzing current signal distribution...")

    # Get total records
    result = d1_execute("SELECT COUNT(*) as total FROM colas")
    if result.get("success"):
        total = result["result"][0]["results"][0]["total"]
        logger.info(f"Total records: {total:,}")

    # Get signal distribution
    result = d1_execute("""
        SELECT
            COALESCE(signal, 'NULL') as signal_type,
            COUNT(*) as count
        FROM colas
        GROUP BY signal
        ORDER BY count DESC
    """)

    if result.get("success"):
        logger.info("\nCurrent signal distribution:")
        for row in result["result"][0]["results"]:
            signal = row["signal_type"]
            count = row["count"]
            logger.info(f"  {signal}: {count:,}")

    # Get records needing classification
    result = d1_execute("SELECT COUNT(*) as count FROM colas WHERE signal IS NULL")
    if result.get("success"):
        null_count = result["result"][0]["results"][0]["count"]
        logger.info(f"\nRecords needing classification: {null_count:,}")


def load_company_aliases_map() -> Dict[str, int]:
    """Load company_aliases into memory as uppercase map."""
    logger.info("Loading company_aliases mapping...")

    alias_map = {}  # UPPER(raw_name) -> company_id
    offset = 0
    batch_size = 10000

    while True:
        result = d1_execute(f"SELECT raw_name, company_id FROM company_aliases LIMIT {batch_size} OFFSET {offset}")
        if not result.get("success") or not result.get("result"):
            break

        rows = result["result"][0].get("results", [])
        if not rows:
            break

        for row in rows:
            raw = row.get("raw_name", "")
            cid = row.get("company_id")
            if raw and cid:
                alias_map[raw.upper()] = cid

        offset += batch_size
        if len(rows) < batch_size:
            break

    logger.info(f"  Loaded {len(alias_map):,} company aliases")
    return alias_map


def get_year_month_list() -> List[Tuple[int, int]]:
    """Get all (year, month) combinations from colas, sorted chronologically."""
    result = d1_execute("""
        SELECT DISTINCT year, month
        FROM colas
        WHERE year IS NOT NULL AND month IS NOT NULL
        ORDER BY year ASC, month ASC
    """)

    if not result.get("success") or not result.get("result"):
        logger.error("Failed to get year/month list")
        return []

    rows = result["result"][0].get("results", [])
    return [(row["year"], row["month"]) for row in rows]


def fetch_all_records_chunked(alias_map: Dict[str, int], batch_size: int = 50000) -> List[Dict]:
    """
    Fetch ALL records from D1, sorted chronologically.
    Returns list of dicts with ttb_id, company_name, brand_name, fanciful_name, approval_date, company_id.
    Uses in-memory alias_map for case-insensitive company_id lookup.

    IMPORTANT: Uses year/month chunking instead of OFFSET to avoid D1 memory limits.
    """
    all_records = []

    logger.info("Fetching all records from D1 by year/month (avoids memory limits)...")

    # Get all year/month combinations
    year_months = get_year_month_list()
    logger.info(f"  Found {len(year_months)} year/month combinations")

    if not year_months:
        logger.error("No year/month combinations found!")
        return []

    # Fetch records month by month
    for ym_idx, (year, month) in enumerate(year_months):
        offset = 0
        month_records = []

        while True:
            # Fetch records for this specific month
            result = d1_execute(f"""
                SELECT ttb_id, company_name, brand_name, fanciful_name, approval_date, year, month, day
                FROM colas
                WHERE year = {year} AND month = {month}
                ORDER BY
                    COALESCE(CAST(SUBSTR(approval_date, 4, 2) AS INTEGER), day, 1) ASC,
                    ttb_id ASC
                LIMIT {batch_size} OFFSET {offset}
            """)

            if not result.get("success") or not result.get("result"):
                logger.error(f"D1 error at year={year}, month={month}, offset={offset}")
                break

            rows = result["result"][0].get("results", [])
            if not rows:
                break

            # Add company_id from alias_map (case-insensitive)
            for row in rows:
                company_name = (row.get("company_name") or "").upper()
                row["company_id"] = alias_map.get(company_name, -1)

            month_records.extend(rows)

            if len(rows) < batch_size:
                break
            offset += batch_size

        all_records.extend(month_records)

        # Log progress every 12 months or at end
        if (ym_idx + 1) % 12 == 0 or ym_idx == len(year_months) - 1:
            logger.info(f"  Fetched {len(all_records):,} records through {year}-{month:02d}...")

    return all_records


def execute_batch_updates(updates: List[str], dry_run: bool = False) -> int:
    """Execute batch UPDATE statements."""
    if not updates or dry_run:
        return len(updates)

    total_updated = 0
    sub_batch_size = 50

    for i in range(0, len(updates), sub_batch_size):
        sub_batch = updates[i:i + sub_batch_size]
        sql = '\n'.join(sub_batch)

        result = d1_execute(sql)

        if result.get("success"):
            for res in result.get("result", []):
                total_updated += res.get("meta", {}).get("changes", 0)

    return total_updated


def run_batch_classification(batch_size: int = 10000, dry_run: bool = False):
    """
    Classify all records and calculate refile_count.

    Two-pass approach:
    1. First pass: Classify all records chronologically
    2. Second pass: Calculate refile_count for first instances
    """
    logger.info("Starting batch classification...")
    logger.info(f"Dry run: {dry_run}")

    # Load company aliases for case-insensitive matching
    alias_map = load_company_aliases_map()

    # Fetch all records sorted by approval_date
    all_records = fetch_all_records_chunked(alias_map)
    logger.info(f"Total records to process: {len(all_records):,}")

    # ==================== PASS 1: Classification ====================
    logger.info("\n[PASS 1] Classifying records...")

    # Track what we've seen (in chronological order)
    # Use normalized company_id instead of raw company_name to handle variants
    # For companies without aliases (company_id = -1), fall back to raw company_name
    seen_companies: Set[int] = set()  # company_id (for aliased companies)
    seen_companies_raw: Set[str] = set()  # raw company_name (for orphaned companies)
    seen_brands: Set[Tuple[Any, str]] = set()  # (company_key, brand) - key can be int or str
    seen_skus: Set[Tuple[Any, str, str]] = set()  # (company_key, brand, fanciful)

    # Track first instances for each SKU (to update refile_count later)
    # Key: (company_key, brand, fanciful) -> ttb_id of first instance
    sku_first_instance: Dict[Tuple[Any, str, str], str] = {}

    # Track classifications
    classifications: Dict[str, str] = {}  # ttb_id -> signal

    stats = {
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0,
        'orphaned_companies': 0,  # Track companies not in aliases
        'legacy': 0  # Track records with missing company/brand data
    }

    for i, record in enumerate(all_records):
        ttb_id = record.get("ttb_id")
        company_id = record.get("company_id", -1)  # Normalized company ID from company_aliases
        company_name_raw = (record.get("company_name") or "").strip()
        brand = (record.get("brand_name") or "").strip()
        fanciful = (record.get("fanciful_name") or "").strip()

        # Handle records with missing company or brand - mark as LEGACY
        # These are older TTB records that lack proper company/brand data
        if not company_name_raw or not brand:
            classifications[ttb_id] = 'LEGACY'
            stats['legacy'] += 1
            continue

        # Determine company key: use company_id if available, otherwise raw name
        # This ensures orphaned companies are still tracked and classified correctly
        if company_id != -1:
            company_key = company_id
            is_orphaned = False
        else:
            # Fallback to raw company_name (uppercase for consistency)
            company_key = company_name_raw.upper()
            is_orphaned = True
            stats['orphaned_companies'] += 1

        brand_key = (company_key, brand.lower())
        sku_key = (company_key, brand.lower(), fanciful.lower())

        # Check if company is new (use appropriate set based on key type)
        if is_orphaned:
            company_is_new = company_key not in seen_companies_raw
        else:
            company_is_new = company_key not in seen_companies

        if company_is_new:
            # New company
            classifications[ttb_id] = 'NEW_COMPANY'
            stats['new_companies'] += 1
            # Add to appropriate seen set
            if is_orphaned:
                seen_companies_raw.add(company_key)
            else:
                seen_companies.add(company_key)
            seen_brands.add(brand_key)
            seen_skus.add(sku_key)
            sku_first_instance[sku_key] = ttb_id
        elif brand_key not in seen_brands:
            # New brand
            classifications[ttb_id] = 'NEW_BRAND'
            stats['new_brands'] += 1
            seen_brands.add(brand_key)
            seen_skus.add(sku_key)
            sku_first_instance[sku_key] = ttb_id
        elif sku_key not in seen_skus:
            # New SKU
            classifications[ttb_id] = 'NEW_SKU'
            stats['new_skus'] += 1
            seen_skus.add(sku_key)
            sku_first_instance[sku_key] = ttb_id
        else:
            # Refile
            classifications[ttb_id] = 'REFILE'
            stats['refiles'] += 1

        if (i + 1) % 100000 == 0:
            logger.info(f"  Classified {i+1:,}/{len(all_records):,}...")

    logger.info(f"Pass 1 complete:")
    logger.info(f"  NEW_COMPANY: {stats['new_companies']:,}")
    logger.info(f"  NEW_BRAND: {stats['new_brands']:,}")
    logger.info(f"  NEW_SKU: {stats['new_skus']:,}")
    logger.info(f"  REFILE: {stats['refiles']:,}")
    logger.info(f"  LEGACY: {stats['legacy']:,}")
    if stats['orphaned_companies'] > 0:
        logger.warning(f"  Note: {stats['orphaned_companies']:,} records had no company_alias (classified by raw name)")

    # ==================== PASS 2: Calculate refile_count ====================
    logger.info("\n[PASS 2] Calculating refile counts...")

    # Count refilings per SKU (using same company_key logic as Pass 1)
    sku_counts: Dict[Tuple[Any, str, str], int] = defaultdict(int)

    for record in all_records:
        company_id = record.get("company_id", -1)
        company_name_raw = (record.get("company_name") or "").strip()
        brand = (record.get("brand_name") or "").strip().lower()
        fanciful = (record.get("fanciful_name") or "").strip().lower()

        if not brand:
            continue

        # Use same company_key logic as Pass 1
        if company_id != -1:
            company_key = company_id
        else:
            company_key = company_name_raw.upper()

        sku_key = (company_key, brand, fanciful)
        sku_counts[sku_key] += 1

    # Calculate refile_count for first instances
    # refile_count = total_filings - 1 (the first one doesn't count as a refiling)
    refile_counts: Dict[str, int] = {}  # ttb_id -> refile_count

    for sku_key, first_ttb_id in sku_first_instance.items():
        total_filings = sku_counts.get(sku_key, 1)
        refile_counts[first_ttb_id] = total_filings - 1

    skus_with_refilings = sum(1 for c in refile_counts.values() if c > 0)
    logger.info(f"  SKUs with future refilings: {skus_with_refilings:,}")

    # ==================== Apply Updates ====================
    logger.info("\n[PASS 3] Applying updates to D1...")

    # Group ttb_ids by (signal, refile_count) for bulk updates
    # This is MUCH faster than individual UPDATE statements
    groups: Dict[Tuple[str, int], List[str]] = defaultdict(list)

    for ttb_id, signal in classifications.items():
        refile_count = refile_counts.get(ttb_id, 0)
        groups[(signal, refile_count)].append(ttb_id)

    logger.info(f"Total records to update: {len(classifications):,}")
    logger.info(f"Grouped into {len(groups):,} unique (signal, refile_count) combinations")

    if dry_run:
        logger.info("[DRY RUN] No changes made")
        return stats

    # Execute bulk updates - each UPDATE handles many ttb_ids at once
    total_updated = 0
    chunk_size = 500  # IDs per UPDATE statement (avoid SQL size limits)
    total_statements = sum((len(ids) + chunk_size - 1) // chunk_size for ids in groups.values())
    statements_done = 0

    for (signal, refile_count), ttb_ids in groups.items():
        signal_escaped = escape_sql_value(signal)

        # Split into chunks to avoid SQL size limits
        for chunk_start in range(0, len(ttb_ids), chunk_size):
            chunk = ttb_ids[chunk_start:chunk_start + chunk_size]
            ids_list = ','.join(escape_sql_value(tid) for tid in chunk)

            sql = f"UPDATE colas SET signal = {signal_escaped}, refile_count = {refile_count} WHERE ttb_id IN ({ids_list});"

            result = d1_execute(sql)
            if result.get("success"):
                for res in result.get("result", []):
                    total_updated += res.get("meta", {}).get("changes", 0)

            statements_done += 1
            if statements_done % 100 == 0 or statements_done == total_statements:
                pct = (statements_done / total_statements) * 100
                logger.info(f"  Progress: {statements_done:,}/{total_statements:,} statements ({pct:.1f}%) - {total_updated:,} rows updated")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("CLASSIFICATION COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total records processed: {len(all_records):,}")
    logger.info(f"  NEW_COMPANY: {stats['new_companies']:,}")
    logger.info(f"  NEW_BRAND: {stats['new_brands']:,}")
    logger.info(f"  NEW_SKU: {stats['new_skus']:,}")
    logger.info(f"  REFILE: {stats['refiles']:,}")
    logger.info(f"  LEGACY: {stats['legacy']:,}")
    logger.info(f"SKUs with future refilings: {skus_with_refilings:,}")

    return stats


def main():
    parser = argparse.ArgumentParser(description='Batch classify historical COLA records')
    parser.add_argument('--analyze', action='store_true',
                        help='Only analyze current state, no changes')
    parser.add_argument('--dry-run', action='store_true',
                        help='Run without making changes')
    parser.add_argument('--batch-size', type=int, default=10000,
                        help='Records per batch (default: 10000)')

    args = parser.parse_args()

    if not CLOUDFLARE_API_TOKEN:
        logger.error("CLOUDFLARE_API_TOKEN not set")
        sys.exit(1)

    if args.analyze:
        analyze_current_state()
    else:
        run_batch_classification(
            batch_size=args.batch_size,
            dry_run=args.dry_run
        )


if __name__ == '__main__':
    main()
