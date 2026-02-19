"""
rebuild_company_aliases.py - Reverse aggressive legal-entity merges.

This script undoes merges caused by matching on comma-separated legal entity tails.
It analyzes company aliases using only the first comma part (trade name), builds
order-independent deterministic clusters, and splits over-merged companies.

Usage:
    python scripts/rebuild_company_aliases.py --dry-run
    python scripts/rebuild_company_aliases.py
"""

import argparse
import logging
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

import requests

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"

sys.path.insert(0, str(SCRIPT_DIR))
from lib.d1_utils import normalize_company_name, normalize_company_for_match, make_slug

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("rebuild")


# =============================================================================
# D1 helpers
# =============================================================================


def load_env() -> None:
    if ENV_FILE.exists():
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


_d1: Dict[str, str] = {}


def init_d1() -> None:
    for key in ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_API_TOKEN"]:
        val = os.environ.get(key)
        if not val:
            logger.error(f"Missing {key}")
            sys.exit(1)
        _d1[key] = val

    _d1["url"] = (
        f"https://api.cloudflare.com/client/v4/accounts/{_d1['CLOUDFLARE_ACCOUNT_ID']}"
        f"/d1/database/{_d1['CLOUDFLARE_D1_DATABASE_ID']}/query"
    )


def d1_execute(sql: str, params: List = None) -> Dict:
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    try:
        resp = requests.post(
            _d1["url"],
            headers={
                "Authorization": f"Bearer {_d1['CLOUDFLARE_API_TOKEN']}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
        )
    except requests.RequestException as exc:
        logger.error(f"D1 request failed: {exc}")
        return {"success": False, "error": str(exc)}

    if resp.status_code != 200:
        logger.error(f"D1 HTTP {resp.status_code}: {resp.text[:400]}")
        return {"success": False, "error": resp.text}

    try:
        data = resp.json()
    except ValueError:
        logger.error(f"D1 returned non-JSON response: {resp.text[:400]}")
        return {"success": False, "error": "non_json_response"}

    if not data.get("success"):
        err = data.get("errors") or data
        logger.error(f"D1 error: {err}")

    return data


def d1_rows(sql: str) -> List[Dict]:
    result = d1_execute(sql)
    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def d1_changes(result: Dict) -> int:
    if result.get("success") and result.get("result"):
        return result["result"][0].get("meta", {}).get("changes", 0)
    return 0


def esc(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value).replace("'", "''")
    s = re.sub(r"[\x00-\x1f\x7f]", "", s)
    return "'" + s + "'"


# =============================================================================
# Deterministic trade-name matching (text-only)
# =============================================================================


_ABBREV_TOKEN_MAP = {
    "USA": "US",
}


def extract_trade_name(raw_alias: str) -> str:
    if not raw_alias:
        return ""
    return raw_alias.split(",", 1)[0].strip()


def canonicalize_trade_name(name: str) -> str:
    """Deterministic trade-name key from filing text."""
    base = normalize_company_for_match(name).upper().strip()
    if not base:
        return ""

    raw_tokens = [t for t in base.split() if t]
    if not raw_tokens:
        return ""

    tokens = []
    i = 0
    while i < len(raw_tokens):
        token = raw_tokens[i]

        # Collapse contiguous single-letter runs: J J -> JJ, D K R -> DKR, U S A -> USA.
        if len(token) == 1 and token.isalpha():
            j = i
            run = []
            while j < len(raw_tokens) and len(raw_tokens[j]) == 1 and raw_tokens[j].isalpha():
                run.append(raw_tokens[j])
                j += 1
            if len(run) >= 2:
                tokens.append("".join(run))
                i = j
                continue

        tokens.append(_ABBREV_TOKEN_MAP.get(token, token))
        i += 1

    # Normalize common token abbreviations after collapsing single-letter runs.
    tokens = [_ABBREV_TOKEN_MAP.get(t, t) for t in tokens]

    # Ignore leading article for deterministic trade-key identity.
    if tokens and tokens[0] == "THE":
        tokens = tokens[1:]

    return " ".join(tokens).strip()


def trade_key_from_alias(raw_alias: str) -> str:
    return canonicalize_trade_name(extract_trade_name(raw_alias))


def trade_names_equivalent(a: str, b: str) -> bool:
    """Strict equivalence for clustering split candidates."""
    if not a or not b:
        return False
    if a == b:
        return True

    # Allow strict whole-word prefix expansion for multi-token names only.
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    short_tokens = shorter.split()
    if len(short_tokens) >= 2 and longer.startswith(shorter + " "):
        return True

    return False


def build_trade_clusters(trade_to_aliases: Dict[str, List[str]]) -> List[Dict]:
    """Build order-independent connected-component clusters."""
    keys = sorted(trade_to_aliases.keys())
    if len(keys) <= 1:
        if not keys:
            return []
        k = keys[0]
        aliases = sorted(set(trade_to_aliases[k]))
        return [{
            "trade_key": k,
            "trade_name": extract_trade_name(aliases[0]) if aliases else k,
            "keys": [k],
            "aliases": aliases,
        }]

    parent = {k: k for k in keys}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra = find(a)
        rb = find(b)
        if ra == rb:
            return
        # Deterministic root choice.
        if ra < rb:
            parent[rb] = ra
        else:
            parent[ra] = rb

    for i, key_a in enumerate(keys):
        for key_b in keys[i + 1:]:
            if trade_names_equivalent(key_a, key_b):
                union(key_a, key_b)

    grouped = defaultdict(lambda: {"keys": [], "aliases": []})
    for key in keys:
        root = find(key)
        grouped[root]["keys"].append(key)
        grouped[root]["aliases"].extend(trade_to_aliases[key])

    clusters = []
    for data in grouped.values():
        aliases = sorted(set(data["aliases"]))
        grouped_keys = sorted(set(data["keys"]))
        rep_key = min(grouped_keys, key=lambda k: (len(k.split()), len(k), k))
        rep_name = extract_trade_name(aliases[0]) if aliases else rep_key
        clusters.append(
            {
                "trade_key": rep_key,
                "trade_name": rep_name,
                "keys": grouped_keys,
                "aliases": aliases,
            }
        )

    clusters.sort(key=lambda c: (-len(c["aliases"]), c["trade_key"]))
    return clusters


def choose_keep_cluster(clusters: List[Dict], canonical_name: str) -> int:
    """Pick the cluster that best matches canonical name, deterministically."""
    if not clusters:
        return 0

    canonical_key = canonicalize_trade_name(canonical_name)

    scored = []
    for idx, cluster in enumerate(clusters):
        keys = cluster["keys"]
        exact = 1 if canonical_key and canonical_key in keys else 0
        similar = 1 if canonical_key and any(trade_names_equivalent(canonical_key, k) for k in keys) else 0
        count = len(cluster["aliases"])
        scored.append((idx, exact, similar, count))

    best_main = max((x[1], x[2], x[3]) for x in scored)
    candidates = [x[0] for x in scored if (x[1], x[2], x[3]) == best_main]
    return min(candidates, key=lambda i: clusters[i]["trade_key"])


# =============================================================================
# Find over-merged companies
# =============================================================================


def find_overmerged() -> List[Dict]:
    """Find companies where distinct trade-name clusters were merged together."""
    logger.info("Fetching comma-containing aliases...")
    rows = d1_rows(
        "SELECT ca.raw_name, ca.company_id, c.canonical_name "
        "FROM company_aliases ca "
        "JOIN companies c ON ca.company_id = c.id "
        "WHERE ca.raw_name LIKE '%,%'"
    )
    logger.info(f"  Found {len(rows)} comma-containing aliases")

    by_company = defaultdict(list)
    canonical_by_company = {}
    for row in rows:
        cid = row["company_id"]
        by_company[cid].append(row["raw_name"])
        canonical_by_company.setdefault(cid, row.get("canonical_name") or "")

    splits = []

    for cid, aliases in by_company.items():
        trade_to_aliases = defaultdict(list)
        for alias in aliases:
            trade_key = trade_key_from_alias(alias)
            if trade_key:
                trade_to_aliases[trade_key].append(alias)

        if len(trade_to_aliases) <= 1:
            continue

        clusters = build_trade_clusters(trade_to_aliases)
        if len(clusters) <= 1:
            continue

        canonical_name = canonical_by_company.get(cid, "")
        keep_idx = choose_keep_cluster(clusters, canonical_name)

        keep_aliases = clusters[keep_idx]["aliases"]
        split_groups = []
        for idx, cluster in enumerate(clusters):
            if idx == keep_idx:
                continue
            split_groups.append(
                {
                    "trade_name": cluster["trade_name"],
                    "trade_key": cluster["trade_key"],
                    "aliases": cluster["aliases"],
                }
            )

        splits.append(
            {
                "company_id": cid,
                "company_name": canonical_name or "?",
                "keep_aliases": keep_aliases,
                "split_groups": split_groups,
            }
        )

    splits.sort(key=lambda x: x["company_id"])
    logger.info(f"  Found {len(splits)} over-merged companies")
    return splits


# =============================================================================
# Execute splits
# =============================================================================


def execute_splits(splits: List[Dict], dry_run: bool = False) -> None:
    total_new = sum(len(s["split_groups"]) for s in splits)
    total_aliases = sum(sum(len(g["aliases"]) for g in s["split_groups"]) for s in splits)
    logger.info(f"\nWill create {total_new} new companies, move {total_aliases} aliases")

    for s in splits[:20]:
        cid = s["company_id"]
        logger.info(f"\n  Company {cid} ({s['company_name']}):")
        logger.info(f"    KEEP: {len(s['keep_aliases'])} aliases")
        for g in s["split_groups"]:
            logger.info(f"    SPLIT -> '{g['trade_name']}' ({len(g['aliases'])} aliases)")
    if len(splits) > 20:
        logger.info(f"\n  ... and {len(splits) - 20} more")

    if dry_run:
        logger.info("\n[DRY RUN] No changes made.")
        return

    max_row = d1_rows("SELECT MAX(id) as max_id FROM companies")
    next_id = (max_row[0].get("max_id") or 0) + 1 if max_row else 1

    affected_ids = set()
    created = 0
    moved = 0

    for s in splits:
        cid = s["company_id"]
        affected_ids.add(cid)

        for g in s["split_groups"]:
            new_id = next_id
            next_id += 1

            canonical = normalize_company_name(g["trade_name"]) or g["trade_name"]
            match_key = canonicalize_trade_name(canonical)
            slug = make_slug(canonical)

            ins = d1_execute(
                f"INSERT INTO companies "
                f"(id, canonical_name, display_name, slug, match_key, total_filings, variant_count, first_filing, last_filing) "
                f"VALUES ({new_id}, {esc(canonical)}, {esc(canonical)}, {esc(slug)}, {esc(match_key)}, 1, 1, NULL, NULL)"
            )
            if not ins.get("success"):
                logger.error(f"  Failed creating company for '{canonical}'. Skipping this split group.")
                continue

            if d1_changes(ins) > 0:
                created += 1
            g["new_company_id"] = new_id
            affected_ids.add(new_id)

            for i in range(0, len(g["aliases"]), 20):
                chunk = g["aliases"][i : i + 20]
                alias_list = ",".join(esc(a) for a in chunk)
                upd = d1_execute(
                    f"UPDATE company_aliases SET company_id = {new_id} "
                    f"WHERE raw_name IN ({alias_list}) AND company_id = {cid}"
                )
                moved += d1_changes(upd)

        if created > 0 and created % 20 == 0:
            logger.info(f"  Progress: {created} companies created, {moved} aliases moved...")

    logger.info(f"\n  Created {created} new companies")
    logger.info(f"  Moved {moved} aliases")

    logger.info("\n  Moving matching non-comma aliases...")
    nc_moved = 0

    for s in splits:
        cid = s["company_id"]
        groups = [g for g in s["split_groups"] if g.get("new_company_id")]
        if not groups:
            continue

        non_comma_rows = d1_rows(
            f"SELECT raw_name FROM company_aliases "
            f"WHERE company_id = {cid} AND raw_name NOT LIKE '%,%'"
        )
        if not non_comma_rows:
            continue

        for row in non_comma_rows:
            raw = row["raw_name"]
            raw_key = canonicalize_trade_name(raw)
            if not raw_key:
                continue

            exact = [g for g in groups if raw_key == g["trade_key"]]
            if len(exact) == 1:
                target = exact[0]
            elif len(exact) > 1:
                continue
            else:
                prefix = [g for g in groups if trade_names_equivalent(raw_key, g["trade_key"])]
                if len(prefix) != 1:
                    continue
                target = prefix[0]

            new_cid = target["new_company_id"]
            upd = d1_execute(
                f"UPDATE company_aliases SET company_id = {new_cid} "
                f"WHERE raw_name = {esc(raw)} AND company_id = {cid}"
            )
            changes = d1_changes(upd)
            if changes > 0:
                nc_moved += changes
                affected_ids.add(new_cid)

    logger.info(f"  Moved {nc_moved} non-comma aliases")

    if affected_ids:
        logger.info(f"\n  Reclassifying signals for {len(affected_ids)} companies...")
        reclassify(affected_ids)

    orphaned = d1_rows(
        "SELECT COUNT(*) as cnt FROM permits p "
        "LEFT JOIN companies c ON p.company_id = c.id "
        "WHERE p.company_id IS NOT NULL AND c.id IS NULL"
    )
    orphan_count = orphaned[0]["cnt"] if orphaned else 0
    if orphan_count > 0:
        logger.info(f"  Clearing {orphan_count} orphaned permit references...")
        d1_execute(
            "UPDATE permits SET company_id = NULL "
            "WHERE company_id NOT IN (SELECT id FROM companies) AND company_id IS NOT NULL"
        )


# =============================================================================
# Reclassify signals
# =============================================================================


def reclassify(company_ids) -> None:
    total = 0
    company_ids = sorted(company_ids)

    for idx, pid in enumerate(company_ids, 1):
        if idx % 50 == 0:
            logger.info(f"    {idx}/{len(company_ids)}...")

        colas = d1_rows(
            f"SELECT c.ttb_id, c.brand_name, c.fanciful_name, c.signal "
            f"FROM colas c JOIN company_aliases ca ON c.company_name = ca.raw_name "
            f"WHERE ca.company_id = {pid} "
            f"ORDER BY c.year, c.month, c.day, c.ttb_id"
        )
        if not colas:
            continue

        seen_company = False
        seen_brands = set()
        seen_skus = set()
        updates = defaultdict(list)

        for cola in colas:
            brand = (cola.get("brand_name") or "").strip().lower()
            fanciful = (cola.get("fanciful_name") or "").strip().lower()
            old_signal = cola.get("signal")

            if not brand:
                new_signal = "REFILE"
            elif not seen_company:
                new_signal = "NEW_COMPANY"
                seen_company = True
            elif brand not in seen_brands:
                new_signal = "NEW_BRAND"
            elif (brand, fanciful) not in seen_skus:
                new_signal = "NEW_SKU"
            else:
                new_signal = "REFILE"

            seen_brands.add(brand)
            seen_skus.add((brand, fanciful))

            if old_signal != new_signal:
                updates[new_signal].append(cola["ttb_id"])

        changed = sum(len(v) for v in updates.values())
        if changed:
            for signal, ttb_ids in updates.items():
                for i in range(0, len(ttb_ids), 100):
                    chunk = ttb_ids[i : i + 100]
                    id_str = ",".join(f"'{ttb_id}'" for ttb_id in chunk)
                    d1_execute(f"UPDATE colas SET signal = '{signal}' WHERE ttb_id IN ({id_str})")
            total += changed

    logger.info(f"    Reclassified {total} COLAs")


# =============================================================================
# Main
# =============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild company aliases after legal-entity over-merge")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, do not modify D1")
    parser.add_argument(
        "--min-split-groups",
        type=int,
        default=1,
        help="Only process companies with at least this many split groups (default: 1)",
    )
    args = parser.parse_args()

    load_env()
    init_d1()

    splits = find_overmerged()
    if args.min_split_groups > 1:
        splits = [s for s in splits if len(s["split_groups"]) >= args.min_split_groups]
        logger.info(
            f"After --min-split-groups={args.min_split_groups}: {len(splits)} companies remain"
        )
    if not splits:
        logger.info("No over-merged companies found.")
        return

    execute_splits(splits, dry_run=args.dry_run)
    logger.info("\nDone.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.exception(f"Fatal error: {exc}")
        sys.exit(1)
