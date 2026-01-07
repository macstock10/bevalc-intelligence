"""
send_weekly_report.py - Query D1 metrics and send weekly email via Resend

Runs after weekly_update.py (e.g., Monday 8am UTC via GitHub Actions):
1. Queries D1 for this week's filing metrics
2. Computes week-over-week trends
3. Sends HTML email via Resend (React Email templates)

USAGE:
    python send_weekly_report.py
    python send_weekly_report.py --dry-run
    python send_weekly_report.py --email you@example.com  # Test single email
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
    # Use year/month/day columns for proper date comparison
    # This handles the case where dates span year boundaries
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


def fetch_email_metrics() -> Dict:
    """Fetch all metrics needed for the weekly email from D1."""
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


def get_free_subscribers() -> List[str]:
    """Get email addresses of free report subscribers."""
    results = d1_query("""
        SELECT email FROM user_preferences
        WHERE subscribed_free_report = 1
        OR subscribed_free_report IS NULL
    """)
    return [row["email"] for row in results if row.get("email")]


# ============================================================================
# SEND VIA RESEND (Node.js)
# ============================================================================

def send_email_via_node(to: str, metrics: Dict) -> bool:
    """Send email by calling the Node.js email sender."""
    # Build props JSON
    props = json.dumps(metrics)

    # Call Node.js script
    cmd = [
        "npx", "tsx",
        str(EMAILS_DIR / "send.js"),
        "weekly-report",
        "--to", to,
        "--test"  # Use test mode for now (adds [TEST] prefix)
    ]

    # For production, we'd pass all the props. For now, let's use a simpler approach
    # by creating a temporary script that imports and calls the send function

    send_script = f'''
import {{ sendWeeklyReport }} from './send.js';

const metrics = {props};

const result = await sendWeeklyReport({{
    to: "{to}",
    ...metrics
}});

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
            logger.info(f"  Sent to {to}: {result.stdout.strip()}")
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

def run_send_report(dry_run: bool = False, single_email: str = None):
    """Main function to query metrics and send emails."""
    logger.info("=" * 60)
    logger.info("WEEKLY REPORT EMAIL")
    logger.info(f"Started: {datetime.now()}")
    if dry_run:
        logger.info("[DRY RUN MODE]")
    logger.info("=" * 60)

    # Step 1: Fetch metrics from D1
    logger.info("\n[STEP 1] Fetching metrics from D1...")
    try:
        metrics = fetch_email_metrics()
        logger.info(f"Week ending: {metrics['weekEnding']}")
        logger.info(f"Total filings: {metrics['totalFilings']}")
        logger.info(f"New brands: {metrics['newBrands']}")
        logger.info(f"New SKUs: {metrics['newSkus']}")
        logger.info(f"Summary: {metrics['summary']}")
    except Exception as e:
        logger.error(f"Failed to fetch metrics: {e}")
        return

    # Step 2: Get subscribers
    logger.info("\n[STEP 2] Loading subscribers...")

    if single_email:
        subscribers = [single_email]
        logger.info(f"Sending to single email: {single_email}")
    else:
        subscribers = get_free_subscribers()
        logger.info(f"Found {len(subscribers)} subscribers")

    if not subscribers:
        logger.info("No subscribers found.")
        return

    # Step 3: Send emails
    logger.info(f"\n[STEP 3] Sending emails to {len(subscribers)} recipients...")

    sent = 0
    failed = 0

    for email in subscribers:
        if dry_run:
            logger.info(f"  [DRY RUN] Would send to: {email}")
            sent += 1
        else:
            if send_email_via_node(email, metrics):
                sent += 1
            else:
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

    args = parser.parse_args()

    # Validate config
    if not CLOUDFLARE_API_TOKEN:
        logger.error("CLOUDFLARE_API_TOKEN not configured")
        if not args.dry_run:
            return

    run_send_report(dry_run=args.dry_run, single_email=args.email)


if __name__ == '__main__':
    main()
