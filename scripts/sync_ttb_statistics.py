#!/usr/bin/env python3
"""
sync_ttb_statistics.py - Sync TTB distilled spirits statistics to D1

Downloads monthly and yearly statistics from TTB's public data files and
syncs them to Cloudflare D1 for analysis and content generation.

Data source: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics

Usage:
    python sync_ttb_statistics.py           # Full sync (monthly + yearly)
    python sync_ttb_statistics.py --monthly # Monthly data only
    python sync_ttb_statistics.py --yearly  # Yearly data only
    python sync_ttb_statistics.py --dry-run # Preview without writing
"""

import os
import sys
import csv
import logging
import argparse
from datetime import datetime
from io import StringIO
from typing import List, Dict, Optional

import requests

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.lib.d1_utils import init_d1_config, d1_execute, escape_sql_value

# =============================================================================
# CONFIGURATION
# =============================================================================

TTB_BASE_URL = "https://www.ttb.gov/system/files/2024-08"
MONTHLY_CSV_URL = f"{TTB_BASE_URL}/Distilled_Spirits_monthly_data_csv.csv"
YEARLY_CSV_URL = f"{TTB_BASE_URL}/Distilled_Spirits_yearly_data_csv.csv"

BATCH_SIZE = 500

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# DATA DOWNLOAD
# =============================================================================

def download_csv(url: str) -> Optional[str]:
    """
    Download CSV file from TTB website.

    Args:
        url: Full URL to CSV file

    Returns:
        CSV content as string, or None on error
    """
    logger.info(f"Downloading: {url}")

    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()

        # Check content type
        content_type = response.headers.get('Content-Type', '')
        if 'csv' not in content_type.lower() and 'text' not in content_type.lower():
            logger.warning(f"Unexpected content type: {content_type}")

        logger.info(f"Downloaded {len(response.content):,} bytes")
        return response.text

    except requests.RequestException as e:
        logger.error(f"Failed to download {url}: {e}")
        return None


def parse_monthly_csv(csv_content: str) -> List[Dict]:
    """
    Parse monthly statistics CSV into records.

    CSV columns:
    - CY_Month_Number: Month (1-12)
    - Year: Year (2012+)
    - Statistical_Group: Category grouping
    - Statistical_Category: Category total
    - Statistical_Detail: Detail row
    - Count_IMs: Count of industry members reporting
    - Value: The metric value
    - commodity: "Distilled Spirits"
    - Stat_Redaction: TRUE/FALSE
    """
    records = []
    reader = csv.DictReader(StringIO(csv_content))

    for row in reader:
        try:
            month = int(row.get('CY_Month_Number', 0))
            year = int(row.get('Year', 0))

            if year < 2012 or month < 1 or month > 12:
                continue

            count_ims = row.get('Count_IMs', '')
            value = row.get('Value', '')

            record = {
                'year': year,
                'month': month,
                'statistical_group': row.get('Statistical_Group', '').strip(),
                'statistical_category': row.get('Statistical_Category', '').strip(),
                'statistical_detail': row.get('Statistical_Detail', '').strip(),
                'count_ims': int(count_ims) if count_ims.isdigit() else None,
                'value': int(value) if value.isdigit() else None,
                'is_redacted': 1 if row.get('Stat_Redaction', '').upper() == 'TRUE' else 0
            }

            records.append(record)

        except (ValueError, TypeError) as e:
            logger.warning(f"Skipping malformed row: {e}")
            continue

    logger.info(f"Parsed {len(records):,} monthly records")
    return records


def parse_yearly_csv(csv_content: str) -> List[Dict]:
    """
    Parse yearly statistics CSV into records.

    Same structure as monthly but without CY_Month_Number.
    We set month=NULL to indicate yearly aggregate.
    """
    records = []
    reader = csv.DictReader(StringIO(csv_content))

    for row in reader:
        try:
            year = int(row.get('Year', 0))

            if year < 2012:
                continue

            count_ims = row.get('Count_IMs', '')
            value = row.get('Value', '')

            record = {
                'year': year,
                'month': None,  # NULL indicates yearly aggregate
                'statistical_group': row.get('Statistical_Group', '').strip(),
                'statistical_category': row.get('Statistical_Category', '').strip(),
                'statistical_detail': row.get('Statistical_Detail', '').strip(),
                'count_ims': int(count_ims) if count_ims.isdigit() else None,
                'value': int(value) if value.isdigit() else None,
                'is_redacted': 1 if row.get('Stat_Redaction', '').upper() == 'TRUE' else 0
            }

            records.append(record)

        except (ValueError, TypeError) as e:
            logger.warning(f"Skipping malformed row: {e}")
            continue

    logger.info(f"Parsed {len(records):,} yearly records")
    return records


# =============================================================================
# DATABASE OPERATIONS
# =============================================================================

