"""
send_weekly_report.py - Query D1 metrics and send weekly email via Resend

Runs after weekly_update.py (e.g., Monday 8am UTC via GitHub Actions):
1. Queries D1 for this week's filing metrics
2. Computes week-over-week trends
3. Sends HTML email via Resend (React Email templates)
   - Free users get the basic WeeklyReport
   - Pro users get the ProWeeklyReport with watchlist matches, spikes, etc.

USAGE:
    python send_weekly_report.py
    python send_weekly_report.py --dry-run
    python send_weekly_report.py --email you@example.com  # Test single email
    python send_weekly_report.py --pro-only  # Only send Pro reports
"""

import os
import sys
import json
import logging
import subprocess
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
EMAILS_DIR = BASE_DIR / "emails"
LOG_FILE = str(BASE_DIR / "logs" / "send_report.log")
ENV_FILE = str(BASE_DIR / ".env")

# TTB code to category mapping (subset for display)
TTB_CODE_CATEGORIES = {
    'STRAIGHT WHISKY': 'Whiskey', 'STRAIGHT BOURBON WHISKY': 'Whiskey', 'BOURBON WHISKY': 'Whiskey',
    'WHISKY': 'Whiskey', 'SCOTCH WHISKY': 'Whiskey', 'CANADIAN WHISKY': 'Whiskey', 'IRISH WHISKY': 'Whiskey',
    'TENNESSEE WHISKY': 'Whiskey', 'RYE WHISKY': 'Whiskey', 'MALT WHISKY': 'Whiskey',
    'VODKA': 'Vodka', 'VODKA - FLAVORED': 'Vodka', 'VODKA 80-89 PROOF': 'Vodka',
    'TEQUILA': 'Tequila', 'TEQUILA FB': 'Tequila', 'MEZCAL': 'Tequila', 'AGAVE SPIRITS': 'Tequila',
    'DISTILLED GIN': 'Gin', 'GIN': 'Gin', 'LONDON DRY GIN': 'Gin',
    'TABLE RED WINE': 'Wine', 'TABLE WHITE WINE': 'Wine', 'SPARKLING WINE': 'Wine', 'CHAMPAGNE': 'Wine',
    'BEER': 'Beer', 'ALE': 'Beer', 'MALT BEVERAGES': 'Beer', 'STOUT': 'Beer',
    'COCKTAILS UNDER 48 PROOF': 'RTD', 'COCKTAILS 48 PROOF UP': 'RTD', 'MARGARITA': 'RTD',
    'U.S. RUM (WHITE)': 'Rum', 'FOREIGN RUM': 'Rum', 'PUERTO RICAN RUM': 'Rum',
    'BRANDY': 'Brandy', 'COGNAC (BRANDY) FB': 'Brandy', 'CALIFORNIA BRANDY': 'Brandy',
    'CORDIALS (FRUIT & PEELS)': 'Liqueur', 'AMARETTO': 'Liqueur', 'TRIPLE SEC': 'Liqueur',
}

def get_category(class_type_code: str) -> str:
    """Map TTB class/type code to category."""
    if not class_type_code:
        return 'Other'
    code = class_type_code.strip().upper()
    # Check for partial matches
    for ttb_code, category in TTB_CODE_CATEGORIES.items():
        if ttb_code in code or code in ttb_code:
            return category
    return 'Other'

def make_slug(name: str) -> str:
    """Convert name to URL slug."""
    if not name:
        return ""
    import re
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug

# ============================================================================
# LOAD ENVIRONMENT
# ============================================================================

def load_env():
    """Load environment variables from .env file."""
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")

load_env()

# Cloudflare config
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

D1_API_URL = None
if CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID:
    D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query"

# ============================================================================
# LOGGING
# ============================================================================

def setup_logging():
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)

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
# D1 QUERIES
# ============================================================================

