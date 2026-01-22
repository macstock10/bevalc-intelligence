"""
sync_permits.py - Sync TTB permits data to D1

Downloads the weekly TTB permits JSON and syncs to D1 database.
Matches permits to existing normalized companies.

USAGE:
    python sync_permits.py              # Full sync
    python sync_permits.py --dry-run    # Preview only
    python sync_permits.py --stats      # Show current stats

DATA SOURCE:
    https://www.ttb.gov/public-information/foia/list-of-permittees
    Updated weekly by TTB (usually Mondays)
"""

import os
import re
import json
import argparse
import logging
import requests
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from collections import Counter
from difflib import SequenceMatcher

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = str(BASE_DIR / ".env")
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"
LOG_FILE = str(LOG_DIR / "sync_permits.log")

# TTB Permits JSON URL (updated weekly)
TTB_PERMITS_URL = "https://www.ttb.gov/system/files/2025-04/FRL_All_Permits.json"

# Permit types we care about (exclude wholesalers for lead gen)
RELEVANT_PERMIT_TYPES = [
    "Importer (Alcohol)",
    "Wine Producer",
    "Distilled Spirits Plant"
]

# ============================================================================
# LOGGING
# ============================================================================

def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

logger = setup_logging()

# ============================================================================
# ENVIRONMENT
# ============================================================================

def load_env():
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")

load_env()

CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

D1_API_URL = None
if CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID:
    D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"

# ============================================================================
# D1 OPERATIONS
# ============================================================================

def d1_query(sql: str) -> List[Dict]:
    """Execute a query against D1."""
    if not D1_API_URL:
        raise RuntimeError("D1 API URL not configured")

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    response = requests.post(D1_API_URL, headers=headers, json={"sql": sql})

    if response.status_code != 200:
        raise RuntimeError(f"D1 API error: {response.status_code} - {response.text}")

    data = response.json()
    if data.get("success") and data.get("result"):
        return data["result"][0].get("results", [])

    # Check for errors
    if not data.get("success"):
        errors = data.get("errors", [])
        if errors:
            raise RuntimeError(f"D1 query error: {errors}")

    return []


def escape_sql(value: str) -> str:
    """Escape a string for SQL."""
    if value is None:
        return ""
    return str(value).replace("'", "''")


# ============================================================================
# COMPANY MATCHING
# ============================================================================

def normalize_name(s: str) -> str:
    """Normalize company name for matching."""
    if not s:
        return ""
    s = s.upper().strip()
    # Remove common suffixes
    for suffix in [' INC', ' INC.', ' LLC', ' L.L.C.', ' LTD', ' LTD.',
                   ' CORP', ' CORP.', ' CO', ' CO.', ' COMPANY', ' LP', ' L.P.',
                   ' CORPORATION', ' INCORPORATED', ' LIMITED']:
        if s.endswith(suffix):
            s = s[:-len(suffix)].strip()
    # Remove punctuation
    s = ''.join(c for c in s if c.isalnum() or c == ' ')
    s = ' '.join(s.split())
    return s


def make_match_key(s: str) -> str:
    """Create aggressive match key - removes common words."""
    if not s:
        return ""
    s = normalize_name(s)
    # Remove common words that vary between filings
    for word in ['THE', 'AND', 'OF', 'WINE', 'WINES', 'WINERY', 'VINEYARD',
                 'VINEYARDS', 'CELLARS', 'ESTATES', 'ESTATE', 'DISTILLERY',
                 'DISTILLING', 'BREWING', 'BREWERY', 'IMPORTS', 'IMPORT',
                 'INTERNATIONAL', 'INTL', 'USA', 'US', 'AMERICA', 'AMERICAN',
                 'GROUP', 'HOLDINGS', 'ENTERPRISES']:
        s = ' '.join(w for w in s.split() if w != word)
    return ' '.join(s.split())


