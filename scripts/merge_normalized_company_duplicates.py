#!/usr/bin/env python3
"""
merge_normalized_company_duplicates.py - Merge companies that normalize to the same key.

This addresses cases like:
  "Warwick Farm Brewing, LLC"
  "Warwick Farm Brewing, Warwick Farm Brewing, LLC"
that normalize to the same key but ended up with different company_ids.

Strategy (conservative):
  - Group aliases by normalize_company_for_match(raw_name)
  - If group has multiple company_ids:
      - If any company_id has 0 filings -> merge into canonical
      - Else if any brand overlaps between company_ids -> merge
      - Else skip (needs manual review)

USAGE:
  python merge_normalized_company_duplicates.py --analyze
  python merge_normalized_company_duplicates.py --dry-run
  python merge_normalized_company_duplicates.py
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from collections import defaultdict

from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    escape_sql_value,
    normalize_company_for_match,
)

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

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger(__name__)


def validate_config():
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not CLOUDFLARE_D1_DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if not CLOUDFLARE_API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")
    if missing:
        logger.error(f"Missing environment variables: {', '.join(missing)}")
        sys.exit(1)

    init_d1_config(
        account_id=CLOUDFLARE_ACCOUNT_ID,
        database_id=CLOUDFLARE_D1_DATABASE_ID,
        api_token=CLOUDFLARE_API_TOKEN,
        batch_size=500,
        logger=logger
    )


def fetch_aliases():
    result = d1_execute("SELECT raw_name, company_id FROM company_aliases ORDER BY company_id")
    if not result.get("success") or not result.get("result"):
        logger.error("Failed to fetch company_aliases")
        sys.exit(1)
    return result["result"][0].get("results", [])


def group_by_normalized(aliases):
    groups = defaultdict(list)
    for row in aliases:
        raw = row.get("raw_name") or ""
        cid = row.get("company_id")
        key = normalize_company_for_match(raw)
        if not key:
            continue
        groups[key].append((raw, cid))
    return groups


def get_company_counts(company_ids):
    placeholders = ",".join(str(int(cid)) for cid in company_ids)
    sql = f"""
        SELECT ca.company_id, COUNT(*) as cnt
        FROM colas c
        JOIN company_aliases ca ON c.company_name = ca.raw_name
        WHERE ca.company_id IN ({placeholders})
        GROUP BY ca.company_id
    """
    result = d1_execute(sql)
    counts = {cid: 0 for cid in company_ids}
    if result.get("success") and result.get("result"):
        for row in result["result"][0].get("results", []):
            counts[row.get("company_id")] = row.get("cnt", 0)
    return counts


def get_company_brands(company_ids, limit_per_company=1000):
    placeholders = ",".join(str(int(cid)) for cid in company_ids)
    sql = f"""
        SELECT ca.company_id, UPPER(c.brand_name) as brand_name
        FROM colas c
        JOIN company_aliases ca ON c.company_name = ca.raw_name
        WHERE ca.company_id IN ({placeholders})
          AND c.brand_name IS NOT NULL
        GROUP BY ca.company_id, UPPER(c.brand_name)
    """
    result = d1_execute(sql)
    brands = {cid: set() for cid in company_ids}
    if result.get("success") and result.get("result"):
        for row in result["result"][0].get("results", []):
            cid = row.get("company_id")
            brand = row.get("brand_name")
            if cid is not None and brand:
                if len(brands[cid]) < limit_per_company:
                    brands[cid].add(brand)
    return brands


def analyze_groups(groups, max_examples=10):
    dup_groups = {k: v for k, v in groups.items() if len(set(cid for _, cid in v)) > 1}
    logger.info(f"Normalized duplicate groups: {len(dup_groups):,}")

    if dup_groups:
        logger.info("Examples:")
        for i, (key, entries) in enumerate(list(dup_groups.items())[:max_examples]):
            logger.info(f"  {key}")
            for raw, cid in sorted(entries, key=lambda x: (x[1], x[0])):
                logger.info(f"    - {raw} -> {cid}")

    return dup_groups


def merge_groups(dup_groups, dry_run=False):
    merged = 0
    skipped = 0

    for key, entries in dup_groups.items():
        company_ids = sorted(set(cid for _, cid in entries if cid is not None))
        if len(company_ids) < 2:
            continue

        canonical_id = company_ids[0]
        counts = get_company_counts(company_ids)

        # If any has 0 filings, merge it safely
        merge_ids = [cid for cid in company_ids[1:] if counts.get(cid, 0) == 0]

        # If no zero-count merges, check for brand overlap
        if not merge_ids:
            brands = get_company_brands(company_ids)
            overlap = False
            for i in range(len(company_ids)):
                for j in range(i + 1, len(company_ids)):
                    if brands[company_ids[i]].intersection(brands[company_ids[j]]):
                        overlap = True
                        break
                if overlap:
                    break
            if overlap:
                merge_ids = company_ids[1:]

        if not merge_ids:
            skipped += 1
            continue

        # Update aliases pointing to merge_ids -> canonical_id
        for raw, cid in entries:
            if cid in merge_ids:
                sql = (
                    "UPDATE company_aliases "
                    f"SET company_id = {canonical_id} "
                    f"WHERE raw_name = {escape_sql_value(raw)}"
                )
                if not dry_run:
                    result = d1_execute(sql)
                    if result.get("success"):
                        merged += 1
                else:
                    merged += 1

        if merged % 500 == 0 and merged > 0:
            logger.info(f"  Progress: {merged:,} aliases updated...")

    logger.info(f"\nMerged alias rows: {merged:,}")
    logger.info(f"Skipped groups (no safe merge rule triggered): {skipped:,}")


def main():
    parser = argparse.ArgumentParser(description='Merge normalized duplicate companies')
    parser.add_argument('--analyze', action='store_true', help='Analyze only, no changes')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without executing')
    args = parser.parse_args()

    validate_config()

    aliases = fetch_aliases()
    groups = group_by_normalized(aliases)
    dup_groups = analyze_groups(groups)

    if args.analyze:
        return

    if dup_groups:
        merge_groups(dup_groups, dry_run=args.dry_run)
        if not args.dry_run:
            logger.info("\nNormalized duplicates merged. Run batch_classify.py to fix signals.")


if __name__ == '__main__':
    main()
