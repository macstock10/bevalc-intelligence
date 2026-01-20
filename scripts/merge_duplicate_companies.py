"""
merge_duplicate_companies.py - Merge companies that differ only by case

Finds company_aliases entries that have the same UPPER(raw_name) but different
company_ids, and consolidates them to use the earliest (lowest) company_id.

USAGE:
    python merge_duplicate_companies.py --analyze    # See duplicates
    python merge_duplicate_companies.py --dry-run    # Preview changes
    python merge_duplicate_companies.py              # Execute merge
"""

import os
import sys
import argparse
import logging
import requests
from pathlib import Path
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

CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)


def d1_execute(sql: str):
    """Execute SQL against D1."""
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }
    response = requests.post(D1_API_URL, headers=headers, json={"sql": sql}, timeout=120)
    if response.status_code != 200:
        logger.error(f"D1 error: {response.status_code} - {response.text}")
        return {"success": False}
    return response.json()


def find_duplicates():
    """Find all case-variant duplicates in company_aliases."""
    logger.info("Finding case-variant duplicates...")

    # Get all company_aliases
    result = d1_execute("SELECT raw_name, company_id FROM company_aliases ORDER BY company_id")

    if not result.get("success"):
        logger.error("Failed to fetch company_aliases")
        return {}

    rows = result.get("result", [{}])[0].get("results", [])
    logger.info(f"Total company_aliases: {len(rows):,}")

    # Group by UPPER(raw_name)
    groups = defaultdict(list)
    for row in rows:
        raw = row["raw_name"]
        cid = row["company_id"]
        groups[raw.upper()].append((raw, cid))

    # Find groups with multiple company_ids
    duplicates = {}
    for upper_name, entries in groups.items():
        company_ids = set(cid for _, cid in entries)
        if len(company_ids) > 1:
            duplicates[upper_name] = entries

    return duplicates


def analyze_duplicates(duplicates):
    """Show analysis of duplicates."""
    logger.info(f"\nFound {len(duplicates):,} company names with case-variant duplicates")

    if not duplicates:
        return

    # Show some examples
    logger.info("\nExamples (first 10):")
    for i, (upper_name, entries) in enumerate(list(duplicates.items())[:10]):
        logger.info(f"\n  '{upper_name}':")
        for raw, cid in sorted(entries, key=lambda x: x[1]):
            logger.info(f"    - '{raw}' -> company_id {cid}")

    # Count total aliases affected
    total_aliases = sum(len(e) for e in duplicates.values())
    logger.info(f"\nTotal aliases affected: {total_aliases:,}")


def merge_duplicates(duplicates, dry_run=False):
    """Merge duplicates by updating all to use the lowest company_id."""
    logger.info(f"\nMerging {len(duplicates):,} duplicate groups...")

    if dry_run:
        logger.info("[DRY RUN] No changes will be made")

    updates_done = 0

    for upper_name, entries in duplicates.items():
        # Find the lowest company_id (the "canonical" one)
        sorted_entries = sorted(entries, key=lambda x: x[1])
        canonical_id = sorted_entries[0][1]

        # Update all other aliases to point to canonical_id
        for raw, cid in sorted_entries[1:]:
            if cid != canonical_id:
                escaped_raw = raw.replace("'", "''")
                sql = f"UPDATE company_aliases SET company_id = {canonical_id} WHERE raw_name = '{escaped_raw}'"

                if not dry_run:
                    result = d1_execute(sql)
                    if result.get("success"):
                        updates_done += 1
                else:
                    updates_done += 1

        if updates_done % 500 == 0 and updates_done > 0:
            logger.info(f"  Progress: {updates_done:,} aliases updated...")

    logger.info(f"\nTotal aliases updated: {updates_done:,}")
    return updates_done


def main():
    parser = argparse.ArgumentParser(description='Merge case-variant duplicate companies')
    parser.add_argument('--analyze', action='store_true', help='Only analyze, no changes')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without executing')

    args = parser.parse_args()

    if not CLOUDFLARE_API_TOKEN:
        logger.error("CLOUDFLARE_API_TOKEN not set")
        sys.exit(1)

    duplicates = find_duplicates()
    analyze_duplicates(duplicates)

    if not args.analyze and duplicates:
        merge_duplicates(duplicates, dry_run=args.dry_run)

        if not args.dry_run:
            logger.info("\nDuplicates merged. Run batch_classify.py to fix signals.")


if __name__ == '__main__':
    main()
