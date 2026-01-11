"""
backfill_day_column.py - Add and populate 'day' column in colas table

This script:
1. Adds 'day' column to colas table if it doesn't exist
2. Populates day from approval_date (format: MM/DD/YYYY)

Run once to fix the schema for existing records.

Usage:
    python backfill_day_column.py           # Execute
    python backfill_day_column.py --dry-run # Preview only
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


def add_day_column(dry_run: bool = False) -> bool:
    """Add 'day' column to colas table if it doesn't exist."""
    logger.info("Step 1: Checking if 'day' column exists...")

    # Check current schema
    result = d1_execute("PRAGMA table_info(colas)")
    if not result.get("success"):
        logger.error(f"Failed to get table info: {result.get('error')}")
        return False

    columns = [row['name'] for row in result.get("result", [{}])[0].get("results", [])]

    if 'day' in columns:
        logger.info("  'day' column already exists")
        return True

    logger.info("  'day' column does not exist, adding it...")

    if dry_run:
        logger.info("  [DRY RUN] Would execute: ALTER TABLE colas ADD COLUMN day INTEGER")
        return True

    # Add the column
    result = d1_execute("ALTER TABLE colas ADD COLUMN day INTEGER")
    if not result.get("success"):
        logger.error(f"Failed to add column: {result.get('error')}")
        return False

    logger.info("  Successfully added 'day' column")
    return True


def backfill_day_values(dry_run: bool = False, batch_size: int = 50000) -> int:
    """
    Populate 'day' column from approval_date for all records.

    approval_date format: MM/DD/YYYY
    We extract DD using: substr(approval_date, 4, 2)
    """
    logger.info("\nStep 2: Backfilling 'day' values from approval_date...")

    # Count records needing update
    result = d1_execute("SELECT COUNT(*) as cnt FROM colas WHERE day IS NULL AND approval_date IS NOT NULL")
    if not result.get("success"):
        logger.error(f"Failed to count records: {result.get('error')}")
        return 0

    count = result.get("result", [{}])[0].get("results", [{}])[0].get("cnt", 0)
    logger.info(f"  Records needing update: {count:,}")

    if count == 0:
        logger.info("  No records need updating")
        return 0

    if dry_run:
        logger.info(f"  [DRY RUN] Would update {count:,} records")
        return count

    # Update in batches to avoid timeout
    # SQLite substr is 1-indexed, so substr(approval_date, 4, 2) extracts chars 4-5 (the DD part)
    update_sql = """
        UPDATE colas
        SET day = CAST(substr(approval_date, 4, 2) AS INTEGER)
        WHERE day IS NULL
        AND approval_date IS NOT NULL
        AND length(approval_date) >= 10
    """

    logger.info("  Executing batch update...")
    result = d1_execute(update_sql)

    if not result.get("success"):
        logger.error(f"Failed to update records: {result.get('error')}")
        return 0

    changes = result.get("result", [{}])[0].get("meta", {}).get("changes", 0)
    logger.info(f"  Updated {changes:,} records")

    return changes


def verify_backfill() -> bool:
    """Verify the backfill was successful."""
    logger.info("\nStep 3: Verifying backfill...")

    # Check for any remaining NULL days where approval_date exists
    result = d1_execute("""
        SELECT COUNT(*) as cnt FROM colas
        WHERE day IS NULL AND approval_date IS NOT NULL AND length(approval_date) >= 10
    """)

    if not result.get("success"):
        logger.error(f"Failed to verify: {result.get('error')}")
        return False

    remaining = result.get("result", [{}])[0].get("results", [{}])[0].get("cnt", 0)

    if remaining > 0:
        logger.warning(f"  {remaining:,} records still have NULL day")
        return False

    # Sample some records to verify
    result = d1_execute("""
        SELECT approval_date, year, month, day
        FROM colas
        WHERE day IS NOT NULL
        LIMIT 5
    """)

    if result.get("success"):
        logger.info("  Sample records:")
        for row in result.get("result", [{}])[0].get("results", []):
            logger.info(f"    {row['approval_date']} -> year={row['year']}, month={row['month']}, day={row['day']}")

    logger.info("  Backfill verified successfully!")
    return True


def main():
    parser = argparse.ArgumentParser(description='Backfill day column in colas table')
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
    logger.info("BACKFILL DAY COLUMN")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("[DRY RUN MODE]")

    # Step 1: Add column
    if not add_day_column(dry_run=args.dry_run):
        logger.error("Failed to add day column")
        sys.exit(1)

    # Step 2: Backfill values
    updated = backfill_day_values(dry_run=args.dry_run)

    # Step 3: Verify (skip in dry run)
    if not args.dry_run:
        verify_backfill()

    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
