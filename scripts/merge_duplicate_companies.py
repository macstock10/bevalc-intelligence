"""
merge_duplicate_companies.py — Merge companies that share a comma-separated legal entity.

When TTB files "Trade Name A, Parent LLC" and "Trade Name B, Parent LLC", they should
be the same company. This script finds all such duplicates and merges them:

1. Picks the lowest company_id as primary (oldest = most history)
2. Reassigns all aliases from secondary companies to primary
3. Reclassifies signals for affected COLAs
4. Deletes secondary company rows

USAGE:
    python scripts/merge_duplicate_companies.py --dry-run     # preview changes
    python scripts/merge_duplicate_companies.py               # execute merge
"""

import os
import sys
import argparse
import logging
import requests
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"

sys.path.insert(0, str(SCRIPT_DIR))
from lib.d1_utils import is_matchable_variant

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("merge_dupes")


# =============================================================================
# Environment & D1
# =============================================================================

def load_env():
    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())


_d1 = {}

def init_d1():
    for key in ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']:
        val = os.environ.get(key)
        if not val:
            logger.error(f"Missing {key}")
            sys.exit(1)
        _d1[key] = val
    _d1['url'] = (
        f"https://api.cloudflare.com/client/v4/accounts/{_d1['CLOUDFLARE_ACCOUNT_ID']}"
        f"/d1/database/{_d1['CLOUDFLARE_D1_DATABASE_ID']}/query"
    )


def d1_execute(sql):
    resp = requests.post(_d1['url'],
        headers={"Authorization": f"Bearer {_d1['CLOUDFLARE_API_TOKEN']}",
                 "Content-Type": "application/json"},
        json={"sql": sql}, timeout=120)
    data = resp.json()
    if not data.get("success"):
        logger.error(f"D1 error: {resp.text[:300]}")
    return data


def d1_rows(sql):
    result = d1_execute(sql)
    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def d1_changes(result):
    if result.get("success") and result.get("result"):
        return result["result"][0].get("meta", {}).get("changes", 0)
    return 0