def d1_query(sql: str) -> List[Dict]:
    """Execute a SQL query against D1 and return results."""
    if not D1_API_URL:
        logger.error("D1 API URL not configured")
        return []

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    response = requests.post(D1_API_URL, headers=headers, json={"sql": sql})

    if response.status_code != 200:
        logger.error(f"D1 API error: {response.status_code} - {response.text}")
        return []

    data = response.json()
    if data.get("success") and data.get("result"):
        return data["result"][0].get("results", [])
    return []


def get_week_dates() -> Tuple[datetime, datetime, datetime, datetime]:
    """Get date ranges for this week and last week (Monday-Sunday)."""
    today = datetime.now()

    # Find last Sunday (end of last complete week)
    days_since_sunday = (today.weekday() + 1) % 7
    if days_since_sunday == 0:
        days_since_sunday = 7  # If today is Sunday, go back a week

    this_week_end = today - timedelta(days=days_since_sunday)
    this_week_start = this_week_end - timedelta(days=6)

    last_week_end = this_week_start - timedelta(days=1)
    last_week_start = last_week_end - timedelta(days=6)

    return (this_week_start, this_week_end, last_week_start, last_week_end)


def date_range_sql(start: datetime, end: datetime) -> str:
    """Generate SQL WHERE clause for date range using year/month/day columns."""
    conditions = []

    if start.year == end.year:
        if start.month == end.month:
            # Same year, same month
            conditions.append(f"(year = {start.year} AND month = {start.month} AND day >= {start.day} AND day <= {end.day})")
        else:
            # Same year, different months
            conditions.append(f"(year = {start.year} AND ((month = {start.month} AND day >= {start.day}) OR (month > {start.month} AND month < {end.month}) OR (month = {end.month} AND day <= {end.day})))")
    else:
        # Different years (e.g., Dec 29 2025 to Jan 4 2026)
        conditions.append(f"(year = {start.year} AND month = {start.month} AND day >= {start.day})")
        conditions.append(f"(year = {end.year} AND month = {end.month} AND day <= {end.day})")

    return "(" + " OR ".join(conditions) + ")"


def get_four_week_range() -> str:
    """Get date range SQL for the past 4 weeks (for calculating averages)."""
    today = datetime.now()
    four_weeks_ago = today - timedelta(days=28)
    return date_range_sql(four_weeks_ago, today)


# ============================================================================
# FREE USER METRICS
# ============================================================================