def fuzzy_match(name: str, candidates: Dict[str, int], threshold: float = 0.92) -> Optional[int]:
    """Find best fuzzy match above threshold. Returns company_id or None."""
    if not name or not candidates:
        return None

    best_ratio = 0
    best_id = None

    for candidate, company_id in candidates.items():
        ratio = SequenceMatcher(None, name, candidate).ratio()
        if ratio > best_ratio and ratio >= threshold:
            best_ratio = ratio
            best_id = company_id

    return best_id


def load_company_lookup() -> Tuple[Dict[str, int], Dict[str, int]]:
    """Load normalized company names and match keys to company_id mapping from D1."""
    logger.info("Loading company lookup from D1...")

    # Lookup by normalized name
    name_lookup = {}
    # Lookup by match_key (more aggressive normalization)
    key_lookup = {}

    offset = 0
    batch_size = 10000

    while True:
        results = d1_query(f"""
            SELECT raw_name, company_id
            FROM company_aliases
            LIMIT {batch_size} OFFSET {offset}
        """)

        if not results:
            break

        for row in results:
            norm = normalize_name(row['raw_name'])
            if norm:
                name_lookup[norm] = row['company_id']

            key = make_match_key(row['raw_name'])
            if key:
                key_lookup[key] = row['company_id']

        offset += batch_size
        if len(results) < batch_size:
            break

    logger.info(f"Loaded {len(name_lookup):,} company name mappings")
    logger.info(f"Loaded {len(key_lookup):,} match key mappings")
    return name_lookup, key_lookup


# ============================================================================
# PERMITS DOWNLOAD
# ============================================================================

def download_permits() -> List[Dict]:
    """Download TTB permits JSON."""
    logger.info(f"Downloading permits from {TTB_PERMITS_URL}...")

    response = requests.get(TTB_PERMITS_URL)
    response.raise_for_status()

    data = response.json()
    permits_raw = data.get("Permit Data", [])

    # Parse into dicts
    permits = []
    for p in permits_raw:
        permits.append({
            'permit_number': p[0],
            'owner_name': p[1],
            'operating_name': p[2] or '',
            'street': p[3] or '',
            'city': p[4] or '',
            'state': p[5] or '',
            'zip': p[6] or '',
            'county': p[7] or '',
            'industry_type': p[8],
            'is_new': 1 if p[9] == 1 else 0
        })

    logger.info(f"Downloaded {len(permits):,} permits")

    # Log breakdown by type
    types = Counter(p['industry_type'] for p in permits)
    for t, count in types.most_common():
        logger.info(f"  {t}: {count:,}")

    return permits


def save_permits_json(permits: List[Dict]):
    """Save permits to local JSON for reference."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "ttb_permits_latest.json"

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'downloaded_at': datetime.now(timezone.utc).isoformat(),
            'total_permits': len(permits),
            'permits': permits
        }, f, indent=2)

    logger.info(f"Saved permits to {output_path}")


# ============================================================================
# DATABASE SCHEMA
# ============================================================================

def ensure_permits_table():
    """Create the permits table if it doesn't exist (preserves existing data)."""
    logger.info("Ensuring permits table exists...")

    create_sql = """
        CREATE TABLE IF NOT EXISTS permits (
            permit_number TEXT PRIMARY KEY,
            owner_name TEXT NOT NULL,
            operating_name TEXT,
            street TEXT,
            city TEXT,
            state TEXT,
            zip TEXT,
            county TEXT,
            industry_type TEXT,
            is_new INTEGER DEFAULT 0,
            company_id INTEGER,
            first_seen_at TEXT,
            updated_at TEXT
        )
    """
    d1_query(create_sql)

    # Create indexes if they don't exist
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_permits_company_id ON permits(company_id)",
        "CREATE INDEX IF NOT EXISTS idx_permits_industry_type ON permits(industry_type)",
        "CREATE INDEX IF NOT EXISTS idx_permits_state ON permits(state)",
        "CREATE INDEX IF NOT EXISTS idx_permits_owner_name ON permits(owner_name)",
        "CREATE INDEX IF NOT EXISTS idx_permits_is_new ON permits(is_new)",
    ]
    for idx_sql in indexes:
        try:
            d1_query(idx_sql)
        except Exception as e:
            pass  # Index may already exist

    logger.info("Permits table ready")


