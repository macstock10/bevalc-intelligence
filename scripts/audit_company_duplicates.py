#!/usr/bin/env python3
"""
audit_company_duplicates.py - Audit normalized company duplicates without merging.

Outputs two CSVs:
  - auto_merge_candidates_YYYYMMDD.csv
  - review_needed_YYYYMMDD.csv

Heuristics for auto-merge:
  - Exact phone overlap OR exact (street+state) overlap
  - OR brand overlap >= 3
Otherwise, mark for review.
"""

import os
import sys
import csv
import logging
from datetime import datetime
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
LOGS_DIR = BASE_DIR / "logs"

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
    # Only keep groups with multiple company_ids
    return {k: v for k, v in groups.items() if len(set(cid for _, cid in v)) > 1}


def fetch_company_counts(company_ids):
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


def fetch_company_addresses(company_ids, limit_per_company=5):
    placeholders = ",".join(str(int(cid)) for cid in company_ids)
    sql = f"""
        SELECT ca.company_id, c.street, c.state, c.phone_number, COUNT(*) as cnt
        FROM colas c
        JOIN company_aliases ca ON c.company_name = ca.raw_name
        WHERE ca.company_id IN ({placeholders})
        GROUP BY ca.company_id, c.street, c.state, c.phone_number
        ORDER BY cnt DESC
    """
    result = d1_execute(sql)
    addr = {cid: [] for cid in company_ids}
    if result.get("success") and result.get("result"):
        for row in result["result"][0].get("results", []):
            cid = row.get("company_id")
            if cid is None:
                continue
            if len(addr[cid]) >= limit_per_company:
                continue
            street = row.get("street") or ""
            state = row.get("state") or ""
            phone = row.get("phone_number") or ""
            addr[cid].append((street, state, phone))
    return addr


def fetch_company_brands(company_ids, limit_per_company=200):
    placeholders = ",".join(str(int(cid)) for cid in company_ids)
    sql = f"""
        SELECT ca.company_id, UPPER(c.brand_name) as brand, COUNT(*) as cnt
        FROM colas c
        JOIN company_aliases ca ON c.company_name = ca.raw_name
        WHERE ca.company_id IN ({placeholders})
          AND c.brand_name IS NOT NULL
        GROUP BY ca.company_id, UPPER(c.brand_name)
        ORDER BY cnt DESC
    """
    result = d1_execute(sql)
    brands = {cid: set() for cid in company_ids}
    if result.get("success") and result.get("result"):
        for row in result["result"][0].get("results", []):
            cid = row.get("company_id")
            brand = row.get("brand")
            if cid is None or not brand:
                continue
            if len(brands[cid]) < limit_per_company:
                brands[cid].add(brand)
    return brands


def compute_brand_overlap(brands_by_cid):
    cids = list(brands_by_cid.keys())
    overlap = 0
    for i in range(len(cids)):
        for j in range(i + 1, len(cids)):
            overlap = max(overlap, len(brands_by_cid[cids[i]].intersection(brands_by_cid[cids[j]])))
    return overlap


def has_address_or_phone_overlap(addresses_by_cid):
    cids = list(addresses_by_cid.keys())
    for i in range(len(cids)):
        for j in range(i + 1, len(cids)):
            set_a = set(addresses_by_cid[cids[i]])
            set_b = set(addresses_by_cid[cids[j]])
            if set_a.intersection(set_b):
                return True
    return False


def main():
    validate_config()
    os.makedirs(LOGS_DIR, exist_ok=True)

    aliases = fetch_aliases()
    groups = group_by_normalized(aliases)
    logger.info(f"Duplicate normalized groups: {len(groups):,}")

    date_tag = datetime.now().strftime("%Y%m%d")
    auto_path = LOGS_DIR / f"auto_merge_candidates_{date_tag}.csv"
    review_path = LOGS_DIR / f"review_needed_{date_tag}.csv"

    with open(auto_path, 'w', newline='', encoding='utf-8') as auto_f, \
         open(review_path, 'w', newline='', encoding='utf-8') as review_f:
        auto_writer = csv.writer(auto_f)
        review_writer = csv.writer(review_f)

        header = [
            "normalized_key",
            "company_ids",
            "alias_examples",
            "filing_counts",
            "address_phone_examples",
            "brand_overlap_max",
            "recommendation",
        ]
        auto_writer.writerow(header)
        review_writer.writerow(header)

        for norm_key, entries in groups.items():
            company_ids = sorted(set(cid for _, cid in entries))
            alias_examples = sorted(set(raw for raw, _ in entries))[:6]

            counts = fetch_company_counts(company_ids)
            addresses = fetch_company_addresses(company_ids)
            brands = fetch_company_brands(company_ids)

            addr_overlap = has_address_or_phone_overlap(addresses)
            brand_overlap = compute_brand_overlap(brands)

            recommendation = "auto_merge" if (addr_overlap or brand_overlap >= 3) else "review"

            row = [
                norm_key,
                "|".join(str(cid) for cid in company_ids),
                "|".join(alias_examples),
                "|".join(f"{cid}:{counts.get(cid, 0)}" for cid in company_ids),
                "|".join(
                    f"{cid}:{';'.join([f'{a[0]} {a[1]} {a[2]}'.strip() for a in addresses.get(cid, [])])}"
                    for cid in company_ids
                ),
                brand_overlap,
                recommendation,
            ]

            if recommendation == "auto_merge":
                auto_writer.writerow(row)
            else:
                review_writer.writerow(row)

    logger.info(f"Wrote: {auto_path}")
    logger.info(f"Wrote: {review_path}")


if __name__ == "__main__":
    main()
