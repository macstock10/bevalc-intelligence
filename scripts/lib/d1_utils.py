"""
d1_utils.py - Shared Cloudflare D1 utilities

This module provides common D1 database operations used by both daily_sync.py
and weekly_update.py scripts.

Functions:
- d1_execute: Execute SQL against D1 API
- escape_sql_value: Safely escape values for inline SQL
- d1_insert_batch: Batch insert COLA records
- make_slug: Convert text to URL slug
- update_brand_slugs: Add new brands to brand_slugs table
- add_new_companies: Add new companies to companies/company_aliases tables
- get_company_id: Lookup company_id from company_aliases
"""

import os
import re
import logging
from typing import List, Dict, Any, Optional

import requests

# =============================================================================
# CONFIGURATION (set by calling script via init_d1_config)
# =============================================================================

_config = {
    'account_id': None,
    'database_id': None,
    'api_token': None,
    'api_url': None,
    'batch_size': 500,
    'logger': None
}


def init_d1_config(
    account_id: str = None,
    database_id: str = None,
    api_token: str = None,
    batch_size: int = 500,
    logger: logging.Logger = None
):
    """
    Initialize D1 configuration. Must be called before using other functions.

    Can pass values directly or will read from environment variables:
    - CLOUDFLARE_ACCOUNT_ID
    - CLOUDFLARE_D1_DATABASE_ID
    - CLOUDFLARE_API_TOKEN
    """
    _config['account_id'] = account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    _config['database_id'] = database_id or os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
    _config['api_token'] = api_token or os.environ.get("CLOUDFLARE_API_TOKEN")
    _config['batch_size'] = batch_size
    _config['logger'] = logger or logging.getLogger(__name__)

    if _config['account_id'] and _config['database_id']:
        _config['api_url'] = (
            f"https://api.cloudflare.com/client/v4/accounts/{_config['account_id']}"
            f"/d1/database/{_config['database_id']}/query"
        )
    else:
        _config['api_url'] = None


def _get_logger():
    """Get configured logger or default."""
    return _config['logger'] or logging.getLogger(__name__)


# =============================================================================
# D1 API FUNCTIONS
# =============================================================================

def d1_execute(sql: str, params: List[Any] = None) -> Dict:
    """
    Execute a SQL query against Cloudflare D1.

    Args:
        sql: SQL query string
        params: Optional list of parameters for parameterized queries

    Returns:
        Dict with 'success' key and either 'result' or 'error'
    """
    logger = _get_logger()

    if not _config['api_url']:
        logger.error("D1 not configured. Call init_d1_config() first.")
        return {"success": False, "error": "D1 not configured"}

    headers = {
        "Authorization": f"Bearer {_config['api_token']}",
        "Content-Type": "application/json"
    }

    payload = {"sql": sql}
    if params:
        payload["params"] = params

    response = requests.post(_config['api_url'], headers=headers, json=payload)

    if response.status_code != 200:
        logger.error(f"D1 API error: {response.status_code} - {response.text}")
        return {"success": False, "error": response.text}

    result = response.json()

    if result.get("errors"):
        logger.error(f"D1 errors: {result['errors']}")

    return result


def escape_sql_value(value) -> str:
    """
    Escape a value for inline SQL.

    Handles None, numbers, and strings. Escapes special characters
    and removes control characters to prevent SQL injection.

    Args:
        value: Any value to escape

    Returns:
        SQL-safe string representation
    """
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)

    # Convert to string and escape special characters
    s = str(value)
    # Replace newlines, carriage returns, tabs with spaces
    s = s.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
    # Escape single quotes by doubling them
    s = s.replace("'", "''")
    # Remove any other control characters
    s = ''.join(c if ord(c) >= 32 or c in ' ' else ' ' for c in s)
    return f"'{s}'"


def classify_category(class_type_code: str) -> str:
    """
    Classify a class_type_code into a category for indexed queries.

    Args:
        class_type_code: The TTB class type code

    Returns:
        Category name (Whiskey, Vodka, etc.) or 'Other'
    """
    if not class_type_code:
        return 'Other'

    code = class_type_code.upper()

    # Check patterns in order (more specific first)
    if any(p in code for p in ['WHISK', 'BOURBON', 'SCOTCH', 'RYE']):
        return 'Whiskey'
    if 'VODKA' in code:
        return 'Vodka'
    if any(p in code for p in ['TEQUILA', 'MEZCAL', 'AGAVE']):
        return 'Tequila'
    if any(p in code for p in ['RUM', 'CACHACA']):
        return 'Rum'
    if 'GIN' in code:
        return 'Gin'
    if any(p in code for p in ['BRANDY', 'COGNAC', 'ARMAGNAC', 'GRAPPA', 'PISCO']):
        return 'Brandy'
    if any(p in code for p in ['WINE', 'CHAMPAGNE', 'SAKE', 'CIDER', 'MEAD']):
        return 'Wine'
    if any(p in code for p in ['BEER', 'ALE', 'MALT BEVERAGE', 'STOUT', 'PORTER', 'LAGER']):
        return 'Beer'
    if any(p in code for p in ['LIQUEUR', 'CORDIAL', 'SCHNAPPS', 'AMARETTO', 'CREME DE']):
        return 'Liqueur'
    if any(p in code for p in ['COCKTAIL', 'RTD', 'READY TO DRINK', 'HARD SELTZER', 'SELTZER']):
        return 'Cocktails'

    return 'Other'


