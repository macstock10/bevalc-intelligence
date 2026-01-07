"""
normalize_companies.py - Entity resolution for company names in TTB COLA database

This script:
1. Fetches all unique company_name values from D1
2. Normalizes strings (case, suffixes, punctuation)
3. Parses compound names (DBA, Legal Entity)
4. Clusters similar names using fuzzy matching
5. Outputs a normalized companies table

USAGE:
    python normalize_companies.py --analyze      # Just analyze, don't write
    python normalize_companies.py --export       # Export to JSON for review
    python normalize_companies.py --apply        # Create tables in D1
"""

import os
import re
import json
import argparse
import logging
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict
from dataclasses import dataclass, field, asdict

import requests

# Try to import rapidfuzz, fall back to basic matching if not available
try:
    from rapidfuzz import fuzz, process
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False
    print("Warning: rapidfuzz not installed. Using basic matching only.")
    print("Install with: pip install rapidfuzz")

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = str(BASE_DIR / ".env")
OUTPUT_DIR = BASE_DIR / "data" / "normalization"
LOG_FILE = str(BASE_DIR / "logs" / "normalize_companies.log")

# Fuzzy matching thresholds
EXACT_MATCH_THRESHOLD = 100
HIGH_CONFIDENCE_THRESHOLD = 95
MEDIUM_CONFIDENCE_THRESHOLD = 85
LOW_CONFIDENCE_THRESHOLD = 75

# Common suffixes to normalize
COMPANY_SUFFIXES = [
    r'\bINC\.?$', r'\bINCORPORATED$', r'\bCORP\.?$', r'\bCORPORATION$',
    r'\bLLC$', r'\bL\.L\.C\.?$', r'\bLTD\.?$', r'\bLIMITED$',
    r'\bCO\.?$', r'\bCOMPANY$', r'\bLP$', r'\bL\.P\.?$',
    r'\bLLP$', r'\bL\.L\.P\.?$', r'\bPLC$', r'\bP\.L\.C\.?$',
    r'\bNA$', r'\bN\.A\.?$', r'\bUSA$', r'\bU\.S\.A\.?$',
]

# Words to remove for matching (but keep in display name)
NOISE_WORDS = [
    r'\bTHE\b', r'\bA\b', r'\bAN\b', r'\bAND\b', r'\b&\b',
    r'\bOF\b', r'\bFOR\b', r'\bIN\b', r'\bON\b', r'\bAT\b',
]

# ============================================================================
# LOGGING
# ============================================================================

def setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
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
# D1 QUERIES
# ============================================================================

def d1_query(sql: str) -> List[Dict]:
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
    return []


def fetch_all_company_names() -> List[Dict]:
    """Fetch all unique company names with filing counts."""
    logger.info("Fetching all unique company names from D1...")

    # Get unique company names with counts
    results = []
    offset = 0
    batch_size = 10000

    while True:
        query = f"""
            SELECT company_name, COUNT(*) as filing_count,
                   MIN(approval_date) as first_filing,
                   MAX(approval_date) as last_filing
            FROM colas
            WHERE company_name IS NOT NULL AND company_name != ''
            GROUP BY company_name
            ORDER BY filing_count DESC
            LIMIT {batch_size} OFFSET {offset}
        """

        batch = d1_query(query)
        if not batch:
            break

        results.extend(batch)
        logger.info(f"  Fetched {len(results)} unique company names...")

        if len(batch) < batch_size:
            break
        offset += batch_size

    logger.info(f"Total unique company names: {len(results)}")
    return results


# ============================================================================
# NORMALIZATION FUNCTIONS
# ============================================================================

def normalize_string(s: str) -> str:
    """Basic string normalization: uppercase, remove extra whitespace."""
    if not s:
        return ""
    # Uppercase
    s = s.upper().strip()
    # Replace multiple spaces with single
    s = re.sub(r'\s+', ' ', s)
    return s