def esc(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


# =============================================================================
# Find duplicate groups
# =============================================================================

def find_duplicate_groups():
    """Find companies that share a comma-separated legal entity name."""
    rows = d1_rows("SELECT raw_name, company_id FROM company_aliases WHERE raw_name LIKE '%, %'")
    logger.info(f"Loaded {len(rows)} comma-separated aliases")

    # Build map: second_part -> [(raw_name, company_id)]
    part_map = defaultdict(list)
    for row in rows:
        name = row['raw_name']
        cid = row['company_id']
        idx = name.index(', ')
        second_part = name[idx + 2:].strip()
        if second_part:
            part_map[second_part].append((name, cid))

    # Find groups with multiple company_ids, filtered by matchability
    groups = []
    for part, entries in sorted(part_map.items()):
        cids = set(cid for _, cid in entries)
        if len(cids) > 1 and is_matchable_variant(part):
            primary = min(cids)
            secondaries = sorted(cids - {primary})
            groups.append({
                'shared_part': part,
                'primary_id': primary,
                'secondary_ids': secondaries,
                'all_ids': sorted(cids),
            })

    return groups


# =============================================================================
# Merge
# =============================================================================

def merge_groups(groups, dry_run=False):
    """Merge duplicate companies: reassign aliases, reclassify signals, delete secondaries."""

    # Build merge map: secondary_id -> primary_id
    merge_map = {}
    for group in groups:
        for sid in group['secondary_ids']:
            # If this secondary is already a primary in another group, pick the lowest
            if sid in merge_map:
                merge_map[sid] = min(merge_map[sid], group['primary_id'])
            else:
                merge_map[sid] = group['primary_id']

    # Resolve chains: if A -> B and B -> C, then A -> C
    def resolve(sid):
        visited = set()
        while sid in merge_map and sid not in visited:
            visited.add(sid)
            sid = merge_map[sid]
        return sid

    for sid in list(merge_map.keys()):
        merge_map[sid] = resolve(sid)

    all_secondary_ids = sorted(merge_map.keys())
    unique_primaries = sorted(set(merge_map.values()))

    logger.info(f"\nFound {len(groups)} duplicate groups")
    logger.info(f"Merging {len(all_secondary_ids)} secondary companies into {len(unique_primaries)} primaries")

    # Preview
    for group in groups[:10]:
        logger.info(f"\n  '{group['shared_part']}':")
        logger.info(f"    primary={group['primary_id']}, merging {group['secondary_ids']}")
    if len(groups) > 10:
        logger.info(f"\n  ... and {len(groups) - 10} more groups")

    if dry_run:
        logger.info(f"\n[DRY RUN] Would merge {len(all_secondary_ids)} companies. No changes made.")
        return

    # Step 1: Reassign aliases
    logger.info("\n[Step 1/3] Reassigning aliases...")
    primary_to_sids = defaultdict(list)
    for sid, pid in merge_map.items():
        primary_to_sids[pid].append(sid)

    aliases_updated = 0
    for pid, sids in primary_to_sids.items():
        for i in range(0, len(sids), 50):
            chunk = sids[i:i+50]
            ids_str = ','.join(str(s) for s in chunk)
            result = d1_execute(
                f"UPDATE company_aliases SET company_id = {pid} WHERE company_id IN ({ids_str})"
            )
            aliases_updated += d1_changes(result)

    logger.info(f"  Updated {aliases_updated} alias rows")

    # Step 2: Reclassify signals
    logger.info("\n[Step 2/3] Reclassifying signals for merged companies...")
    reclassify_merged(unique_primaries)

    # Step 3: Delete secondary company rows
    logger.info("\n[Step 3/3] Deleting secondary company rows...")
    deleted = 0
    for i in range(0, len(all_secondary_ids), 50):
        chunk = all_secondary_ids[i:i+50]
        ids_str = ','.join(str(s) for s in chunk)
        result = d1_execute(f"DELETE FROM companies WHERE id IN ({ids_str})")
        deleted += d1_changes(result)

    logger.info(f"  Deleted {deleted} duplicate company rows")


# =============================================================================
# Reclassify signals
# =============================================================================

def reclassify_merged(primary_ids):
    """Reclassify signals for all COLAs belonging to merged companies.

    Walks through each primary company's filings chronologically and assigns
    the correct signal based on first-seen company/brand/SKU logic.
    """
    total_reclassified = 0
    companies_checked = 0

    for pid in primary_ids:
        companies_checked += 1
        if companies_checked % 20 == 0:
            logger.info(f"  Progress: {companies_checked}/{len(primary_ids)} companies...")

        # Get all COLAs for this company chronologically
        colas = d1_rows(
            f"SELECT c.ttb_id, c.brand_name, c.fanciful_name, c.signal "
            f"FROM colas c "
            f"JOIN company_aliases ca ON c.company_name = ca.raw_name "
            f"WHERE ca.company_id = {pid} "
            f"ORDER BY c.year, c.month, c.day, c.ttb_id"
        )

        if not colas:
            continue

        # Walk chronologically and compute correct signals
        seen_company = False
        seen_brands = set()
        seen_skus = set()
        updates = {}  # new_signal -> [ttb_ids]

        for cola in colas:
            ttb_id = cola['ttb_id']
            brand = (cola.get('brand_name') or '').strip().lower()
            fanciful = (cola.get('fanciful_name') or '').strip().lower()
            old_signal = cola.get('signal')
            sku_key = (brand, fanciful)

            if not brand:
                new_signal = 'REFILE'
            elif not seen_company:
                new_signal = 'NEW_COMPANY'
                seen_company = True
            elif brand not in seen_brands:
                new_signal = 'NEW_BRAND'
            elif sku_key not in seen_skus:
                new_signal = 'NEW_SKU'
            else:
                new_signal = 'REFILE'

            seen_brands.add(brand)
            seen_skus.add(sku_key)

            if old_signal != new_signal:
                if new_signal not in updates:
                    updates[new_signal] = []
                updates[new_signal].append(ttb_id)

        # Apply updates
        count = sum(len(ids) for ids in updates.values())
        if count > 0:
            for new_signal, ttb_ids in updates.items():
                for i in range(0, len(ttb_ids), 100):
                    chunk = ttb_ids[i:i+100]
                    ids_str = ','.join(f"'{t}'" for t in chunk)
                    d1_execute(
                        f"UPDATE colas SET signal = '{new_signal}' WHERE ttb_id IN ({ids_str})"
                    )

            total_reclassified += count
            if total_reclassified <= 30:
                for sig, ids in updates.items():
                    logger.info(f"    company {pid}: {len(ids)} COLAs -> {sig}")

    logger.info(f"  Total COLAs reclassified: {total_reclassified}")


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Merge duplicate companies sharing legal entity names')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    args = parser.parse_args()

    load_env()
    init_d1()

    groups = find_duplicate_groups()
    merge_groups(groups, dry_run=args.dry_run)

    if not args.dry_run and groups:
        logger.info("\nDone. Duplicates merged and signals reclassified.")


if __name__ == '__main__':
    main()