def d1_insert_batch(records: List[Dict]) -> Dict:
    """
    Insert a batch of COLA records into D1 using bulk INSERT OR IGNORE.

    Uses inline SQL values to avoid SQLite parameter limit (~999).

    Args:
        records: List of COLA record dicts

    Returns:
        Dict with 'success', 'inserted' count, and optionally 'error'
    """
    if not records:
        return {"success": True, "inserted": 0}

    columns = [
        'ttb_id', 'status', 'vendor_code', 'serial_number', 'class_type_code',
        'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
        'for_sale_in', 'total_bottle_capacity', 'formula', 'approval_date',
        'qualifications', 'grape_varietal', 'wine_vintage', 'appellation',
        'alcohol_content', 'ph_level', 'plant_registry', 'company_name',
        'street', 'state', 'contact_person', 'phone_number', 'year', 'month', 'day',
        'category'
    ]

    columns_str = ', '.join(columns)

    statements = []
    for record in records:
        # Get values for all columns except category (which we compute)
        values = [escape_sql_value(record.get(col)) for col in columns[:-1]]
        # Add category based on class_type_code
        category = classify_category(record.get('class_type_code', ''))
        values.append(escape_sql_value(category))
        values_str = ', '.join(values)
        statements.append(f"INSERT OR IGNORE INTO colas ({columns_str}) VALUES ({values_str});")

    sql = '\n'.join(statements)
    result = d1_execute(sql)

    if result.get("success"):
        total_changes = 0
        for res in result.get("result", []):
            total_changes += res.get("meta", {}).get("changes", 0)
        return {"success": True, "inserted": total_changes}
    else:
        return {"success": False, "inserted": 0, "error": result.get("error", "Unknown")}


# =============================================================================
# SLUG AND BRAND FUNCTIONS
# =============================================================================

def make_slug(text: str) -> str:
    """
    Convert brand or company name to URL-safe slug.

    Args:
        text: Brand or company name

    Returns:
        Lowercase, hyphenated slug with special chars removed
    """
    if not text:
        return ''
    text = text.lower()
    text = re.sub(r"[''']", '', text)  # Remove apostrophes
    text = re.sub(r'[^a-z0-9]+', '-', text)  # Replace non-alphanumeric with hyphen
    text = text.strip('-')
    return text


def update_brand_slugs(records: List[Dict], dry_run: bool = False) -> int:
    """
    Add new brand names to brand_slugs table for SEO page lookups.

    Args:
        records: List of COLA records containing brand_name
        dry_run: If True, skip actual insert

    Returns:
        Number of new brands added
    """
    logger = _get_logger()

    if not records:
        return 0

    brand_names = set()
    for record in records:
        brand_name = record.get('brand_name')
        if brand_name:
            brand_names.add(brand_name)

    if not brand_names:
        return 0

    logger.info(f"Updating brand_slugs with {len(brand_names)} unique brands...")

    if dry_run:
        logger.info("[DRY RUN] Would insert brand slugs")
        return 0

    values = []
    for brand_name in brand_names:
        slug = make_slug(brand_name)
        if slug:
            values.append(f"({escape_sql_value(slug)}, {escape_sql_value(brand_name)}, 1)")

    if not values:
        return 0

    total_inserted = 0
    batch_size = _config['batch_size']

    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        sql = f"INSERT OR IGNORE INTO brand_slugs (slug, brand_name, filing_count) VALUES {','.join(batch)}"
        result = d1_execute(sql)
        if result.get("success"):
            for res in result.get("result", []):
                total_inserted += res.get("meta", {}).get("changes", 0)

    logger.info(f"Added {total_inserted} new brands to brand_slugs")
    return total_inserted


# =============================================================================
# COMPANY FUNCTIONS
# =============================================================================

def get_company_id(company_name: str) -> Optional[int]:
    """
    Look up normalized company_id from company_aliases table.

    Args:
        company_name: Raw company name from COLA record

    Returns:
        company_id or None if not found
    """
    if not company_name:
        return None

    result = d1_execute(
        "SELECT company_id FROM company_aliases WHERE raw_name = ?",
        [company_name]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0].get("company_id")
    return None


def normalize_company_name(company_name: str) -> str:
    """
    Normalize company name to canonical form.

    Handles cases like "Tank Space, Tank Space" → "Tank Space"
    where the TTB filing has the same name repeated in DBA format.
    """
    if not company_name:
        return company_name

    name = company_name.strip()

    # Check for "Name, Name" pattern (exact duplicate)
    if ', ' in name:
        parts = [p.strip() for p in name.split(', ', 1)]
        if len(parts) == 2:
            # Compare normalized versions (case-insensitive, ignore minor differences)
            part1_norm = parts[0].upper().replace('LLC', '').replace('INC', '').strip()
            part2_norm = parts[1].upper().replace('LLC', '').replace('INC', '').strip()
            if part1_norm == part2_norm:
                # Names are duplicates, use the first one
                return parts[0]

    return name


