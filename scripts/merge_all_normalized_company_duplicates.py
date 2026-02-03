#!/usr/bin/env python3
"""
merge_all_normalized_company_duplicates.py - Strict merge of all normalized duplicates.

This will merge all company_aliases that share the same normalized key
into a single canonical company_id (lowest ID). This is the strict mode
to enforce correctness for company identity across variant names.

USAGE:
  python merge_all_normalized_company_duplicates.py --analyze
  python merge_all_normalized_company_duplicates.py --apply
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from collections import defaultdict

# Ensure scripts/ is on path for lib imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    normalize_company_for_match,
)

BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = str(BASE_DIR / ".env")

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


def load_aliases():
    result = d1_execute("SELECT raw_name, company_id FROM company_aliases")
    if not result.get("success") or not result.get("result"):
        logger.error("Failed to fetch company_aliases")
        sys.exit(1)
    return result["result"][0].get("results", [])


def group_by_normalized(aliases):
    groups = defaultdict(list)
    for row in aliases:
        raw = (row.get("raw_name") or "").strip()
        cid = row.get("company_id")
        if not raw or cid is None:
            continue
        norm = normalize_company_for_match(raw)
        if not norm:
            continue
        groups[norm].append((raw, cid))
    return groups


def analyze(groups, max_examples=10):
    dup_groups = {k: v for k, v in groups.items() if len(set(cid for _, cid in v)) > 1}
    logger.info(f"Normalized duplicate groups: {len(dup_groups):,}")
    if dup_groups:
        logger.info("Examples:")
        for i, (key, entries) in enumerate(list(dup_groups.items())[:max_examples]):
            logger.info(f"  {key}")
            for raw, cid in sorted(entries, key=lambda x: (x[1], x[0])):
                logger.info(f"    - {raw} -> {cid}")
    return dup_groups


def apply_merges(dup_groups):
    updated = 0
    for key, entries in dup_groups.items():
        company_ids = sorted(set(cid for _, cid in entries))
        if len(company_ids) < 2:
            continue
        canonical_id = company_ids[0]
        for _, cid in entries:
            if cid == canonical_id:
                continue
            sql = f"UPDATE company_aliases SET company_id = {canonical_id} WHERE company_id = {cid}"
            result = d1_execute(sql)
            if result.get("success"):
                for res in result.get("result", []):
                    updated += res.get("meta", {}).get("changes", 0)
        if updated and updated % 1000 == 0:
            logger.info(f"  Progress: {updated:,} aliases updated...")
    logger.info(f"Total alias rows updated: {updated:,}")


def main():
    parser = argparse.ArgumentParser(description='Merge all normalized duplicate companies (strict)')
    parser.add_argument('--analyze', action='store_true', help='Analyze only, no changes')
    parser.add_argument('--apply', action='store_true', help='Apply merges')
    args = parser.parse_args()

    if not args.analyze and not args.apply:
        logger.error("Specify --analyze or --apply")
        sys.exit(1)

    validate_config()

    aliases = load_aliases()
    groups = group_by_normalized(aliases)
    dup_groups = analyze(groups)

    if args.analyze:
        return
    if dup_groups:
        apply_merges(dup_groups)
        logger.info("Strict merges applied. Run batch_classify.py to update signals.")


if __name__ == '__main__':
    main()
