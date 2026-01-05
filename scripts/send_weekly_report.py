"""
send_weekly_report.py - Upload PDF to R2 and send via Loops

Runs after weekly_report.py (e.g., 3:15am Sunday via Task Scheduler):
1. Finds the latest generated PDF
2. Uploads to Cloudflare R2
3. Queries D1 for subscribers (subscribed_free_report = 1)
4. Triggers Loops transactional email with PDF link

USAGE:
    python send_weekly_report.py
    python send_weekly_report.py --dry-run
    python send_weekly_report.py --email you@example.com  # Test single email
"""

import os
import sys
import json
import logging
import requests
import boto3
from botocore.config import Config
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional

# ============================================================================
# CONFIGURATION - Auto-detect paths (works on Windows and Linux/GitHub Actions)
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent  # Goes up from /scripts to repo root

REPORTS_DIR = str(BASE_DIR / "reports")
LOG_FILE = str(BASE_DIR / "logs" / "send_report.log")
ENV_FILE = str(BASE_DIR / ".env")

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
                    os.environ[key.strip()] = value.strip()

load_env()

# Cloudflare config
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

# R2 config
R2_ACCESS_KEY_ID = os.environ.get("CLOUDFLARE_R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("CLOUDFLARE_R2_BUCKET_NAME", "bevalc-reports")
R2_PUBLIC_URL = os.environ.get("CLOUDFLARE_R2_PUBLIC_URL", "https://pub-xxx.r2.dev")
R2_ENDPOINT = f"https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Loops config
LOOPS_API_KEY = os.environ.get("LOOPS_API_KEY")
LOOPS_TRANSACTIONAL_ID = os.environ.get("LOOPS_TRANSACTIONAL_ID")

# D1 API URL
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
# R2 UPLOAD
# ============================================================================

def get_r2_client():
    """Create boto3 client for Cloudflare R2."""
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4'),
        region_name='auto'
    )


def upload_to_r2(local_path: str, remote_key: str) -> str:
    """Upload a file to R2 and return the public URL."""
    logger.info(f"Uploading {local_path} to R2...")
    
    client = get_r2_client()
    
    with open(local_path, 'rb') as f:
        client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=remote_key,
            Body=f,
            ContentType='application/pdf'
        )
    
    public_url = f"{R2_PUBLIC_URL}/{remote_key}"
    logger.info(f"Uploaded to: {public_url}")
    
    return public_url


# ============================================================================
# D1 QUERIES
# ============================================================================

def d1_execute(sql: str, params: List = None) -> Dict:
    """Execute a SQL query against D1."""
    if not D1_API_URL:
        logger.error("D1 API URL not configured")
        return {"success": False, "error": "D1 not configured"}
    
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }
    
    payload = {"sql": sql}
    if params:
        payload["params"] = params
    
    response = requests.post(D1_API_URL, headers=headers, json=payload)
    
    if response.status_code != 200:
        logger.error(f"D1 API error: {response.status_code} - {response.text}")
        return {"success": False, "error": response.text}
    
    return response.json()


def get_free_subscribers() -> List[Dict]:
    """
    Get all users who should receive the free weekly report from D1.
    
    Queries user_preferences for subscribed_free_report = 1
    """
    logger.info("Fetching free report subscribers from D1...")
    
    result = d1_execute("""
    SELECT email 
    FROM user_preferences 
    WHERE subscribed_free_report = 1 
       OR subscribed_free_report IS NULL
    """)
    
    subscribers = []
    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        for row in rows:
            subscribers.append({"email": row["email"]})
    
    logger.info(f"Found {len(subscribers)} free subscribers")
    return subscribers


# ============================================================================
# LOOPS EMAIL
# ============================================================================

