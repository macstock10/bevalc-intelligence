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
                   ' CORP', ' CORP.', ' CO', ' CO.', ' COMPANY']:
        if s.endswith(suffix):
            s = s[:-len(suffix)].strip()
    # Remove punctuation
    s = ''.join(c for c in s if c.isalnum() or c == ' ')
    s = ' '.join(s.split())
    return s


def load_company_lookup() -> Dict[str, int]:
    """Load normalized company names to company_id mapping from D1."""
    logger.info("Loading company lookup from D1...")

    lookup = {}
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
                lookup[norm] = row['company_id']

        offset += batch_size
        if len(results) < batch_size:
            break

    logger.info(f"Loaded {len(lookup):,} company name mappings")
    return lookup


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

def create_permits_table():
    """Create the permits table if it doesn't exist."""
    logger.info("Creating permits table...")

    # Drop and recreate for clean state
    d1_query("DROP TABLE IF EXISTS permits")

    create_sql = """
        CREATE TABLE permits (
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

    # Create indexes
    indexes = [
        "CREATE INDEX idx_permits_company_id ON permits(company_id)",
        "CREATE INDEX idx_permits_industry_type ON permits(industry_type)",
        "CREATE INDEX idx_permits_state ON permits(state)",
        "CREATE INDEX idx_permits_owner_name ON permits(owner_name)",
    ]
    for idx_sql in indexes:
        d1_query(idx_sql)

    logger.info("Permits table created with indexes")


# ============================================================================
# SYNC LOGIC
# ============================================================================

def sync_permits(permits: List[Dict], company_lookup: Dict[str, int], dry_run: bool = False):
    """Sync permits to D1."""
    logger.info(f"Syncing {len(permits):,} permits to D1...")

    now = datetime.now(timezone.utc).isoformat()
    matched = 0
    unmatched = 0

    # Match permits to companies
    for permit in permits:
        norm = normalize_name(permit['owner_name'])
        company_id = company_lookup.get(norm)
        permit['company_id'] = company_id
        permit['first_seen_at'] = now
        permit['updated_at'] = now

        if company_id:
            matched += 1
        else:
            unmatched += 1

    logger.info(f"Matched {matched:,} permits to existing companies")
    logger.info(f"Unmatched: {unmatched:,} (new leads)")

    if dry_run:
        logger.info("DRY RUN - skipping database insert")
        return

    # Create fresh table
    create_permits_table()

    # Insert in batches
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

    # Load company lookup
    company_lookup = load_company_lookup()

    # Sync to D1
    sync_permits(permits, company_lookup, dry_run=args.dry_run)

    # Show stats
    if not args.dry_run:
        show_stats()


if __name__ == '__main__':
    main()