def create_tables_if_needed():
    """Create TTB statistics tables if they don't exist."""

    # Main statistics table
    sql = """
    CREATE TABLE IF NOT EXISTS ttb_spirits_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        month INTEGER,
        statistical_group TEXT NOT NULL,
        statistical_category TEXT NOT NULL,
        statistical_detail TEXT NOT NULL,
        count_ims INTEGER,
        value INTEGER,
        is_redacted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(year, month, statistical_group, statistical_category, statistical_detail)
    );
    """
    result = d1_execute(sql)
    if not result.get("success"):
        logger.error(f"Failed to create ttb_spirits_stats table: {result.get('error')}")
        return False

    # Create indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_spirits_stats_year ON ttb_spirits_stats(year);",
        "CREATE INDEX IF NOT EXISTS idx_spirits_stats_year_month ON ttb_spirits_stats(year, month);",
        "CREATE INDEX IF NOT EXISTS idx_spirits_stats_group ON ttb_spirits_stats(statistical_group);",
        "CREATE INDEX IF NOT EXISTS idx_spirits_stats_detail ON ttb_spirits_stats(statistical_detail);"
    ]

    for index_sql in indexes:
        d1_execute(index_sql)

    # Sync log table
    sql = """
    CREATE TABLE IF NOT EXISTS ttb_stats_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_type TEXT NOT NULL,
        source_url TEXT,
        records_synced INTEGER,
        last_data_year INTEGER,
        last_data_month INTEGER,
        synced_at TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'success',
        error_message TEXT
    );
    """
    result = d1_execute(sql)
    if not result.get("success"):
        logger.error(f"Failed to create sync_log table: {result.get('error')}")
        return False

    logger.info("Database tables ready")
    return True


def insert_statistics_batch(records: List[Dict], dry_run: bool = False) -> int:
    """
    Insert statistics records into D1.

    Uses INSERT OR REPLACE to update existing records with same key.

    Args:
        records: List of parsed statistics records
        dry_run: If True, skip actual insert

    Returns:
        Number of records inserted/updated
    """
    if not records:
        return 0

    if dry_run:
        logger.info(f"[DRY RUN] Would insert {len(records):,} records")
        return 0

    total_inserted = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]

        values = []
        for record in batch:
            year = escape_sql_value(record['year'])
            month = escape_sql_value(record['month'])
            statistical_group = escape_sql_value(record['statistical_group'])
            statistical_category = escape_sql_value(record['statistical_category'])
            statistical_detail = escape_sql_value(record['statistical_detail'])
            count_ims = escape_sql_value(record['count_ims'])
            value = escape_sql_value(record['value'])
            is_redacted = escape_sql_value(record['is_redacted'])

            values.append(
                f"({year}, {month}, {statistical_group}, {statistical_category}, "
                f"{statistical_detail}, {count_ims}, {value}, {is_redacted})"
            )

        sql = f"""
        INSERT OR REPLACE INTO ttb_spirits_stats
        (year, month, statistical_group, statistical_category, statistical_detail,
         count_ims, value, is_redacted)
        VALUES {','.join(values)}
        """

        result = d1_execute(sql)

        if result.get("success"):
            for res in result.get("result", []):
                total_inserted += res.get("meta", {}).get("changes", 0)
        else:
            logger.error(f"Batch insert failed: {result.get('error')}")

    logger.info(f"Inserted/updated {total_inserted:,} records")
    return total_inserted


def log_sync(data_type: str, source_url: str, records_synced: int,
             last_year: int, last_month: int = None,
             status: str = 'success', error: str = None):
    """Log sync operation to database."""

    sql = f"""
    INSERT INTO ttb_stats_sync_log
    (data_type, source_url, records_synced, last_data_year, last_data_month, status, error_message)
    VALUES (
        {escape_sql_value(data_type)},
        {escape_sql_value(source_url)},
        {records_synced},
        {last_year},
        {escape_sql_value(last_month)},
        {escape_sql_value(status)},
        {escape_sql_value(error)}
    )
    """
    d1_execute(sql)


# =============================================================================
# MAIN SYNC FUNCTIONS
# =============================================================================

def sync_monthly(dry_run: bool = False) -> Dict:
    """
    Sync monthly statistics data.

    Returns:
        Dict with sync results
    """
    logger.info("=== Syncing Monthly Statistics ===")

    csv_content = download_csv(MONTHLY_CSV_URL)
    if not csv_content:
        return {"success": False, "error": "Failed to download monthly CSV"}

    records = parse_monthly_csv(csv_content)
    if not records:
        return {"success": False, "error": "No records parsed from monthly CSV"}

    # Find latest data point
    latest_year = max(r['year'] for r in records)
    latest_month = max(r['month'] for r in records if r['year'] == latest_year)

    logger.info(f"Latest data: {latest_year}-{latest_month:02d}")

    inserted = insert_statistics_batch(records, dry_run)

    if not dry_run:
        log_sync('monthly', MONTHLY_CSV_URL, inserted, latest_year, latest_month)

    return {
        "success": True,
        "records_parsed": len(records),
        "records_synced": inserted,
        "latest_year": latest_year,
        "latest_month": latest_month
    }