# ============================================================================
# SYNC LOGIC
# ============================================================================

def load_existing_first_seen() -> Dict[str, str]:
    """Load existing permit first_seen_at values from D1."""
    logger.info("Loading existing permit timestamps...")
    existing = {}

    offset = 0
    batch_size = 10000

    while True:
        try:
            results = d1_query(f"""
                SELECT permit_number, first_seen_at
                FROM permits
                WHERE first_seen_at IS NOT NULL
                LIMIT {batch_size} OFFSET {offset}
            """)

            if not results:
                break

            for row in results:
                existing[row['permit_number']] = row['first_seen_at']

            offset += batch_size
            if len(results) < batch_size:
                break
        except Exception as e:
            # Table might not exist yet
            logger.info(f"Could not load existing timestamps: {e}")
            break

    logger.info(f"Loaded {len(existing):,} existing permit timestamps")
    return existing


def sync_permits(permits: List[Dict], name_lookup: Dict[str, int], key_lookup: Dict[str, int], dry_run: bool = False):
    """Sync permits to D1 with improved matching. Preserves first_seen_at for existing permits."""
    logger.info(f"Syncing {len(permits):,} permits to D1...")

    now = datetime.now(timezone.utc).isoformat()
    exact_match = 0
    key_match = 0
    fuzzy_match_count = 0
    unmatched = 0

    # Load existing first_seen_at timestamps BEFORE we modify the table
    existing_timestamps = load_existing_first_seen()

    # Match permits to companies using tiered approach
    for permit in permits:
        company_id = None
        norm = normalize_name(permit['owner_name'])

        # Tier 1: Exact normalized name match
        if norm:
            company_id = name_lookup.get(norm)

        # Tier 2: Match key (more aggressive normalization)
        if not company_id:
            key = make_match_key(permit['owner_name'])
            if key:
                company_id = key_lookup.get(key)
                if company_id:
                    key_match += 1

        # Tier 3: Fuzzy match DISABLED - too slow for 82K permits
        # If needed, run as separate batch job
        # if not company_id and norm and len(norm) > 5:
        #     company_id = fuzzy_match(norm, name_lookup, threshold=0.92)
        #     if company_id:
        #         fuzzy_match_count += 1

        permit['company_id'] = company_id
        permit['updated_at'] = now

        # Preserve first_seen_at for existing permits, set to now for new ones
        permit['first_seen_at'] = existing_timestamps.get(permit['permit_number'], now)

        if company_id:
            if not key_match and not fuzzy_match_count:
                exact_match += 1
        else:
            unmatched += 1

    total_matched = exact_match + key_match + fuzzy_match_count
    new_permits = len(permits) - len(existing_timestamps)
    logger.info(f"Matched {total_matched:,} permits to existing companies")
    logger.info(f"  - Exact match: {exact_match:,}")
    logger.info(f"  - Key match: {key_match:,}")
    logger.info(f"  - Fuzzy match: {fuzzy_match_count:,}")
    logger.info(f"Unmatched: {unmatched:,}")
    logger.info(f"New permits (first time seen): {max(0, new_permits):,}")

    if dry_run:
        logger.info("DRY RUN - skipping database insert")
        return

    # Drop and recreate table for fast batch insert (we've preserved first_seen_at in memory)
    logger.info("Recreating permits table for fast batch insert...")
    d1_query("DROP TABLE IF EXISTS permits")
    ensure_permits_table()

    # Batch insert (much faster than individual UPSERTs)
    batch_size = 100
    for i in range(0, len(permits), batch_size):
        batch = permits[i:i + batch_size]
        values = []

        for p in batch:
            company_id_str = str(p['company_id']) if p['company_id'] else 'NULL'
            values.append(f"""(
                '{escape_sql(p['permit_number'])}',
                '{escape_sql(p['owner_name'])}',
                '{escape_sql(p['operating_name'])}',
                '{escape_sql(p['street'])}',
                '{escape_sql(p['city'])}',
                '{escape_sql(p['state'])}',
                '{escape_sql(p['zip'])}',
                '{escape_sql(p['county'])}',
                '{escape_sql(p['industry_type'])}',
                {p['is_new']},
                {company_id_str},
                '{p['first_seen_at']}',
                '{p['updated_at']}'
            )""")

        sql = f"""
            INSERT INTO permits
            (permit_number, owner_name, operating_name, street, city, state, zip,
             county, industry_type, is_new, company_id, first_seen_at, updated_at)
            VALUES {', '.join(values)}
        """
        d1_query(sql)

        if (i + batch_size) % 5000 == 0 or i + batch_size >= len(permits):
            logger.info(f"  Inserted {min(i + batch_size, len(permits)):,}/{len(permits):,} permits")

    logger.info("Permit sync complete!")


