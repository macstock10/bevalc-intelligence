#!/usr/bin/env python3
"""
merge_remaining_new_company_duplicates.py - Merge remaining NEW_COMPANY duplicates by normalized key.

This script targets residual cases where NEW_COMPANY records still map to
multiple company_ids after normalized aliasing and conservative merges.

It:
  - Builds normalized keys from NEW_COMPANY company_name values
  - Resolves each to company_id via company_aliases (raw + normalized)
  - Finds keys mapping to multiple company_ids
  - Merges all aliases for non-canonical IDs into the lowest company_id

USAGE:
  python merge_remaining_new_company_duplicates.py --analyze
  python merge_remaining_new_company_duplicates.py --apply
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
    escape_sql_value,
    normalize_company_for_match,
)

# Setup paths
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


def load_new_company_rows():
    result = d1_execute("SELECT ttb_id, company_name FROM colas WHERE signal = 'NEW_COMPANY'")
    if not result.get("success") or not result.get("result"):
        logger.error("Failed to fetch NEW_COMPANY rows")
        sys.exit(1)
    return result["result"][0].get("results", [])


def build_problem_groups(aliases, rows):
    # Build normalized key -> set(company_id) from aliases
    norm_to_company_ids = defaultdict(set)
    raw_upper_to_company_id = {}
    for row in aliases:
        raw = (row.get("raw_name") or "").strip()
        cid = row.get("company_id")
        if not raw or cid is None:
            continue
        raw_upper_to_company_id[raw.upper()] = cid
        norm = normalize_company_for_match(raw)
        if norm:
            norm_to_company_ids[norm].add(cid)

    key_to_company_ids = defaultdict(set)
    key_to_examples = defaultdict(list)

    for row in rows:
        company_name = (row.get("company_name") or "").strip()
        if not company_name:
            continue
        norm = normalize_company_for_match(company_name)
        # Prefer raw match, but fall back to normalized groups
        cid = raw_upper_to_company_id.get(company_name.upper())
        if cid is not None:
            key_to_company_ids[norm].add(cid)
        else:
            for cid in norm_to_company_ids.get(norm, set()):
                key_to_company_ids[norm].add(cid)
        if len(key_to_examples[norm]) < 3:
            key_to_examples[norm].append(company_name)

    problems = {
        k: {
            "company_ids": sorted(list(v)),
            "examples": key_to_examples[k]
        }
        for k, v in key_to_company_ids.items()
        if len(v) > 1
    }
    return problems


def merge_company_ids(company_ids, dry_run=False):
    canonical_id = min(company_ids)
    merge_ids = [cid for cid in company_ids if cid != canonical_id]

    updated = 0
    for cid in merge_ids:
        sql = f"UPDATE company_aliases SET company_id = {canonical_id} WHERE company_id = {cid}"
        if not dry_run:
            result = d1_execute(sql)
            if result.get("success"):
                for res in result.get("result", []):
                    updated += res.get("meta", {}).get("changes", 0)
        else:
            updated += 1

    return canonical_id, merge_ids, updated


def main():
    parser = argparse.ArgumentParser(description='Merge remaining NEW_COMPANY duplicates by normalized key')
    parser.add_argument('--analyze', action='store_true', help='Analyze only, no changes')
    parser.add_argument('--apply', action='store_true', help='Apply merges')
    args = parser.parse_args()

    if not args.analyze and not args.apply:
        logger.error("Specify --analyze or --apply")
        sys.exit(1)

    validate_config()

    aliases = load_aliases()
    rows = load_new_company_rows()
    problems = build_problem_groups(aliases, rows)

    logger.info(f"Remaining NEW_COMPANY normalized keys with >1 company_id: {len(problems):,}")
    if problems:
        logger.info("Examples:")
        for i, (k, info) in enumerate(list(problems.items())[:10]):
            logger.info(f"  {k} -> {info['company_ids']} examples={info['examples']}")

    if args.analyze:
        return

    total_updates = 0
    for key, info in problems.items():
        canonical_id, merge_ids, updated = merge_company_ids(info["company_ids"], dry_run=False)
        total_updates += updated
        if total_updates and total_updates % 500 == 0:
            logger.info(f"  Progress: {total_updates:,} aliases updated...")

    logger.info(f"Total alias rows updated: {total_updates:,}")
    logger.info("Merges applied. Run batch_classify.py to update signals.")


if __name__ == '__main__':
    main()
