#!/usr/bin/env python3
"""
Backfill signal classification for recent COLA records.
Classifies records from the last N months that don't have a signal value.
"""

import os
import sys
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.getenv("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")

D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"

def d1_execute(sql: str, params: list = None):
    """Execute a SQL query against D1."""
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    response = requests.post(D1_API_URL, headers=headers, json=payload)
    return response.json()

def get_records_to_classify(months: int = 3):
    """Fetch records from last N months that need classification."""
    # Use year/month columns for reliable filtering
    cutoff = datetime.now() - timedelta(days=months * 30)
    cutoff_year = cutoff.year
    cutoff_month = cutoff.month

    print(f"Fetching records from {cutoff_month}/{cutoff_year} onwards...")

    # Filter by year >= cutoff_year, and if same year, month >= cutoff_month
    result = d1_execute(
        """SELECT ttb_id, company_name, brand_name, fanciful_name FROM colas
           WHERE (year > ? OR (year = ? AND month >= ?))
           ORDER BY year ASC, month ASC""",
        [cutoff_year, cutoff_year, cutoff_month]
    )

    if result.get("success") and result.get("result"):
        records = result["result"][0].get("results", [])
        print(f"Found {len(records):,} records to classify")
        return records
    else:
        print(f"Error fetching records: {result}")
        return []

def classify_record(record: dict) -> str:
    """Determine classification for a single record."""
    ttb_id = record.get('ttb_id')
    company_name = record.get('company_name', '') or ''
    brand_name = record.get('brand_name', '') or ''
    fanciful_name = record.get('fanciful_name', '') or ''

    if not company_name or not brand_name:
        return 'REFILE'

    # Check 1: Is this a new company?
    company_result = d1_execute(
        "SELECT COUNT(*) as cnt FROM colas WHERE company_name = ? AND ttb_id != ?",
        [company_name, ttb_id]
    )
    if company_result.get("success") and company_result.get("result"):
        cnt = company_result["result"][0].get("results", [{}])[0].get("cnt", 0)
        if cnt == 0:
            return 'NEW_COMPANY'

    # Check 2: Has this company+brand filed before?
    brand_result = d1_execute(
        "SELECT COUNT(*) as cnt FROM colas WHERE company_name = ? AND brand_name = ? AND ttb_id != ?",
        [company_name, brand_name, ttb_id]
    )
    if brand_result.get("success") and brand_result.get("result"):
        cnt = brand_result["result"][0].get("results", [{}])[0].get("cnt", 0)
        if cnt == 0:
            return 'NEW_BRAND'

    # Check 3: Has this company+brand+fanciful filed before?
    sku_result = d1_execute(
        "SELECT COUNT(*) as cnt FROM colas WHERE company_name = ? AND brand_name = ? AND fanciful_name = ? AND ttb_id != ?",
        [company_name, brand_name, fanciful_name, ttb_id]
    )
    if sku_result.get("success") and sku_result.get("result"):
        cnt = sku_result["result"][0].get("results", [{}])[0].get("cnt", 0)
        if cnt == 0:
            return 'NEW_SKU'

    return 'REFILE'

def update_signal(ttb_id: str, signal: str):
    """Update signal for a record in D1."""
    result = d1_execute(
        "UPDATE colas SET signal = ? WHERE ttb_id = ?",
        [signal, ttb_id]
    )
    return result.get("success", False)

def backfill_signals(months: int = 3, dry_run: bool = False):
    """Main backfill function."""
    records = get_records_to_classify(months)

    if not records:
        print("No records to classify")
        return

    stats = {
        'total': len(records),
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0,
        'errors': 0
    }

    for i, record in enumerate(records):
        ttb_id = record.get('ttb_id')

        try:
            signal = classify_record(record)

            if signal == 'NEW_COMPANY':
                stats['new_companies'] += 1
            elif signal == 'NEW_BRAND':
                stats['new_brands'] += 1
            elif signal == 'NEW_SKU':
                stats['new_skus'] += 1
            else:
                stats['refiles'] += 1

            if not dry_run:
                update_signal(ttb_id, signal)

        except Exception as e:
            print(f"Error classifying {ttb_id}: {e}")
            stats['errors'] += 1

        if (i + 1) % 100 == 0:
            print(f"  Processed {i+1:,}/{len(records):,} ({(i+1)/len(records)*100:.1f}%)")
            print(f"    Companies: {stats['new_companies']}, Brands: {stats['new_brands']}, SKUs: {stats['new_skus']}, Refiles: {stats['refiles']}")

    print("\n" + "="*50)
    print("BACKFILL COMPLETE" + (" (DRY RUN)" if dry_run else ""))
    print("="*50)
    print(f"Total records: {stats['total']:,}")
    print(f"New Companies: {stats['new_companies']:,}")
    print(f"New Brands: {stats['new_brands']:,}")
    print(f"New SKUs: {stats['new_skus']:,}")
    print(f"Refiles: {stats['refiles']:,}")
    print(f"Errors: {stats['errors']:,}")

if __name__ == "__main__":
    # Check for required env vars
    if not all([CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN]):
        print("Error: Missing required environment variables")
        print("Required: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN")
        sys.exit(1)

    # Parse arguments
    dry_run = "--dry-run" in sys.argv
    months = 3  # Default to 3 months

    for arg in sys.argv[1:]:
        if arg.startswith("--months="):
            months = int(arg.split("=")[1])

    print(f"Backfilling signals for last {months} months...")
    if dry_run:
        print("DRY RUN - no changes will be made")

    backfill_signals(months=months, dry_run=dry_run)