def remove_suffixes(s: str) -> str:
    """Remove common company suffixes for matching."""
    for suffix in COMPANY_SUFFIXES:
        s = re.sub(suffix, '', s, flags=re.IGNORECASE).strip()
    # Remove trailing punctuation
    s = re.sub(r'[,.\s]+$', '', s)
    return s


def remove_noise_words(s: str) -> str:
    """Remove noise words for matching."""
    for word in NOISE_WORDS:
        s = re.sub(word, ' ', s, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', s).strip()


def extract_legal_entity(company_name: str) -> Tuple[str, str]:
    """
    Extract legal entity from compound name.

    "DON JULIO TEQUILA COMPANY, DIAGEO AMERICAS SUPPLY, INC."
        -> ("DON JULIO TEQUILA COMPANY", "DIAGEO AMERICAS SUPPLY, INC.")
    "DIAGEO AMERICAS SUPPLY, INC." -> ("", "DIAGEO AMERICAS SUPPLY, INC.")
    "SIMPLE NAME" -> ("", "SIMPLE NAME")

    Returns: (dba_name, legal_entity)
    """
    if not company_name:
        return ("", "")

    if ',' not in company_name:
        return ("", company_name)

    # Find all comma positions
    comma_positions = [i for i, c in enumerate(company_name) if c == ',']

    # Suffix patterns that indicate "this is part of the company name, not a split point"
    suffix_only_patterns = [
        r'^INC\.?$', r'^LLC\.?$', r'^LTD\.?$', r'^CORP\.?$',
        r'^L\.?L\.?C\.?$', r'^L\.?P\.?$', r'^L\.?L\.?P\.?$',
        r'^INCORPORATED$', r'^LIMITED$', r'^CORPORATION$',
    ]

    # Try each comma from LEFT to RIGHT, looking for a valid split
    # The first comma that produces a valid legal entity is the split point
    for pos in comma_positions:
        dba = company_name[:pos].strip()
        legal = company_name[pos+1:].strip()
        legal_upper = legal.upper()

        # Skip if right side is only a suffix
        is_suffix_only = any(re.match(p, legal_upper) for p in suffix_only_patterns)
        if is_suffix_only:
            continue

        # Check if right side looks like a real legal entity
        has_suffix = any(re.search(suffix, legal_upper) for suffix in COMPANY_SUFFIXES)
        word_count = len(legal.split())

        # Valid compound: "DBA, PARENT COMPANY LLC" or "DBA, PARENT COMPANY, INC."
        if has_suffix and word_count >= 2:
            return (dba, legal)

        # Also valid: substantial name without suffix (at least 3 words)
        if word_count >= 3:
            return (dba, legal)

    # No valid split found
    return ("", company_name)


def create_match_key(s: str) -> str:
    """Create a simplified key for matching."""
    s = normalize_string(s)
    s = remove_suffixes(s)
    s = remove_noise_words(s)
    # Remove all punctuation
    s = re.sub(r'[^\w\s]', '', s)
    # Remove extra whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# ============================================================================
# COMPANY DATA CLASS
# ============================================================================

@dataclass
class NormalizedCompany:
    """Represents a normalized company entity."""
    id: int
    canonical_name: str
    display_name: str
    match_key: str
    variants: List[str] = field(default_factory=list)
    variant_count: int = 0
    total_filings: int = 0
    first_filing: str = ""
    last_filing: str = ""
    confidence: str = "high"  # high, medium, low

    def add_variant(self, raw_name: str, filing_count: int, first: str, last: str):
        if raw_name not in self.variants:
            self.variants.append(raw_name)
        self.variant_count = len(self.variants)
        self.total_filings += filing_count

        # Update date range
        if not self.first_filing or (first and first < self.first_filing):
            self.first_filing = first
        if not self.last_filing or (last and last > self.last_filing):
            self.last_filing = last


# ============================================================================
# CLUSTERING ENGINE
# ============================================================================

class CompanyNormalizer:
    """Main normalization engine."""

    def __init__(self):
        self.companies: Dict[int, NormalizedCompany] = {}
        self.match_key_to_id: Dict[str, int] = {}
        self.raw_to_id: Dict[str, int] = {}
        self.next_id = 1

    def process_raw_names(self, raw_data: List[Dict]) -> None:
        """Process all raw company names."""
        logger.info(f"Processing {len(raw_data)} unique company names...")

        # First pass: exact match key grouping
        key_groups: Dict[str, List[Dict]] = defaultdict(list)

        for row in raw_data:
            raw_name = row["company_name"]
            dba, legal = extract_legal_entity(raw_name)

            # Use legal entity for matching if available
            match_source = legal if legal else raw_name
            match_key = create_match_key(match_source)

            if match_key:
                key_groups[match_key].append({
                    "raw_name": raw_name,
                    "dba": dba,
                    "legal": legal,
                    "match_key": match_key,
                    "filing_count": row["filing_count"],
                    "first_filing": row.get("first_filing", ""),
                    "last_filing": row.get("last_filing", ""),
                })

        logger.info(f"Exact key grouping: {len(raw_data)} -> {len(key_groups)} groups")

        # Create companies from exact matches
        for match_key, group in key_groups.items():
            # Pick best display name (most filings or shortest)
            group.sort(key=lambda x: (-x["filing_count"], len(x["raw_name"])))
            best = group[0]

            # Prefer legal entity as canonical name
            canonical = best["legal"] if best["legal"] else best["raw_name"]
            canonical = normalize_string(canonical)

            company = NormalizedCompany(
                id=self.next_id,
                canonical_name=canonical,
                display_name=canonical.title(),  # Title case for display
                match_key=match_key,
                confidence="high" if len(group) == 1 else "high",
            )

            for item in group:
                company.add_variant(
                    item["raw_name"],
                    item["filing_count"],
                    item["first_filing"],
                    item["last_filing"]
                )
                self.raw_to_id[item["raw_name"]] = self.next_id

            self.companies[self.next_id] = company
            self.match_key_to_id[match_key] = self.next_id
            self.next_id += 1

        logger.info(f"Created {len(self.companies)} initial company entities")

        # Second pass: fuzzy matching to merge similar entities
        if HAS_RAPIDFUZZ:
            self._fuzzy_merge()

    def _fuzzy_merge(self) -> None:
        """Merge similar companies using fuzzy matching."""
        logger.info("Running fuzzy matching to merge similar entities...")

        # Get all match keys
        keys = list(self.match_key_to_id.keys())
        merged_count = 0

        # Sort by length (process shorter keys first - they're usually the canonical ones)
        keys.sort(key=len)

        # Track which companies have been merged away
        merged_into: Dict[int, int] = {}

        for i, key1 in enumerate(keys):
            if i % 1000 == 0 and i > 0:
                logger.info(f"  Processed {i}/{len(keys)} keys, {merged_count} merges...")

            id1 = self.match_key_to_id[key1]

            # Skip if already merged
            if id1 in merged_into:
                continue

            # Find similar keys
            # Only compare with remaining unprocessed keys for efficiency
            remaining_keys = keys[i+1:]
            if not remaining_keys:
                continue

            # Use rapidfuzz to find matches
            matches = process.extract(
                key1,
                remaining_keys,
                scorer=fuzz.ratio,
                score_cutoff=HIGH_CONFIDENCE_THRESHOLD,
                limit=50
            )

            for match_key2, score, _ in matches:
                id2 = self.match_key_to_id[match_key2]

                # Skip if same company or already merged
                if id2 == id1 or id2 in merged_into:
                    continue

                # Get final destination (follow merge chain)
                while id1 in merged_into:
                    id1 = merged_into[id1]

                # Merge id2 into id1
                company1 = self.companies[id1]
                company2 = self.companies[id2]

                # Transfer variants
                for variant in company2.variants:
                    company1.add_variant(
                        variant,
                        0,  # Count already added
                        company2.first_filing,
                        company2.last_filing
                    )
                    self.raw_to_id[variant] = id1

                # Update total filings
                company1.total_filings += company2.total_filings

                # Mark as merged
                merged_into[id2] = id1
                merged_count += 1

                # Update confidence based on match score
                if score < EXACT_MATCH_THRESHOLD:
                    company1.confidence = "medium" if score >= MEDIUM_CONFIDENCE_THRESHOLD else "low"

        # Remove merged companies
        for merged_id in merged_into:
            del self.companies[merged_id]

        logger.info(f"Fuzzy matching complete: merged {merged_count} entities")
        logger.info(f"Final company count: {len(self.companies)}")

    def get_stats(self) -> Dict:
        """Get normalization statistics."""
        companies = list(self.companies.values())

        multi_variant = [c for c in companies if c.variant_count > 1]

        return {
            "total_companies": len(companies),
            "companies_with_variants": len(multi_variant),
            "total_variants": sum(c.variant_count for c in companies),
            "total_filings": sum(c.total_filings for c in companies),
            "high_confidence": len([c for c in companies if c.confidence == "high"]),
            "medium_confidence": len([c for c in companies if c.confidence == "medium"]),
            "low_confidence": len([c for c in companies if c.confidence == "low"]),
            "top_by_variants": sorted(
                [(c.canonical_name, c.variant_count, c.total_filings) for c in multi_variant],
                key=lambda x: -x[1]
            )[:20],
            "top_by_filings": sorted(
                [(c.canonical_name, c.total_filings, c.variant_count) for c in companies],
                key=lambda x: -x[1]
            )[:20],
        }

    def export_to_json(self, output_path: Path) -> None:
        """Export normalized companies to JSON."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "companies": [asdict(c) for c in self.companies.values()],
            "raw_to_company_id": self.raw_to_id,
            "stats": self.get_stats(),
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        logger.info(f"Exported to {output_path}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Normalize company names')
    parser.add_argument('--analyze', action='store_true', help='Analyze only, show stats')
    parser.add_argument('--export', action='store_true', help='Export to JSON')
    parser.add_argument('--apply', action='store_true', help='Apply to D1 database')

    args = parser.parse_args()

    if not any([args.analyze, args.export, args.apply]):
        args.analyze = True  # Default to analyze

    logger.info("=" * 60)
    logger.info("COMPANY NAME NORMALIZATION")
    logger.info("=" * 60)

    # Fetch data
    raw_data = fetch_all_company_names()

    if not raw_data:
        logger.error("No data fetched from D1")
        return

    # Process
    normalizer = CompanyNormalizer()
    normalizer.process_raw_names(raw_data)

    # Get stats
    stats = normalizer.get_stats()

    logger.info("\n" + "=" * 60)
    logger.info("RESULTS")
    logger.info("=" * 60)
    logger.info(f"Input: {len(raw_data)} unique company_name values")
    logger.info(f"Output: {stats['total_companies']} normalized companies")
    logger.info(f"Reduction: {len(raw_data) - stats['total_companies']} duplicates resolved")
    logger.info(f"Companies with multiple variants: {stats['companies_with_variants']}")
    logger.info(f"Confidence: {stats['high_confidence']} high, {stats['medium_confidence']} medium, {stats['low_confidence']} low")

    logger.info("\nTop companies by variant count:")
    for name, variants, filings in stats['top_by_variants'][:10]:
        logger.info(f"  {variants:>3} variants | {filings:>6} filings | {name[:50]}")

    logger.info("\nTop companies by filing count:")
    for name, filings, variants in stats['top_by_filings'][:10]:
        logger.info(f"  {filings:>6} filings | {variants:>3} variants | {name[:50]}")

    if args.export:
        output_path = OUTPUT_DIR / "normalized_companies.json"
        normalizer.export_to_json(output_path)

    if args.apply:
        apply_to_d1(normalizer)


def apply_to_d1(normalizer: CompanyNormalizer) -> None:
    """Create tables and populate with normalized data."""
    logger.info("\n" + "=" * 60)
    logger.info("APPLYING TO D1")
    logger.info("=" * 60)

    # Drop existing tables (they have old schema)
    logger.info("Dropping old tables...")
    try:
        d1_query("DROP TABLE IF EXISTS company_aliases")
        d1_query("DROP TABLE IF EXISTS companies")
    except Exception as e:
        logger.warning(f"  Could not drop tables: {e}")
    logger.info("  Dropped old tables")

    # Create companies table
    logger.info("Creating companies table...")
    create_companies_sql = """
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY,
            canonical_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            match_key TEXT NOT NULL,
            total_filings INTEGER DEFAULT 0,
            variant_count INTEGER DEFAULT 0,
            first_filing TEXT,
            last_filing TEXT,
            confidence TEXT DEFAULT 'high',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """
    d1_query(create_companies_sql)
    logger.info("  Created companies table")

    # Create company_aliases table
    logger.info("Creating company_aliases table...")
    create_aliases_sql = """
        CREATE TABLE company_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_name TEXT NOT NULL UNIQUE,
            company_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        )
    """
    d1_query(create_aliases_sql)
    logger.info("  Created company_aliases table")

    # Create indexes
    logger.info("Creating indexes...")
    indexes = [
        "CREATE INDEX idx_companies_match_key ON companies(match_key)",
        "CREATE INDEX idx_companies_canonical ON companies(canonical_name)",
        "CREATE INDEX idx_aliases_company_id ON company_aliases(company_id)",
        "CREATE INDEX idx_aliases_raw_name ON company_aliases(raw_name)",
    ]
    for idx_sql in indexes:
        d1_query(idx_sql)
    logger.info("  Created indexes")

    # Insert companies in batches
    companies = list(normalizer.companies.values())
    logger.info(f"Inserting {len(companies)} companies...")

    batch_size = 100
    for i in range(0, len(companies), batch_size):
        batch = companies[i:i + batch_size]
        values = []
        for c in batch:
            # Escape single quotes
            canonical = c.canonical_name.replace("'", "''")
            display = c.display_name.replace("'", "''")
            match_key = c.match_key.replace("'", "''")
            first = (c.first_filing or "").replace("'", "''")
            last = (c.last_filing or "").replace("'", "''")

            values.append(
                f"({c.id}, '{canonical}', '{display}', '{match_key}', "
                f"{c.total_filings}, {c.variant_count}, '{first}', '{last}', '{c.confidence}')"
            )

        sql = f"""
            INSERT INTO companies
            (id, canonical_name, display_name, match_key, total_filings, variant_count, first_filing, last_filing, confidence)
            VALUES {', '.join(values)}
        """
        d1_query(sql)

        if (i + batch_size) % 1000 == 0 or i + batch_size >= len(companies):
            logger.info(f"  Inserted {min(i + batch_size, len(companies))}/{len(companies)} companies")

    # Insert aliases in batches
    aliases = list(normalizer.raw_to_id.items())
    logger.info(f"Inserting {len(aliases)} aliases...")

    for i in range(0, len(aliases), batch_size):
        batch = aliases[i:i + batch_size]
        values = []
        for raw_name, company_id in batch:
            raw_escaped = raw_name.replace("'", "''")
            values.append(f"('{raw_escaped}', {company_id})")

        sql = f"""
            INSERT INTO company_aliases (raw_name, company_id)
            VALUES {', '.join(values)}
        """
        d1_query(sql)

        if (i + batch_size) % 5000 == 0 or i + batch_size >= len(aliases):
            logger.info(f"  Inserted {min(i + batch_size, len(aliases))}/{len(aliases)} aliases")

    logger.info("D1 tables populated successfully!")

    # Verify
    count_companies = d1_query("SELECT COUNT(*) as cnt FROM companies")
    count_aliases = d1_query("SELECT COUNT(*) as cnt FROM company_aliases")
    logger.info(f"Verification: {count_companies[0]['cnt']} companies, {count_aliases[0]['cnt']} aliases")


if __name__ == '__main__':
    main()