def sync_yearly(dry_run: bool = False) -> Dict:
    """
    Sync yearly statistics data.

    Returns:
        Dict with sync results
    """
    logger.info("=== Syncing Yearly Statistics ===")

    csv_content = download_csv(YEARLY_CSV_URL)
    if not csv_content:
        return {"success": False, "error": "Failed to download yearly CSV"}

    records = parse_yearly_csv(csv_content)
    if not records:
        return {"success": False, "error": "No records parsed from yearly CSV"}

    # Find latest data point
    latest_year = max(r['year'] for r in records)

    logger.info(f"Latest data: {latest_year}")

    inserted = insert_statistics_batch(records, dry_run)

    if not dry_run:
        log_sync('yearly', YEARLY_CSV_URL, inserted, latest_year)

    return {
        "success": True,
        "records_parsed": len(records),
        "records_synced": inserted,
        "latest_year": latest_year
    }


def get_sync_status() -> Dict:
    """Get current sync status and data coverage."""

    # Check latest monthly data
    result = d1_execute("""
        SELECT MAX(year) as year, MAX(month) as month
        FROM ttb_spirits_stats
        WHERE month IS NOT NULL
    """)

    monthly_latest = None
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                if row.get("year"):
                    monthly_latest = f"{row['year']}-{row['month']:02d}"

    # Check latest yearly data
    result = d1_execute("""
        SELECT MAX(year) as year
        FROM ttb_spirits_stats
        WHERE month IS NULL
    """)

    yearly_latest = None
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                if row.get("year"):
                    yearly_latest = str(row['year'])

    # Total records
    result = d1_execute("SELECT COUNT(*) as total FROM ttb_spirits_stats")
    total_records = 0
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                total_records = row.get("total", 0)

    # Last sync
    result = d1_execute("""
        SELECT data_type, synced_at, records_synced, status
        FROM ttb_stats_sync_log
        ORDER BY synced_at DESC
        LIMIT 2
    """)

    last_syncs = []
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                last_syncs.append(row)

    return {
        "monthly_latest": monthly_latest,
        "yearly_latest": yearly_latest,
        "total_records": total_records,
        "last_syncs": last_syncs
    }


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Sync TTB distilled spirits statistics to D1"
    )
    parser.add_argument(
        '--monthly', action='store_true',
        help='Sync monthly data only'
    )
    parser.add_argument(
        '--yearly', action='store_true',
        help='Sync yearly data only'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Preview sync without writing to database'
    )
    parser.add_argument(
        '--status', action='store_true',
        help='Show current sync status and exit'
    )

    args = parser.parse_args()

    # Initialize D1
    init_d1_config(logger=logger)

    # Status check
    if args.status:
        status = get_sync_status()
        print(f"\nTTB Statistics Sync Status")
        print(f"=" * 40)
        print(f"Total records: {status['total_records']:,}")
        print(f"Monthly data through: {status['monthly_latest'] or 'N/A'}")
        print(f"Yearly data through: {status['yearly_latest'] or 'N/A'}")
        print(f"\nLast syncs:")
        for sync in status.get('last_syncs', []):
            print(f"  {sync['data_type']}: {sync['synced_at']} ({sync['records_synced']} records, {sync['status']})")
        return

    # Create tables
    if not create_tables_if_needed():
        logger.error("Failed to create database tables")
        sys.exit(1)

    results = {}

    # Determine what to sync
    sync_monthly_flag = args.monthly or (not args.monthly and not args.yearly)
    sync_yearly_flag = args.yearly or (not args.monthly and not args.yearly)

    if sync_monthly_flag:
        results['monthly'] = sync_monthly(args.dry_run)

    if sync_yearly_flag:
        results['yearly'] = sync_yearly(args.dry_run)

    # Summary
    print(f"\n{'=' * 50}")
    print("SYNC COMPLETE")
    print(f"{'=' * 50}")

    for data_type, result in results.items():
        status = "SUCCESS" if result.get("success") else "FAILED"
        print(f"\n{data_type.upper()}: {status}")
        if result.get("success"):
            print(f"  Records parsed: {result.get('records_parsed', 0):,}")
            print(f"  Records synced: {result.get('records_synced', 0):,}")
            if data_type == 'monthly':
                print(f"  Latest data: {result.get('latest_year')}-{result.get('latest_month', 0):02d}")
            else:
                print(f"  Latest data: {result.get('latest_year')}")
        else:
            print(f"  Error: {result.get('error')}")


if __name__ == "__main__":
    main()
