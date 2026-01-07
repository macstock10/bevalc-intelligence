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
from typing import Dict, Set, List, Any, Tuple
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


def d1_execute(sql: str, params: List[Any] = None) -> Dict:
    """Execute SQL against D1."""
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    payload = {"sql": sql}
    if params:
        payload["params"] = params

    response = requests.post(D1_API_URL, headers=headers, json=payload)

    if response.status_code != 200:
        logger.error(f"D1 API error: {response.status_code} - {response.text}")
        return {"success": False, "error": response.text}

    return response.json()


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


def fetch_all_records_chunked(batch_size: int = 50000) -> List[Dict]:
    """
    Fetch ALL records from D1, sorted chronologically.
    Returns list of dicts with ttb_id, company_name, brand_name, fanciful_name, approval_date.
    """
    all_records = []
    offset = 0

    logger.info("Fetching all records from D1 (this may take a while)...")

    while True:
        # Order by year, month, then day (extracted from MM/DD/YYYY string)
        # This ensures proper chronological order even though approval_date is a string
        result = d1_execute(f"""
            SELECT ttb_id, company_name, brand_name, fanciful_name, approval_date
            FROM colas
            ORDER BY
                COALESCE(year, 9999) ASC,
                COALESCE(month, 99) ASC,
                CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ASC,
                ttb_id ASC
            LIMIT {batch_size} OFFSET {offset}
        """)

        if not result.get("success") or not result.get("result"):
            break

        rows = result["result"][0].get("results", [])
        if not rows:
            break

        all_records.extend(rows)
        logger.info(f"  Fetched {len(all_records):,} records...")

        if len(rows) < batch_size:
            break
        offset += batch_size

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

    # Fetch all records sorted by approval_date
    all_records = fetch_all_records_chunked()
    logger.info(f"Total records to process: {len(all_records):,}")

    # ==================== PASS 1: Classification ====================
    logger.info("\n[PASS 1] Classifying records...")

    # Track what we've seen (in chronological order)
    seen_companies: Set[str] = set()
    seen_brands: Set[Tuple[str, str]] = set()  # (company, brand)
    seen_skus: Set[Tuple[str, str, str]] = set()  # (company, brand, fanciful)

    # Track first instances for each SKU (to update refile_count later)
    # Key: (company, brand, fanciful) -> ttb_id of first instance
    sku_first_instance: Dict[Tuple[str, str, str], str] = {}

    # Track classifications
    classifications: Dict[str, str] = {}  # ttb_id -> signal

    stats = {
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0
    }

    for i, record in enumerate(all_records):
        ttb_id = record.get("ttb_id")
        company = (record.get("company_name") or "").strip()
        brand = (record.get("brand_name") or "").strip()
        fanciful = (record.get("fanciful_name") or "").strip()

        company_key = company.lower()
        brand_key = (company.lower(), brand.lower())
        sku_key = (company.lower(), brand.lower(), fanciful.lower())

        if not company or not brand:
            classifications[ttb_id] = 'REFILE'
            stats['refiles'] += 1
            continue

        if company_key not in seen_companies:
            # New company
            classifications[ttb_id] = 'NEW_COMPANY'
            stats['new_companies'] += 1
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

    # ==================== PASS 2: Calculate refile_count ====================
    logger.info("\n[PASS 2] Calculating refile counts...")

    # Count refilings per SKU
    sku_counts: Dict[Tuple[str, str, str], int] = defaultdict(int)

    for record in all_records:
        company = (record.get("company_name") or "").strip().lower()
        brand = (record.get("brand_name") or "").strip().lower()
        fanciful = (record.get("fanciful_name") or "").strip().lower()

        if company and brand:
            sku_key = (company, brand, fanciful)
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

    # Build UPDATE statements
    updates = []

    for ttb_id, signal in classifications.items():
        ttb_escaped = escape_sql_value(ttb_id)
        signal_escaped = escape_sql_value(signal)
        refile_count = refile_counts.get(ttb_id, 0)

        updates.append(
            f"UPDATE colas SET signal = {signal_escaped}, refile_count = {refile_count} WHERE ttb_id = {ttb_escaped};"
        )

    logger.info(f"Total updates: {len(updates):,}")

    if dry_run:
        logger.info("[DRY RUN] No changes made")
        return stats

    # Execute in batches
    total_updated = 0
    batch_size = 500

    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        updated = execute_batch_updates(batch, dry_run=False)
        total_updated += updated

        if (i + batch_size) % 10000 == 0 or i + batch_size >= len(updates):
            logger.info(f"  Updated {min(i + batch_size, len(updates)):,}/{len(updates):,} records...")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("CLASSIFICATION COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total records processed: {len(all_records):,}")
    logger.info(f"  NEW_COMPANY: {stats['new_companies']:,}")
    logger.info(f"  NEW_BRAND: {stats['new_brands']:,}")
    logger.info(f"  NEW_SKU: {stats['new_skus']:,}")
    logger.info(f"  REFILE: {stats['refiles']:,}")
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