def send_via_loops(
    email: str,
    pdf_url: str,
    week_ending: str,
    transactional_id: str = None
) -> bool:
    """Send a transactional email via Loops API."""
    if not LOOPS_API_KEY:
        logger.error("LOOPS_API_KEY not configured")
        return False
    
    url = "https://app.loops.so/api/v1/transactional"
    
    headers = {
        "Authorization": f"Bearer {LOOPS_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "transactionalId": transactional_id or LOOPS_TRANSACTIONAL_ID,
        "email": email,
        "dataVariables": {
            "week_ending": week_ending,
            "download_link": pdf_url,
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            return True
        else:
            logger.error(f"Loops API error for {email}: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"Loops API exception for {email}: {e}")
        return False


def send_bulk_via_loops(
    subscribers: List[Dict],
    pdf_url: str,
    week_ending: str,
    transactional_id: str = None,
    dry_run: bool = False
) -> Dict:
    """Send emails to a list of subscribers."""
    stats = {"sent": 0, "failed": 0, "skipped": 0}
    
    for sub in subscribers:
        email = sub.get("email")
        
        if not email:
            stats["skipped"] += 1
            continue
        
        if dry_run:
            logger.info(f"  [DRY RUN] Would send to: {email}")
            stats["sent"] += 1
            continue
        
        success = send_via_loops(
            email=email,
            pdf_url=pdf_url,
            week_ending=week_ending,
            transactional_id=transactional_id
        )
        
        if success:
            logger.info(f"  ✓ Sent to: {email}")
            stats["sent"] += 1
        else:
            stats["failed"] += 1
    
    return stats


# ============================================================================
# FIND LATEST REPORT
# ============================================================================

def find_latest_report() -> Optional[Dict]:
    """Find the most recently generated weekly report PDF."""
    reports_path = Path(REPORTS_DIR)
    
    if not reports_path.exists():
        logger.error(f"Reports directory not found: {REPORTS_DIR}")
        return None
    
    # Find all date folders (format: YYYY-MM-DD)
    date_folders = sorted([
        d for d in reports_path.iterdir() 
        if d.is_dir() and len(d.name) == 10 and d.name[4] == '-'
    ], reverse=True)
    
    if not date_folders:
        logger.error("No report folders found")
        return None
    
    # Get the latest folder
    latest_folder = date_folders[0]
    date_str = latest_folder.name
    
    # Find the PDF in that folder
    pdfs = list(latest_folder.glob("*.pdf"))
    
    if not pdfs:
        logger.error(f"No PDF found in {latest_folder}")
        return None
    
    pdf_path = pdfs[0]
    
    # Format the date nicely
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        week_ending = date_obj.strftime("%B %d, %Y")
    except:
        week_ending = date_str
    
    return {
        "path": str(pdf_path),
        "date": date_str,
        "week_ending": week_ending
    }


# ============================================================================
# MAIN
# ============================================================================

def run_send_report(dry_run: bool = False, single_email: str = None):
    """Main function to upload report and send emails."""
    logger.info("=" * 60)
    logger.info("WEEKLY REPORT DISTRIBUTION")
    logger.info(f"Started: {datetime.now()}")
    if dry_run:
        logger.info("[DRY RUN MODE]")
    logger.info("=" * 60)
    
    # Step 1: Find the latest report
    logger.info("\n[STEP 1] Finding latest report...")
    report = find_latest_report()
    
    if not report:
        logger.error("No report found. Run weekly_report.py first.")
        return
    
    logger.info(f"Found report: {report['path']}")
    logger.info(f"Week ending: {report['week_ending']}")
    
    # Step 2: Upload to R2
    logger.info("\n[STEP 2] Uploading to R2...")
    
    remote_key = f"weekly/{report['date']}/bevalc_weekly_snapshot_{report['date']}.pdf"
    
    if dry_run:
        pdf_url = f"{R2_PUBLIC_URL}/{remote_key}"
        logger.info(f"[DRY RUN] Would upload to: {pdf_url}")
    else:
        try:
            pdf_url = upload_to_r2(report['path'], remote_key)
        except Exception as e:
            logger.error(f"R2 upload failed: {e}")
            return
    
    if not pdf_url:
        logger.error("No PDF URL available. Cannot send emails.")
        return
    
    # Step 3: Get subscribers and send
    logger.info("\n[STEP 3] Loading subscribers...")
    
    if single_email:
        subscribers = [{"email": single_email}]
        logger.info(f"Sending to single email: {single_email}")
    else:
        subscribers = get_free_subscribers()
    
    if subscribers:
        logger.info(f"\n[STEP 4] Sending report to {len(subscribers)} subscribers...")
        stats = send_bulk_via_loops(
            subscribers=subscribers,
            pdf_url=pdf_url,
            week_ending=report['week_ending'],
            transactional_id=LOOPS_TRANSACTIONAL_ID,
            dry_run=dry_run
        )
        logger.info(f"\nResults: sent={stats['sent']}, failed={stats['failed']}, skipped={stats['skipped']}")
    else:
        logger.info("No subscribers found in D1.")
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info(f"PDF URL: {pdf_url}")
    logger.info(f"Finished: {datetime.now()}")
    logger.info("=" * 60)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Send weekly report via email')
    parser.add_argument('--dry-run', action='store_true',
                        help='Test without uploading or sending')
    parser.add_argument('--email', type=str,
                        help='Send to a single email address (for testing)')
    
    args = parser.parse_args()
    
    # Validate config
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not R2_ACCESS_KEY_ID:
        missing.append("CLOUDFLARE_R2_ACCESS_KEY_ID")
    if not LOOPS_API_KEY:
        missing.append("LOOPS_API_KEY")
    if not LOOPS_TRANSACTIONAL_ID:
        missing.append("LOOPS_TRANSACTIONAL_ID")
    
    if missing and not args.dry_run:
        logger.warning(f"Missing config: {missing}")
    
    run_send_report(dry_run=args.dry_run, single_email=args.email)


if __name__ == '__main__':
    main()