def add_new_companies(records: List[Dict], dry_run: bool = False) -> int:
    """
    Add new companies to companies and company_aliases tables.

    Creates entries for new company names that aren't already in company_aliases.
    This ensures new filers have SEO pages and can be normalized in future syncs.

    Args:
        records: List of COLA records containing company_name
        dry_run: If True, skip actual insert

    Returns:
        Number of new companies added
    """
    logger = _get_logger()

    if not records or dry_run:
        return 0

    # Get unique company names from records
    company_names = set()
    for record in records:
        company_name = record.get('company_name')
        if company_name and company_name.strip():
            company_names.add(company_name.strip())

    if not company_names:
        return 0

    # Check which companies already exist in company_aliases
    existing = set()
    for i in range(0, len(company_names), 100):
        batch = list(company_names)[i:i + 100]
        placeholders = ','.join([escape_sql_value(n) for n in batch])
        result = d1_execute(f"SELECT raw_name FROM company_aliases WHERE raw_name IN ({placeholders})")
        if result.get("success") and result.get("result"):
            for res in result.get("result", []):
                for row in res.get("results", []):
                    existing.add(row.get("raw_name"))

    # Filter to only new companies
    new_companies = company_names - existing
    if not new_companies:
        logger.info("No new companies to add")
        return 0

    logger.info(f"Adding {len(new_companies)} new companies to database...")

    # Get current max company ID
    result = d1_execute("SELECT MAX(id) as max_id FROM companies")
    max_id = 0
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                max_id = row.get("max_id") or 0

    total_inserted = 0
    next_id = max_id + 1

    # Build mapping of normalized names to check for existing companies
    raw_to_normalized = {}
    normalized_names = set()
    for company_name in new_companies:
        normalized = normalize_company_name(company_name)
        raw_to_normalized[company_name] = normalized
        normalized_names.add(normalized)

    # Check which normalized names already exist in companies table
    existing_normalized = {}  # normalized_name -> company_id
    for i in range(0, len(normalized_names), 100):
        batch = list(normalized_names)[i:i + 100]
        placeholders = ','.join([escape_sql_value(n.upper()) for n in batch])
        result = d1_execute(f"SELECT id, canonical_name FROM companies WHERE match_key IN ({placeholders})")
        if result.get("success") and result.get("result"):
            for res in result.get("result", []):
                for row in res.get("results", []):
                    existing_normalized[row.get("canonical_name", "").upper()] = row.get("id")

    # Insert in batches
    for i in range(0, len(new_companies), 100):
        batch = list(new_companies)[i:i + 100]

        # Build companies insert values
        company_values = []
        alias_values = []
        seen_normalized = set()  # Track normalized names we're adding in this batch

        for company_name in batch:
            normalized = raw_to_normalized[company_name]
            normalized_upper = normalized.upper()

            # Check if normalized company already exists (either in DB or in this batch)
            if normalized_upper in existing_normalized:
                # Link alias to existing company
                existing_id = existing_normalized[normalized_upper]
                alias_values.append(
                    f"({escape_sql_value(company_name)}, {existing_id})"
                )
            elif normalized_upper in seen_normalized:
                # Already adding this normalized company in this batch, just add alias
                # We need to find the ID we assigned
                pass  # The alias will be added when we process the main entry
            else:
                # New company - create it
                company_id = next_id
                next_id += 1
                slug = make_slug(normalized)
                seen_normalized.add(normalized_upper)

                # Insert into companies table with normalized name
                company_values.append(
                    f"({company_id}, {escape_sql_value(normalized)}, {escape_sql_value(normalized)}, "
                    f"{escape_sql_value(slug)}, {escape_sql_value(normalized_upper)}, 1, 1, NULL, NULL)"
                )

                # Insert alias for raw name -> new company
                alias_values.append(
                    f"({escape_sql_value(company_name)}, {company_id})"
                )

                # Track for subsequent raw names that normalize to the same thing
                existing_normalized[normalized_upper] = company_id

        # Execute companies insert
        if company_values:
            sql = f"""INSERT OR IGNORE INTO companies
                      (id, canonical_name, display_name, slug, match_key, total_filings, variant_count, first_filing, last_filing)
                      VALUES {','.join(company_values)}"""
            result = d1_execute(sql)
            if result.get("success"):
                for res in result.get("result", []):
                    total_inserted += res.get("meta", {}).get("changes", 0)

        # Execute aliases insert
        if alias_values:
            sql = f"INSERT OR IGNORE INTO company_aliases (raw_name, company_id) VALUES {','.join(alias_values)}"
            d1_execute(sql)

    logger.info(f"Added {total_inserted} new companies")
    return total_inserted
