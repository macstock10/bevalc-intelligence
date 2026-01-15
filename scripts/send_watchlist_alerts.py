#!/usr/bin/env python3
"""
send_watchlist_alerts.py - Send watchlist alerts for recent filings

Runs daily at 11:30am ET (after the 9pm ET sync completes).
Checks records from the last 3 days against user watchlists and sends alerts.
Tracks sent alerts to prevent duplicates.

Usage:
    python send_watchlist_alerts.py [--dry-run]
"""

import os
import sys
import json
import logging
import argparse
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Set

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from d1_utils import init_d1_config, d1_execute

# =============================================================================
# CONFIGURATION
# =============================================================================

SCRIPT_DIR = Path(__file__).parent
EMAILS_DIR = SCRIPT_DIR.parent / "emails"
LOG_DIR = SCRIPT_DIR.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / "watchlist_alerts.log")
    ]
)
logger = logging.getLogger(__name__)


# =============================================================================
# DATABASE FUNCTIONS
# =============================================================================

def ensure_alert_log_table():
    """Create the alert log table if it doesn't exist."""
    sql = """
    CREATE TABLE IF NOT EXISTS watchlist_alert_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        ttb_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        UNIQUE(email, ttb_id)
    )
    """
    result = d1_execute(sql)
    if not result.get("success"):
        logger.warning(f"Failed to create alert log table: {result}")


def get_recent_records(days_back: int = 3) -> List[Dict]:
    """
    Get records with approval dates in the last N days.
    Uses year/month columns for efficient filtering, then filters by parsed date.
    """
    today = datetime.now()
    cutoff = today - timedelta(days=days_back)

    # Build year/month filter for efficiency
    years_months = set()
    for i in range(days_back + 1):
        d = today - timedelta(days=i)
        years_months.add((d.year, d.month))

    # Query with year/month filter
    year_month_conditions = " OR ".join(
        f"(year = {y} AND month = {m})" for y, m in years_months
    )

    sql = f"""
    SELECT ttb_id, brand_name, fanciful_name, company_name, approval_date, signal
    FROM colas
    WHERE ({year_month_conditions})
    AND signal IS NOT NULL
    ORDER BY year DESC, month DESC
    LIMIT 5000
    """

    result = d1_execute(sql)
    if not result.get("success") or not result.get("result"):
        logger.error(f"Failed to query recent records: {result}")
        return []

    records = result["result"][0].get("results", [])
    logger.info(f"Found {len(records)} records from last {days_back} days")

    # Filter by actual approval_date
    filtered = []
    for r in records:
        try:
            approval_date = r.get('approval_date', '')
            if approval_date:
                # Parse MM/DD/YYYY
                dt = datetime.strptime(approval_date, '%m/%d/%Y')
                if dt >= cutoff:
                    filtered.append(r)
        except ValueError:
            continue

    logger.info(f"After date filter: {len(filtered)} records")
    return filtered


def get_already_alerted(emails: Set[str], ttb_ids: Set[str]) -> Set[str]:
    """
    Get set of "email|ttb_id" combinations that have already been alerted.
    """
    if not emails or not ttb_ids:
        return set()

    # Query in batches to avoid query size limits
    email_list = "', '".join(e.replace("'", "''") for e in emails)
    ttb_list = "', '".join(t.replace("'", "''") for t in ttb_ids)

    sql = f"""
    SELECT email, ttb_id FROM watchlist_alert_log
    WHERE email IN ('{email_list}')
    AND ttb_id IN ('{ttb_list}')
    """

    result = d1_execute(sql)
    if not result.get("success"):
        logger.warning("Failed to query alert log, may send duplicates")
        return set()

    alerted = set()
    for row in result.get("result", [{}])[0].get("results", []):
        alerted.add(f"{row['email']}|{row['ttb_id']}")

    return alerted


def log_sent_alerts(alerts: List[Dict]):
    """Log sent alerts to prevent future duplicates."""
    if not alerts:
        return

    now = datetime.utcnow().isoformat()
    values = []
    for a in alerts:
        email = a['email'].replace("'", "''")
        ttb_id = a['ttb_id'].replace("'", "''")
        values.append(f"('{email}', '{ttb_id}', '{now}')")

    # Insert in batches
    batch_size = 100
    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        sql = f"""
        INSERT OR IGNORE INTO watchlist_alert_log (email, ttb_id, sent_at)
        VALUES {', '.join(batch)}
        """
        d1_execute(sql)


def get_watchlist_entries() -> Dict[str, Dict[str, Set[str]]]:
    """
    Get all watchlist entries grouped by email.
    Returns: {email: {'brands': set(), 'companies': set()}}
    """
    sql = "SELECT email, type, value FROM watchlist"
    result = d1_execute(sql)

    if not result.get("success") or not result.get("result"):
        logger.error("Failed to fetch watchlist entries")
        return {}

    entries = result["result"][0].get("results", [])
    logger.info(f"Found {len(entries)} watchlist entries")

    watchlist_by_user = {}
    for entry in entries:
        email = entry.get('email', '').lower()
        entry_type = entry.get('type', '')
        value = entry.get('value', '').upper()

        if email not in watchlist_by_user:
            watchlist_by_user[email] = {'brands': set(), 'companies': set()}

        if entry_type == 'brand':
            watchlist_by_user[email]['brands'].add(value)
        elif entry_type == 'company':
            watchlist_by_user[email]['companies'].add(value)

    return watchlist_by_user


# =============================================================================
# MATCHING & ALERTING
# =============================================================================

