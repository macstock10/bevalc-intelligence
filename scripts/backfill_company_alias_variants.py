#!/usr/bin/env python3
"""
Backfill normalized company_aliases variants.

Adds additional alias variants (normalized and comma-part forms) for existing
company_aliases entries, while skipping conflicts where a normalized key
would map to multiple company_ids.

Usage:
  python backfill_company_alias_variants.py --dry-run
  python backfill_company_alias_variants.py
"""

import os
import sys
import logging
from typing import Dict, List, Tuple
from pathlib import Path

# Ensure scripts/ is on path for lib imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    escape_sql_value,
    build_company_alias_variants,
    normalize_company_for_match,
)

# Config
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

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[logging.StreamHandler()]
)
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

def load_aliases() -> List[Tuple[str, int]]:
    result = d1_execute("SELECT raw_name, company_id FROM company_aliases")
    if not result.get("success") or not result.get("result"):
        logger.error("Failed to fetch company_aliases")
        sys.exit(1)
    rows = result["result"][0].get("results", [])
    return [(r.get("raw_name", ""), r.get("company_id")) for r in rows]

def main():
    dry_run = "--dry-run" in sys.argv
    validate_config()

    logger.info("Loading company_aliases...")
    rows = load_aliases()
    logger.info(f"Total aliases: {len(rows):,}")

    # Build existing maps
    existing_upper = {}  # UPPER(raw_name) -> company_id
    normalized_map = {}  # normalized -> company_id (if unique)
    conflicts = set()    # normalized keys with multiple company_ids

    for raw, cid in rows:
        if not raw or cid is None:
            continue
        key = raw.strip().upper()
        existing_upper[key] = cid
        norm = normalize_company_for_match(raw)
        if not norm:
            continue
        if norm in normalized_map and normalized_map[norm] != cid:
            conflicts.add(norm)
        else:
            normalized_map[norm] = cid

    if conflicts:
        logger.warning(f"Normalized conflicts detected: {len(conflicts):,} (will skip)")

    # Build insert list
    alias_values = []
    for raw, cid in rows:
        if not raw or cid is None:
            continue

        for alias in build_company_alias_variants(raw):
            alias = (alias or '').strip()
            if not alias:
                continue
            alias_upper = alias.upper()

            # Skip if already exists
            if alias_upper in existing_upper:
                continue

            # Skip if normalized form conflicts
            norm = normalize_company_for_match(alias)
            if norm and norm in conflicts:
                continue

            alias_values.append((alias, cid))
            existing_upper[alias_upper] = cid

    logger.info(f"Alias variants to add: {len(alias_values):,}")

    if dry_run:
        logger.info("[DRY RUN] No changes made")
        return

    # Insert in batches
    batch_size = 500
    total_inserted = 0
    for i in range(0, len(alias_values), batch_size):
        batch = alias_values[i:i + batch_size]
        values_sql = ",".join(
            f"({escape_sql_value(alias)}, {cid})" for alias, cid in batch
        )
        sql = f"INSERT OR IGNORE INTO company_aliases (raw_name, company_id) VALUES {values_sql}"
        result = d1_execute(sql)
        if result.get("success"):
            for res in result.get("result", []):
                total_inserted += res.get("meta", {}).get("changes", 0)

    logger.info(f"Inserted {total_inserted:,} new alias variants")

if __name__ == "__main__":
    main()