# ============================================================================
# STATS
# ============================================================================

def show_stats():
    """Show current permit stats."""
    logger.info("=" * 60)
    logger.info("PERMIT STATISTICS")
    logger.info("=" * 60)

    # Total permits
    total = d1_query("SELECT COUNT(*) as cnt FROM permits")
    print(f"\nTotal permits: {total[0]['cnt']:,}")

    # By type
    by_type = d1_query("""
        SELECT industry_type, COUNT(*) as cnt
        FROM permits
        GROUP BY industry_type
        ORDER BY cnt DESC
    """)
    print("\nBy industry type:")
    for row in by_type:
        print(f"  {row['industry_type']}: {row['cnt']:,}")

    # Matched vs unmatched
    matched = d1_query("SELECT COUNT(*) as cnt FROM permits WHERE company_id IS NOT NULL")
    unmatched = d1_query("SELECT COUNT(*) as cnt FROM permits WHERE company_id IS NULL")
    print(f"\nMatched to COLA companies: {matched[0]['cnt']:,}")
    print(f"Unmatched (potential leads): {unmatched[0]['cnt']:,}")

    # Unmatched by type (excluding wholesalers)
    leads = d1_query("""
        SELECT industry_type, COUNT(*) as cnt
        FROM permits
        WHERE company_id IS NULL
          AND industry_type != 'Wholesaler (Alcohol)'
        GROUP BY industry_type
        ORDER BY cnt DESC
    """)
    print("\nPotential leads by type (no COLA filings):")
    for row in leads:
        print(f"  {row['industry_type']}: {row['cnt']:,}")

    # New permits this week
    new_permits = d1_query("SELECT COUNT(*) as cnt FROM permits WHERE is_new = 1")
    print(f"\nNewly issued permits (last 7 days): {new_permits[0]['cnt']:,}")

    # Top states
    by_state = d1_query("""
        SELECT state, COUNT(*) as cnt
        FROM permits
        WHERE company_id IS NULL
          AND industry_type != 'Wholesaler (Alcohol)'
        GROUP BY state
        ORDER BY cnt DESC
        LIMIT 10
    """)
    print("\nTop states for potential leads:")
    for row in by_state:
        print(f"  {row['state']}: {row['cnt']:,}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Sync TTB permits to D1')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, no database changes')
    parser.add_argument('--stats', action='store_true', help='Show current statistics')

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("TTB PERMITS SYNC")
    logger.info("=" * 60)

    if args.stats:
        show_stats()
        return

    # Download permits
    permits = download_permits()
    save_permits_json(permits)

    # Load company lookup (returns name_lookup, key_lookup)
    name_lookup, key_lookup = load_company_lookup()

    # Sync to D1 with improved matching
    sync_permits(permits, name_lookup, key_lookup, dry_run=args.dry_run)

    # Show stats
    if not args.dry_run:
        show_stats()


if __name__ == '__main__':
    main()