def find_matches(records: List[Dict], watchlist: Dict) -> Dict[str, List[Dict]]:
    """
    Match records against watchlists.
    Returns: {email: [{'record': {...}, 'match_type': 'brand'|'company'}]}
    """
    matches_by_user = {}

    for record in records:
        brand_name = (record.get('brand_name', '') or '').upper()
        company_name = (record.get('company_name', '') or '').upper()

        for email, watches in watchlist.items():
            matched = False
            match_type = None

            # Check brand match
            if brand_name and brand_name in watches['brands']:
                matched = True
                match_type = 'brand'

            # Check company match (partial)
            if not matched and company_name:
                for watched_company in watches['companies']:
                    if watched_company in company_name or company_name in watched_company:
                        matched = True
                        match_type = 'company'
                        break

            if matched:
                if email not in matches_by_user:
                    matches_by_user[email] = []
                matches_by_user[email].append({
                    'record': record,
                    'match_type': match_type
                })

    return matches_by_user


def send_alert_email(email: str, matches: List[Dict]) -> bool:
    """Send watchlist alert email via Node.js/React Email."""
    matches_data = []
    for m in matches[:20]:  # Limit to 20 per email
        r = m['record']
        matches_data.append({
            'brandName': r.get('brand_name', 'Unknown'),
            'fancifulName': r.get('fanciful_name', '') or '',
            'companyName': (r.get('company_name', 'Unknown') or '')[:50],
            'signal': r.get('signal', 'FILING')
        })

    matches_json = json.dumps(matches_data)

    send_script = f'''
import {{ sendWatchlistAlert }} from './send.js';

const result = await sendWatchlistAlert({{
    to: "{email}",
    matchCount: {len(matches)},
    matches: {matches_json}
}});

if (result.error) {{
    console.error("Error:", result.error.message);
    process.exit(1);
}} else {{
    console.log("Success:", result.data?.id);
}}
'''

    temp_script = EMAILS_DIR / "_send_alert_temp.js"
    try:
        with open(temp_script, 'w') as f:
            f.write(send_script)

        result = subprocess.run(
            f"npx tsx {temp_script.name}",
            cwd=str(EMAILS_DIR),
            capture_output=True,
            text=True,
            timeout=30,
            shell=True
        )

        if result.returncode != 0:
            logger.error(f"Email send failed for {email}")
            logger.error(f"stdout: {result.stdout}")
            logger.error(f"stderr: {result.stderr}")
            return False
        return True

    except subprocess.TimeoutExpired:
        logger.error(f"Timeout sending to {email}")
        return False
    except Exception as e:
        logger.error(f"Error sending to {email}: {e}")
        return False
    finally:
        if temp_script.exists():
            temp_script.unlink()


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Send watchlist alerts')
    parser.add_argument('--dry-run', action='store_true', help='Preview without sending')
    parser.add_argument('--days', type=int, default=3, help='Days to look back (default: 3)')
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("WATCHLIST ALERTS")
    logger.info("=" * 60)

    # Check for API key
    if not args.dry_run and not os.environ.get('RESEND_API_KEY'):
        logger.error("RESEND_API_KEY not set")
        sys.exit(1)

    # Initialize D1
    init_d1_config(logger=logger)

    # Ensure alert log table exists
    ensure_alert_log_table()

    # Get recent records
    logger.info(f"\n[1/5] Fetching records from last {args.days} days...")
    records = get_recent_records(days_back=args.days)
    if not records:
        logger.info("No recent records found")
        return

    # Get watchlist entries
    logger.info("\n[2/5] Fetching watchlist entries...")
    watchlist = get_watchlist_entries()
    if not watchlist:
        logger.info("No watchlist entries found")
        return

    # Find matches
    logger.info("\n[3/5] Matching records against watchlists...")
    all_matches = find_matches(records, watchlist)
    total_matches = sum(len(m) for m in all_matches.values())
    logger.info(f"Found {total_matches} matches for {len(all_matches)} users")

    if not all_matches:
        logger.info("No matches found")
        return

    # Filter out already-alerted
    logger.info("\n[4/5] Filtering already-alerted records...")
    emails = set(all_matches.keys())
    ttb_ids = set(r['record']['ttb_id'] for matches in all_matches.values() for r in matches)
    already_alerted = get_already_alerted(emails, ttb_ids)
    logger.info(f"Found {len(already_alerted)} already-alerted combinations")

    # Filter matches
    filtered_matches = {}
    for email, matches in all_matches.items():
        new_matches = [
            m for m in matches
            if f"{email}|{m['record']['ttb_id']}" not in already_alerted
        ]
        if new_matches:
            filtered_matches[email] = new_matches

    new_match_count = sum(len(m) for m in filtered_matches.values())
    logger.info(f"After filtering: {new_match_count} new matches for {len(filtered_matches)} users")

    if not filtered_matches:
        logger.info("No new matches to alert")
        return

    # Send alerts
    logger.info("\n[5/5] Sending alerts...")

    if args.dry_run:
        logger.info("[DRY RUN] Would send alerts to:")
        for email, matches in filtered_matches.items():
            logger.info(f"  {email}: {len(matches)} matches")
        return

    alerts_sent = 0
    sent_alerts = []

    for email, matches in filtered_matches.items():
        if send_alert_email(email, matches):
            alerts_sent += 1
            logger.info(f"  Sent to {email}: {len(matches)} matches")
            for m in matches:
                sent_alerts.append({'email': email, 'ttb_id': m['record']['ttb_id']})
        else:
            logger.warning(f"  Failed to send to {email}")

    # Log sent alerts
    if sent_alerts:
        log_sent_alerts(sent_alerts)
        logger.info(f"Logged {len(sent_alerts)} sent alerts")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Records checked: {len(records)}")
    logger.info(f"Total matches: {total_matches}")
    logger.info(f"New matches: {new_match_count}")
    logger.info(f"Alerts sent: {alerts_sent}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
