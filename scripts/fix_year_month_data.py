"""
fix_year_month_data.py - Fix year/month values that don't match approval_date

Some records have year/month set to the scrape date instead of the approval_date.
This script corrects them by extracting from approval_date (format: MM/DD/YYYY).

Usage:
    python fix_year_month_data.py           # Execute fix
    python fix_year_month_data.py --dry-run # Preview only
"""

import os
import sys
import argparse
import logging
from pathlib import Path

# Setup path for imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

from lib.d1_utils import init_d1_config, d1_execute

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment
ENV_FILE = SCRIPT_DIR.parent / ".env"
if ENV_FILE.exists():
    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)


def count_mismatches() -> dict:
    """Count records with year/month mismatch."""
    logger.info("Counting records with year/month mismatch...")

    # Year mismatch
    result = d1_execute("""
        SELECT COUNT(*) as cnt FROM colas
        WHERE approval_date IS NOT NULL
        AND length(approval_date) >= 10
        AND CAST(substr(approval_date, 7, 4) AS INTEGER) != year
    """)
    year_mismatch = result.get('result', [{}])[0].get('results', [{}])[0].get('cnt', 0) if result.get('success') else 0

    # Month mismatch
    result = d1_execute("""
        SELECT COUNT(*) as cnt FROM colas
        WHERE approval_date IS NOT NULL
        AND length(approval_date) >= 10
        AND CAST(substr(approval_date, 1, 2) AS INTEGER) != month
    """)
    month_mismatch = result.get('result', [{}])[0].get('results', [{}])[0].get('cnt', 0) if result.get('success') else 0

    logger.info(f"  Year mismatch: {year_mismatch:,}")
    logger.info(f"  Month mismatch: {month_mismatch:,}")

    return {'year': year_mismatch, 'month': month_mismatch}


def fix_year_month(dry_run: bool = False) -> dict:
    """Fix year and month values by extracting from approval_date."""
    logger.info("\nFixing year/month values...")

    if dry_run:
        counts = count_mismatches()
        logger.info(f"[DRY RUN] Would fix {counts['year']:,} year and {counts['month']:,} month values")
        return counts

    # Fix year values
    logger.info("  Fixing year values...")
    result = d1_execute("""
        UPDATE colas
        SET year = CAST(substr(approval_date, 7, 4) AS INTEGER)
        WHERE approval_date IS NOT NULL
        AND length(approval_date) >= 10
        AND CAST(substr(approval_date, 7, 4) AS INTEGER) != year
    """)
    year_fixed = result.get('result', [{}])[0].get('meta', {}).get('changes', 0) if result.get('success') else 0
    logger.info(f"    Fixed {year_fixed:,} records")

    # Fix month values
    logger.info("  Fixing month values...")
    result = d1_execute("""
        UPDATE colas
        SET month = CAST(substr(approval_date, 1, 2) AS INTEGER)
        WHERE approval_date IS NOT NULL
        AND length(approval_date) >= 10
        AND CAST(substr(approval_date, 1, 2) AS INTEGER) != month
    """)
    month_fixed = result.get('result', [{}])[0].get('meta', {}).get('changes', 0) if result.get('success') else 0
    logger.info(f"    Fixed {month_fixed:,} records")

    return {'year': year_fixed, 'month': month_fixed}


def verify_fix() -> bool:
    """Verify that all year/month values now match approval_date."""
    logger.info("\nVerifying fix...")

    counts = count_mismatches()
    if counts['year'] > 0 or counts['month'] > 0:
        logger.warning(f"  Still have {counts['year']:,} year and {counts['month']:,} month mismatches")
        return False

    # Sample some records to verify
    result = d1_execute("""
        SELECT approval_date, year, month, day FROM colas
        WHERE approval_date IS NOT NULL
        LIMIT 5
    """)
    if result.get('success'):
        logger.info("  Sample records after fix:")
        for row in result.get('result', [{}])[0].get('results', []):
            ad = row.get('approval_date', '')
            logger.info(f"    {ad} -> year={row['year']}, month={row['month']}, day={row['day']}")

    logger.info("  All records verified!")
    return True


def main():
    parser = argparse.ArgumentParser(description='Fix year/month values in colas table')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    args = parser.parse_args()

    # Validate environment
    required_vars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        logger.error(f"Missing environment variables: {', '.join(missing)}")
        sys.exit(1)

    # Initialize D1 config
    init_d1_config(
        os.environ['CLOUDFLARE_ACCOUNT_ID'],
        os.environ['CLOUDFLARE_D1_DATABASE_ID'],
        os.environ['CLOUDFLARE_API_TOKEN']
    )

    logger.info("=" * 60)
    logger.info("FIX YEAR/MONTH DATA")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("[DRY RUN MODE]")

    # Count before
    logger.info("Before fix:")
    count_mismatches()

    # Fix
    fixed = fix_year_month(dry_run=args.dry_run)

    # Verify (skip in dry run)
    if not args.dry_run:
        verify_fix()

    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info(f"Fixed: {fixed['year']:,} year values, {fixed['month']:,} month values")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