def fetch_email_metrics() -> Dict:
    """Fetch all metrics needed for the FREE weekly email from D1."""
    this_week_start, this_week_end, last_week_start, last_week_end = get_week_dates()

    this_week_sql = date_range_sql(this_week_start, this_week_end)
    last_week_sql = date_range_sql(last_week_start, last_week_end)

    logger.info(f"Fetching metrics for week: {this_week_start.strftime('%m/%d/%Y')} - {this_week_end.strftime('%m/%d/%Y')}")

    # 1. Total filings this week
    total_this_week = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
    """)
    total_filings = total_this_week[0]["count"] if total_this_week else 0

    # 2. Total filings last week (for trend)
    total_last_week = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
    """)
    last_week_count = total_last_week[0]["count"] if total_last_week else 0

    # 3. New brands this week
    new_brands_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
    """)
    new_brands = new_brands_result[0]["count"] if new_brands_result else 0

    # 4. New SKUs this week
    new_skus_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_SKU'
    """)
    new_skus = new_skus_result[0]["count"] if new_skus_result else 0

    # 5. New companies this week
    new_companies_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_COMPANY'
    """)
    new_companies = new_companies_result[0]["count"] if new_companies_result else 0

    # 6. Top filing companies this week
    top_companies = d1_query(f"""
        SELECT company_name, class_type_code, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        GROUP BY company_name
        ORDER BY filings DESC
        LIMIT 5
    """)

    # Format top companies with category
    top_companies_list = []
    for row in top_companies:
        top_companies_list.append({
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "filings": row["filings"]
        })

    # Get top filer
    top_filer = top_companies_list[0]["company"] if top_companies_list else "N/A"
    top_filer_count = top_companies_list[0]["filings"] if top_companies_list else 0

    # 7. Top brand extensions (brands with most NEW_SKU filings)
    top_extensions = d1_query(f"""
        SELECT brand_name, company_name, class_type_code, COUNT(*) as new_skus
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_SKU'
        GROUP BY brand_name, company_name
        ORDER BY new_skus DESC
        LIMIT 5
    """)

    top_extensions_list = []
    for row in top_extensions:
        top_extensions_list.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "newSkus": row["new_skus"]
        })

    # 8. Category breakdown
    category_data = d1_query(f"""
        SELECT class_type_code, COUNT(*) as count
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        GROUP BY class_type_code
    """)

    # Aggregate by category
    category_totals = {}
    for row in category_data:
        cat = get_category(row.get("class_type_code", ""))
        category_totals[cat] = category_totals.get(cat, 0) + row["count"]

    # Sort by count and take top 6
    sorted_categories = sorted(category_totals.items(), key=lambda x: x[1], reverse=True)[:6]
    category_list = [{"label": cat, "value": count} for cat, count in sorted_categories]

    # 9. Category trends for summary (compare to last week)
    last_week_categories = d1_query(f"""
        SELECT class_type_code, COUNT(*) as count
        FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
        GROUP BY class_type_code
    """)

    last_week_totals = {}
    for row in last_week_categories:
        cat = get_category(row.get("class_type_code", ""))
        last_week_totals[cat] = last_week_totals.get(cat, 0) + row["count"]

    # Find biggest mover
    biggest_change = None
    biggest_pct = 0
    for cat, this_count in category_totals.items():
        last_count = last_week_totals.get(cat, 0)
        if last_count > 10:  # Only consider categories with meaningful volume
            pct_change = ((this_count - last_count) / last_count) * 100
            if abs(pct_change) > abs(biggest_pct):
                biggest_pct = pct_change
                biggest_change = cat

    # Generate summary
    if biggest_change and abs(biggest_pct) > 10:
        direction = "up" if biggest_pct > 0 else "down"
        summary = f"{biggest_change} filings {direction} {abs(int(biggest_pct))}% week-over-week"
    else:
        summary = f"{total_filings} label approvals processed this week"

    # 10. Pro preview - get one NEW_BRAND filing
    pro_preview = d1_query(f"""
        SELECT ttb_id, brand_name, company_name, signal
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
        LIMIT 1
    """)

    if pro_preview:
        row = pro_preview[0]
        pro_preview_label = {
            "brand": row["brand_name"],
            "company": row["company_name"],
            "signal": row["signal"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        }
    else:
        pro_preview_label = {
            "brand": "Sample Brand",
            "company": "Sample Company",
            "signal": "NEW_BRAND",
            "ttbId": "00000000000000",
            "ttbLink": "https://www.ttbonline.gov"
        }

    # Format week ending date
    week_ending = this_week_end.strftime("%B %d, %Y")

    return {
        "weekEnding": week_ending,
        "summary": summary,
        "totalFilings": str(total_filings),
        "newBrands": str(new_brands),
        "newSkus": str(new_skus),
        "newCompanies": str(new_companies),
        "topFiler": top_filer,
        "topFilerCount": str(top_filer_count),
        "categoryData": category_list,
        "topCompaniesList": top_companies_list,
        "topExtensionsList": top_extensions_list,
        "proPreviewLabel": pro_preview_label,
        "databaseUrl": "https://bevalcintel.com/database",
    }


# ============================================================================
# PRO USER METRICS
# ============================================================================

# TTB codes that map to each category (for SQL filtering)
CATEGORY_TTB_CODES = {
    'Whiskey': ['WHISKY', 'WHISKEY', 'BOURBON', 'SCOTCH', 'RYE', 'MALT'],
    'Vodka': ['VODKA'],
    'Tequila': ['TEQUILA', 'MEZCAL', 'AGAVE'],
    'Gin': ['GIN'],
    'Wine': ['WINE', 'CHAMPAGNE', 'SPARKLING'],
    'Beer': ['BEER', 'ALE', 'MALT BEVERAGES', 'STOUT', 'LAGER'],
    'RTD': ['COCKTAIL', 'MARGARITA', 'SELTZER', 'COOLER'],
    'Rum': ['RUM'],
    'Brandy': ['BRANDY', 'COGNAC'],
    'Liqueur': ['CORDIAL', 'AMARETTO', 'TRIPLE SEC', 'LIQUEUR'],
}

def get_category_sql_filter(category: str) -> str:
    """Generate SQL filter to match a category based on TTB codes."""
    codes = CATEGORY_TTB_CODES.get(category, [category])
    conditions = [f"class_type_code LIKE '%{code}%'" for code in codes]
    return f"({' OR '.join(conditions)})"


def fetch_category_report(category: str, this_week_sql: str, last_week_sql: str) -> Dict:
    """Fetch category-specific report data (new brands, new SKUs, top companies)."""
    category_filter = get_category_sql_filter(category)

    # Total filings in this category this week
    total_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
    """)
    total_filings = total_result[0]["count"] if total_result else 0

    # Total filings last week for change calculation
    last_week_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
    """)
    last_week_count = last_week_result[0]["count"] if last_week_result else 0

    # Calculate change
    if last_week_count > 0:
        pct_change = int(((total_filings - last_week_count) / last_week_count) * 100)
        change = f"+{pct_change}%" if pct_change >= 0 else f"{pct_change}%"
    else:
        change = ""

    # New Brands in this category
    new_brands_result = d1_query(f"""
        SELECT ttb_id, brand_name, company_name
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND signal = 'NEW_BRAND'
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    new_brands = []
    for row in new_brands_result:
        new_brands.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # New SKUs in this category
    new_skus_result = d1_query(f"""
        SELECT ttb_id, brand_name, fanciful_name, company_name
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND signal = 'NEW_SKU'
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    new_skus = []
    for row in new_skus_result:
        new_skus.append({
            "brand": row["brand_name"],
            "fancifulName": row.get("fanciful_name") or row["brand_name"],
            "company": row["company_name"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # Top companies filing in this category
    top_companies_result = d1_query(f"""
        SELECT company_name, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
        GROUP BY company_name
        ORDER BY filings DESC
        LIMIT 3
    """)

    top_companies = []
    for row in top_companies_result:
        top_companies.append({
            "company": row["company_name"],
            "filings": row["filings"]
        })

    return {
        "category": category,
        "totalFilings": total_filings,
        "change": change,
        "newBrands": new_brands,
        "newSkus": new_skus,
        "topCompanies": top_companies,
    }


def fetch_pro_metrics(user_email: str, watchlist: List[Dict], subscribed_categories: List[str] = None) -> Dict:
    """Fetch metrics for a PRO user including watchlist matches, spikes, and category reports."""
    this_week_start, this_week_end, last_week_start, last_week_end = get_week_dates()
    this_week_sql = date_range_sql(this_week_start, this_week_end)
    last_week_sql = date_range_sql(last_week_start, last_week_end)
    four_week_sql = get_four_week_range()

    # Get base metrics first
    base_metrics = fetch_email_metrics()

    # Fetch category-specific reports for user's subscribed categories
    category_reports = []
    if subscribed_categories:
        for category in subscribed_categories:
            try:
                report = fetch_category_report(category, this_week_sql, last_week_sql)
                # Only include if there's meaningful data
                if report["totalFilings"] > 0 or report["newBrands"] or report["newSkus"]:
                    category_reports.append(report)
            except Exception as e:
                logger.warning(f"Failed to fetch category report for {category}: {e}")

    # Extract watched brands and companies
    watched_brands = [w["value"] for w in watchlist if w.get("type") == "brand"]
    watched_companies = [w["value"] for w in watchlist if w.get("type") == "company"]

    # 1. Watchlist matches - filings from watched brands/companies
    watchlist_matches = []

    if watched_companies:
        # Escape single quotes in company names for SQL
        company_list = ", ".join([f"'{c.replace(chr(39), chr(39)+chr(39))}'" for c in watched_companies])
        company_matches = d1_query(f"""
            SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
            FROM colas
            WHERE {this_week_sql}
            AND company_name IN ({company_list})
            AND signal IN ('NEW_BRAND', 'NEW_SKU', 'NEW_COMPANY')
            ORDER BY approval_date DESC
            LIMIT 15
        """)
        for row in company_matches:
            watchlist_matches.append({
                "brand": row["brand_name"],
                "fancifulName": row.get("fanciful_name") or row["brand_name"],
                "company": row["company_name"],
                "signal": row["signal"],
                "category": get_category(row.get("class_type_code", "")),
                "ttbId": row["ttb_id"],
                "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}",
                "matchType": "company"
            })

    if watched_brands:
        # Escape single quotes in brand names for SQL
        brand_list = ", ".join([f"'{b.replace(chr(39), chr(39)+chr(39))}'" for b in watched_brands])
        brand_matches = d1_query(f"""
            SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
            FROM colas
            WHERE {this_week_sql}
            AND brand_name IN ({brand_list})
            AND signal IN ('NEW_BRAND', 'NEW_SKU')
            ORDER BY approval_date DESC
            LIMIT 10
        """)
        for row in brand_matches:
            # Avoid duplicates if company was already matched
            if not any(m["ttbId"] == row["ttb_id"] for m in watchlist_matches):
                watchlist_matches.append({
                    "brand": row["brand_name"],
                    "fancifulName": row.get("fanciful_name") or row["brand_name"],
                    "company": row["company_name"],
                    "signal": row["signal"],
                    "category": get_category(row.get("class_type_code", "")),
                    "ttbId": row["ttb_id"],
                    "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}",
                    "matchType": "brand"
                })

    # Limit to top 10 watchlist matches
    watchlist_matches = watchlist_matches[:10]

    # 2. Calculate week-over-week change
    total_this = int(base_metrics["totalFilings"])
    total_last_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
    """)
    total_last = total_last_result[0]["count"] if total_last_result else 0
    if total_last > 0:
        pct_change = int(((total_this - total_last) / total_last) * 100)
        week_over_week_change = f"+{pct_change}%" if pct_change >= 0 else f"{pct_change}%"
    else:
        week_over_week_change = "+0%"

    # 3. Top companies with vs avg comparison
    # First get 4-week averages per company
    avg_per_company = d1_query(f"""
        SELECT company_name, ROUND(COUNT(*) / 4.0) as avg_filings
        FROM colas
        WHERE {four_week_sql}
        AND status = 'APPROVED'
        GROUP BY company_name
        HAVING COUNT(*) >= 4
    """)
    avg_lookup = {r["company_name"]: r["avg_filings"] for r in avg_per_company}

    # Top companies this week with change vs avg
    top_companies_with_change = []
    for comp in base_metrics.get("topCompaniesList", []):
        avg = avg_lookup.get(comp["company"], 0)
        change = comp["filings"] - avg if avg > 0 else comp["filings"]
        top_companies_with_change.append({
            "company": comp["company"],
            "filings": comp["filings"],
            "change": f"+{change}" if change >= 0 else str(change)
        })

    # 4. Filing spikes (M&A signals) - companies with unusual activity
    filing_spikes = []
    this_week_by_company = d1_query(f"""
        SELECT company_name, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        GROUP BY company_name
        HAVING COUNT(*) >= 10
        ORDER BY filings DESC
    """)

    for row in this_week_by_company:
        company = row["company_name"]
        this_week_count = row["filings"]
        avg = avg_lookup.get(company, 0)

        if avg > 0 and this_week_count >= avg * 2:  # 2x or more than average
            pct_increase = int(((this_week_count - avg) / avg) * 100)
            if pct_increase >= 100:  # Only show 100%+ spikes
                filing_spikes.append({
                    "company": company,
                    "thisWeek": this_week_count,
                    "avgWeek": int(avg),
                    "percentIncrease": pct_increase
                })

    # Sort by percent increase and take top 3
    filing_spikes = sorted(filing_spikes, key=lambda x: x["percentIncrease"], reverse=True)[:3]

    # 5. Notable new brands (NEW_BRAND filings from this week)
    notable_brands = d1_query(f"""
        SELECT ttb_id, brand_name, company_name, class_type_code
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    notable_new_brands = []
    for row in notable_brands:
        notable_new_brands.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # 6. Full new filings list (first 20 NEW_BRAND + NEW_SKU)
    new_filings = d1_query(f"""
        SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
        FROM colas
        WHERE {this_week_sql}
        AND signal IN ('NEW_BRAND', 'NEW_SKU')
        ORDER BY
            CASE signal WHEN 'NEW_BRAND' THEN 1 ELSE 2 END,
            approval_date DESC
        LIMIT 20
    """)

    new_filings_list = []
    for row in new_filings:
        new_filings_list.append({
            "brand": row["brand_name"],
            "fancifulName": row.get("fanciful_name") or row["brand_name"],
            "company": row["company_name"],
            "signal": row["signal"],
            "category": get_category(row.get("class_type_code", "")),
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # 7. Category data with change indicators
    category_data_with_change = []
    for cat in base_metrics.get("categoryData", []):
        # Get last week's count for this category
        last_week_cat = d1_query(f"""
            SELECT COUNT(*) as count
            FROM colas
            WHERE {last_week_sql}
            AND status = 'APPROVED'
        """)
        # For simplicity, calculate change from the stored last_week_totals if available
        # This is already calculated in fetch_email_metrics, but we need to pass it
        category_data_with_change.append({
            "label": cat["label"],
            "value": cat["value"],
            "change": ""  # We'll calculate this properly
        })

    return {
        "weekEnding": base_metrics["weekEnding"],
        "summary": base_metrics["summary"],
        "totalFilings": base_metrics["totalFilings"],
        "newBrands": base_metrics["newBrands"],
        "newSkus": base_metrics["newSkus"],
        "newCompanies": base_metrics["newCompanies"],
        "topFiler": base_metrics["topFiler"],
        "topFilerCount": base_metrics["topFilerCount"],
        "weekOverWeekChange": week_over_week_change,
        "watchlistMatches": watchlist_matches,
        "categoryData": base_metrics["categoryData"],
        "topCompaniesList": top_companies_with_change,
        "notableNewBrands": notable_new_brands,
        "filingSpikes": filing_spikes,
        "newFilingsList": new_filings_list,
        "categoryReports": category_reports,  # Category-specific data for subscribed categories
        "databaseUrl": "https://bevalcintel.com/database",
        "accountUrl": "https://bevalcintel.com/account.html",
        "preferencesUrl": "https://bevalcintel.com/preferences.html",
    }


# ============================================================================
# SUBSCRIBERS
# ============================================================================

def get_free_subscribers() -> List[str]:
    """Get email addresses of free report subscribers (non-Pro)."""
    results = d1_query("""
        SELECT email FROM user_preferences
        WHERE (subscribed_free_report = 1 OR subscribed_free_report IS NULL)
        AND (is_pro = 0 OR is_pro IS NULL)
    """)
    return [row["email"] for row in results if row.get("email")]


def get_pro_subscribers() -> List[Dict]:
    """Get Pro subscribers with their watchlist and subscribed categories."""
    # Get Pro users with their category subscriptions
    pro_users = d1_query("""
        SELECT email, stripe_customer_id, categories FROM user_preferences
        WHERE is_pro = 1
    """)

    pro_subscribers = []
    for user in pro_users:
        email = user.get("email")
        if not email:
            continue

        # Parse subscribed categories from JSON
        categories_json = user.get("categories") or "[]"
        try:
            subscribed_categories = json.loads(categories_json) if isinstance(categories_json, str) else categories_json
        except json.JSONDecodeError:
            subscribed_categories = []

        # Get their watchlist
        watchlist = d1_query(f"""
            SELECT type, value FROM watchlist
            WHERE email = '{email.replace(chr(39), chr(39)+chr(39))}'
        """)

        pro_subscribers.append({
            "email": email,
            "watchlist": watchlist,
            "watchedCompaniesCount": len([w for w in watchlist if w.get("type") == "company"]),
            "watchedBrandsCount": len([w for w in watchlist if w.get("type") == "brand"]),
            "subscribedCategories": subscribed_categories,
        })

    return pro_subscribers


# ============================================================================
# SEND VIA RESEND (Node.js)
# ============================================================================

def send_email_via_node(to: str, metrics: Dict, template: str = "weekly-report") -> bool:
    """Send email by calling the Node.js email sender."""
    props = json.dumps(metrics)

    send_script = f'''
import {{ sendWeeklyReport, sendProWeeklyReport }} from './send.js';

const metrics = {props};

let result;
if ("{template}" === "pro-weekly-report") {{
    result = await sendProWeeklyReport({{
        to: "{to}",
        ...metrics
    }});
}} else {{
    result = await sendWeeklyReport({{
        to: "{to}",
        ...metrics
    }});
}}

if (result.error) {{
    console.error("Error:", result.error.message);
    process.exit(1);
}} else {{
    console.log("Success:", result.data?.id);
}}
'''

    # Write temp script
    temp_script = EMAILS_DIR / "_send_temp.js"
    with open(temp_script, 'w') as f:
        f.write(send_script)

    try:
        result = subprocess.run(
            f"npx tsx {temp_script.name}",
            cwd=str(EMAILS_DIR),
            capture_output=True,
            text=True,
            timeout=30,
            shell=True  # Required on Windows to find npx
        )

        if result.returncode == 0:
            logger.info(f"  Sent ({template}) to {to}: {result.stdout.strip()}")
            return True
        else:
            logger.error(f"  Failed for {to}: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"  Timeout sending to {to}")
        return False
    except Exception as e:
        logger.error(f"  Exception sending to {to}: {e}")
        return False
    finally:
        # Clean up temp script
        if temp_script.exists():
            temp_script.unlink()


# ============================================================================
# MAIN
# ============================================================================

def run_send_report(dry_run: bool = False, single_email: str = None, pro_only: bool = False):
    """Main function to query metrics and send emails."""
    logger.info("=" * 60)
    logger.info("WEEKLY REPORT EMAIL")
    logger.info(f"Started: {datetime.now()}")
    if dry_run:
        logger.info("[DRY RUN MODE]")
    if pro_only:
        logger.info("[PRO ONLY MODE]")
    logger.info("=" * 60)

    # Step 1: Fetch base metrics from D1
    logger.info("\n[STEP 1] Fetching base metrics from D1...")
    try:
        base_metrics = fetch_email_metrics()
        logger.info(f"Week ending: {base_metrics['weekEnding']}")
        logger.info(f"Total filings: {base_metrics['totalFilings']}")
        logger.info(f"New brands: {base_metrics['newBrands']}")
        logger.info(f"New SKUs: {base_metrics['newSkus']}")
        logger.info(f"Summary: {base_metrics['summary']}")
    except Exception as e:
        logger.error(f"Failed to fetch metrics: {e}")
        return

    # Step 2: Get subscribers
    logger.info("\n[STEP 2] Loading subscribers...")

    free_subscribers = []
    pro_subscribers = []

    if single_email:
        # Check if single email is a Pro user
        pro_check = d1_query(f"""
            SELECT is_pro, categories FROM user_preferences
            WHERE email = '{single_email.replace(chr(39), chr(39)+chr(39))}'
        """)
        is_pro = pro_check[0].get("is_pro", 0) if pro_check else 0

        if is_pro:
            # Parse subscribed categories
            categories_json = pro_check[0].get("categories") or "[]" if pro_check else "[]"
            try:
                subscribed_categories = json.loads(categories_json) if isinstance(categories_json, str) else categories_json
            except json.JSONDecodeError:
                subscribed_categories = []

            watchlist = d1_query(f"""
                SELECT type, value FROM watchlist
                WHERE email = '{single_email.replace(chr(39), chr(39)+chr(39))}'
            """)
            pro_subscribers = [{
                "email": single_email,
                "watchlist": watchlist,
                "watchedCompaniesCount": len([w for w in watchlist if w.get("type") == "company"]),
                "watchedBrandsCount": len([w for w in watchlist if w.get("type") == "brand"]),
                "subscribedCategories": subscribed_categories,
            }]
            logger.info(f"Sending Pro report to: {single_email}")
            if subscribed_categories:
                logger.info(f"  Subscribed categories: {', '.join(subscribed_categories)}")
        else:
            free_subscribers = [single_email]
            logger.info(f"Sending free report to: {single_email}")
    else:
        if not pro_only:
            free_subscribers = get_free_subscribers()
            logger.info(f"Found {len(free_subscribers)} free subscribers")

        pro_subscribers = get_pro_subscribers()
        logger.info(f"Found {len(pro_subscribers)} Pro subscribers")

    total_subscribers = len(free_subscribers) + len(pro_subscribers)
    if total_subscribers == 0:
        logger.info("No subscribers found.")
        return

    # Step 3: Send emails
    sent = 0
    failed = 0

    # Send to free subscribers
    if free_subscribers and not pro_only:
        logger.info(f"\n[STEP 3a] Sending FREE reports to {len(free_subscribers)} recipients...")

        for email in free_subscribers:
            if dry_run:
                logger.info(f"  [DRY RUN] Would send free report to: {email}")
                sent += 1
            else:
                if send_email_via_node(email, base_metrics, "weekly-report"):
                    sent += 1
                else:
                    failed += 1

    # Send to Pro subscribers
    if pro_subscribers:
        logger.info(f"\n[STEP 3b] Sending PRO reports to {len(pro_subscribers)} recipients...")

        for subscriber in pro_subscribers:
            email = subscriber["email"]
            watchlist = subscriber.get("watchlist", [])
            subscribed_categories = subscriber.get("subscribedCategories", [])

            try:
                # Fetch Pro-specific metrics for this user
                pro_metrics = fetch_pro_metrics(email, watchlist, subscribed_categories)
                pro_metrics["firstName"] = ""  # Could extract from email or store in DB
                pro_metrics["watchedCompaniesCount"] = subscriber["watchedCompaniesCount"]
                pro_metrics["watchedBrandsCount"] = subscriber["watchedBrandsCount"]

                if dry_run:
                    logger.info(f"  [DRY RUN] Would send Pro report to: {email}")
                    logger.info(f"    - Watchlist matches: {len(pro_metrics.get('watchlistMatches', []))}")
                    logger.info(f"    - Filing spikes: {len(pro_metrics.get('filingSpikes', []))}")
                    logger.info(f"    - Category reports: {len(pro_metrics.get('categoryReports', []))} ({', '.join(subscribed_categories) or 'none'})")
                    sent += 1
                else:
                    if send_email_via_node(email, pro_metrics, "pro-weekly-report"):
                        sent += 1
                    else:
                        failed += 1
            except Exception as e:
                logger.error(f"  Error preparing Pro report for {email}: {e}")
                failed += 1

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info(f"Sent: {sent}, Failed: {failed}")
    logger.info(f"Finished: {datetime.now()}")
    logger.info("=" * 60)


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Send weekly report emails via Resend')
    parser.add_argument('--dry-run', action='store_true',
                        help='Test without sending emails')
    parser.add_argument('--email', type=str,
                        help='Send to a single email address (for testing)')
    parser.add_argument('--pro-only', action='store_true',
                        help='Only send Pro reports (skip free subscribers)')

    args = parser.parse_args()

    # Validate config
    if not CLOUDFLARE_API_TOKEN:
        logger.error("CLOUDFLARE_API_TOKEN not configured")
        if not args.dry_run:
            return

    run_send_report(dry_run=args.dry_run, single_email=args.email, pro_only=args.pro_only)


if __name__ == '__main__':
    main()
