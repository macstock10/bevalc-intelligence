"""
weekly_update.py - Automated weekly COLA scraper and D1 sync

Runs every Friday at 9pm ET (via GitHub Actions):
1. Scrapes last 14 days from TTB
2. Adds new COLAs to local consolidated_colas.db
3. Syncs new records to Cloudflare D1
4. Classifies records (NEW_COMPANY, NEW_BRAND, etc.)
5. Logs results

USAGE:
    # Run manually
    python weekly_update.py

    # Dry run (no D1 push)
    python weekly_update.py --dry-run

    # Custom lookback period
    python weekly_update.py --days 7

    # Sync only (skip scraping, just push existing local data to D1)
    python weekly_update.py --sync-only

SETUP:
    1. Ensure cola_worker.py is in the same directory
    2. Configure paths below
    3. See .github/workflows/weekly-update.yml for GitHub Actions setup
"""

import os
import sys
import json
import sqlite3
import argparse
import logging
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

# Add scripts dir to path for imports
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

# Import shared D1 utilities
from lib.d1_utils import (
    init_d1_config,
    d1_execute,
    escape_sql_value,
    d1_insert_batch,
    make_slug,
    update_brand_slugs,
    add_new_companies,
    get_company_id,
)

# ============================================================================
# CONFIGURATION - Auto-detect paths (works on Windows and Linux/GitHub Actions)
# ============================================================================

# Base directory (goes up from /scripts to repo root)
BASE_DIR = SCRIPT_DIR.parent

# Paths relative to repo
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
EMAILS_DIR = BASE_DIR / "emails"

DB_PATH = str(DATA_DIR / "consolidated_colas.db")
LOG_FILE = str(LOGS_DIR / "weekly_update.log")
ENV_FILE = str(BASE_DIR / ".env")

# Default lookback period (days)
DEFAULT_LOOKBACK_DAYS = 14

# Load environment variables from .env file
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

# Cloudflare D1 Configuration (read from env, passed to lib.d1_utils)
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

# Batch size for D1 inserts (D1 has limits on query size)
D1_BATCH_SIZE = 500

# Validate required env vars
def validate_config():
    """Check that all required config is present and initialize D1."""
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not CLOUDFLARE_D1_DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if not CLOUDFLARE_API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")

    if missing:
        print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
        print(f"Please create a .env file at: {ENV_FILE}")
        print(f"With the following content:")
        print(f"  CLOUDFLARE_ACCOUNT_ID=your_account_id")
        print(f"  CLOUDFLARE_D1_DATABASE_ID=your_database_id")
        print(f"  CLOUDFLARE_API_TOKEN=your_api_token")
        sys.exit(1)

    # Initialize D1 configuration for shared module
    init_d1_config(
        account_id=CLOUDFLARE_ACCOUNT_ID,
        database_id=CLOUDFLARE_D1_DATABASE_ID,
        api_token=CLOUDFLARE_API_TOKEN,
        batch_size=D1_BATCH_SIZE,
        logger=logger
    )

# ============================================================================
# LOGGING SETUP
# ============================================================================

def setup_logging():
    """Setup logging to file and console."""
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
# CLOUDFLARE D1 SYNC FUNCTION
# ============================================================================

def sync_to_d1(local_db_path: str, dry_run: bool = False, records_to_sync: List[Dict] = None) -> Dict:
    """
    Sync records to Cloudflare D1.
    
    If records_to_sync is provided, only sync those records (fast path).
    Otherwise, sync all local records using INSERT OR IGNORE (D1 handles dedup).
    """
    logger.info("Starting D1 sync...")
    
    # Fast path: we already know which records to sync
    if records_to_sync is not None:
        logger.info(f"Syncing {len(records_to_sync):,} new records to D1...")
        
        if dry_run:
            logger.info("[DRY RUN] Would insert records to D1")
            return {"success": True, "dry_run": True, "inserted": 0, "new_records": records_to_sync}
        
        if not records_to_sync:
            logger.info("No records to sync")
            return {"success": True, "inserted": 0, "new_records": []}
        
        total_inserted = 0
        all_errors = []
        
        for i in range(0, len(records_to_sync), D1_BATCH_SIZE):
            batch = records_to_sync[i:i + D1_BATCH_SIZE]
            batch_num = i // D1_BATCH_SIZE + 1
            total_batches = (len(records_to_sync) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE
            
            logger.info(f"  Inserting batch {batch_num}/{total_batches} ({len(batch)} records)...")
            
            result = d1_insert_batch(batch)
            total_inserted += result.get("inserted", 0)
            
            if result.get("errors"):
                all_errors.extend(result["errors"])
        
        logger.info(f"Sync complete: {total_inserted:,} records inserted")

        # Update brand_slugs table with new brands for SEO pages
        update_brand_slugs(records_to_sync, dry_run)

        # Add new companies to companies/company_aliases tables
        add_new_companies(records_to_sync, dry_run)

        return {
            "success": True,
            "inserted": total_inserted,
            "attempted": len(records_to_sync),
            "errors": all_errors[:5] if all_errors else [],
            "new_records": records_to_sync
        }
    
    # Sync-only mode: Get local records and use INSERT OR IGNORE
    # D1 will handle duplicates - no need to fetch existing IDs
    if not os.path.exists(local_db_path):
        return {"success": False, "error": f"Local database not found: {local_db_path}"}
    
    try:
        # Get D1 count first for comparison
        count_result = d1_execute("SELECT COUNT(*) as cnt FROM colas")
        d1_count = 0
        if count_result.get("success") and count_result.get("result"):
            d1_count = count_result["result"][0].get("results", [{}])[0].get("cnt", 0)
        
        # Get local count
        conn = sqlite3.connect(local_db_path)
        conn.row_factory = sqlite3.Row
        local_count = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        logger.info(f"Local database has {local_count:,} records")
        logger.info(f"D1 database has {d1_count:,} records")
        
        if local_count == d1_count:
            logger.info("Databases are in sync - nothing to do")
            conn.close()
            return {"success": True, "inserted": 0, "new_records": []}
        
        new_count = local_count - d1_count
        logger.info(f"New records to sync: {new_count:,}")
        
        if dry_run:
            logger.info("[DRY RUN] Would insert records to D1")
            conn.close()
            return {
                "success": True,
                "dry_run": True,
                "new_records_count": new_count,
                "total_local": local_count,
                "total_d1": d1_count
            }
        
        # Get all local records and insert with INSERT OR IGNORE
        # D1 will skip duplicates automatically
        logger.info("Fetching local records for sync...")
        cursor = conn.execute("SELECT * FROM colas ORDER BY id DESC LIMIT ?", [new_count + 1000])  # Small buffer
        
        records = [dict(row) for row in cursor]
        conn.close()
        
        logger.info(f"Syncing {len(records):,} records (INSERT OR IGNORE)...")
        
        total_inserted = 0
        all_errors = []
        
        for i in range(0, len(records), D1_BATCH_SIZE):
            batch = records[i:i + D1_BATCH_SIZE]
            batch_num = i // D1_BATCH_SIZE + 1
            total_batches = (len(records) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE
            
            logger.info(f"  Inserting batch {batch_num}/{total_batches} ({len(batch)} records)...")
            
            result = d1_insert_batch(batch)
            total_inserted += result.get("inserted", 0)
            
            if result.get("errors"):
                all_errors.extend(result["errors"])
        
        logger.info(f"Sync complete: {total_inserted:,} records inserted")

        # Update brand_slugs table with new brands for SEO pages
        synced_records = records[:total_inserted] if total_inserted > 0 else []
        update_brand_slugs(synced_records, dry_run)

        # Add new companies to companies/company_aliases tables
        add_new_companies(synced_records, dry_run)

        return {
            "success": True,
            "inserted": total_inserted,
            "attempted": len(records),
            "errors": all_errors[:5] if all_errors else [],
            "new_records": synced_records
        }
        
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

# ============================================================================
# SCRAPING - Direct Date Range (Optimized)
# ============================================================================

import re
import time
from calendar import monthrange
from bs4 import BeautifulSoup

# Selenium imports
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.firefox.service import Service as FirefoxService
    from selenium.common.exceptions import TimeoutException, WebDriverException
    from webdriver_manager.firefox import GeckoDriverManager
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    logger.warning("Selenium not available - scraping disabled")

TTB_BASE_URL = "https://ttbonline.gov"
TTB_SEARCH_URL = f"{TTB_BASE_URL}/colasonline/publicSearchColasBasic.do"
TTB_ID_PATTERN = re.compile(r'ttbid=(\d{14})')
MAX_RESULTS_PER_QUERY = 1000


class DateRangeScraper:
    """
    Optimized scraper that only fetches a specific date range (not full months).
    """
    
    def __init__(self, db_path: str, headless: bool = True):
        self.db_path = db_path
        self.headless = headless
        self.driver = None
        self.conn = None
        self.request_delay = 1.5
        self.page_timeout = 30
        self.max_retries = 3
        
        self._init_database()
    
    def _init_database(self):
        """Initialize SQLite database."""
        os.makedirs(os.path.dirname(self.db_path) or '.', exist_ok=True)
        
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS collected_links (
                id INTEGER PRIMARY KEY,
                ttb_id TEXT UNIQUE NOT NULL,
                detail_url TEXT NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                scraped INTEGER DEFAULT 0,
                collected_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS colas (
                id INTEGER PRIMARY KEY,
                ttb_id TEXT UNIQUE NOT NULL,
                status TEXT,
                vendor_code TEXT,
                serial_number TEXT,
                class_type_code TEXT,
                origin_code TEXT,
                brand_name TEXT,
                fanciful_name TEXT,
                type_of_application TEXT,
                for_sale_in TEXT,
                total_bottle_capacity TEXT,
                formula TEXT,
                approval_date TEXT,
                qualifications TEXT,
                grape_varietal TEXT,
                wine_vintage TEXT,
                appellation TEXT,
                alcohol_content TEXT,
                ph_level TEXT,
                plant_registry TEXT,
                company_name TEXT,
                street TEXT,
                state TEXT,
                contact_person TEXT,
                phone_number TEXT,
                year INTEGER,
                month INTEGER,
                day INTEGER,
                scraped_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_links_ttb ON collected_links(ttb_id);
            CREATE INDEX IF NOT EXISTS idx_colas_ttb ON colas(ttb_id);
        """)
        self.conn.commit()
    
    def _init_driver(self):
        """Initialize Selenium WebDriver."""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
        
        options = webdriver.FirefoxOptions()
        if self.headless:
            options.add_argument('--headless')
        
        logger.info("Starting Firefox browser...")
        self.driver = webdriver.Firefox(
            service=FirefoxService(GeckoDriverManager().install()),
            options=options
        )
        self.driver.set_page_load_timeout(self.page_timeout)
    
    def _ensure_driver(self):
        """Ensure browser is running."""
        if not self.driver:
            self._init_driver()
    
    def close(self):
        """Clean up resources."""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
            self.driver = None
        if self.conn:
            self.conn.close()
            self.conn = None
    
    def _delay(self, multiplier: float = 1.0):
        """Wait between requests."""
        time.sleep(self.request_delay * multiplier)
    
    def _detect_captcha(self) -> bool:
        """Check if CAPTCHA is present."""
        try:
            html = self.driver.page_source.lower()
            indicators = ['captcha', 'what code is in the image', 'g-recaptcha',
                         'access denied', 'support id']
            return any(ind in html for ind in indicators)
        except:
            return False
    
    def _handle_captcha(self) -> bool:
        """Handle CAPTCHA if present."""
        if not self._detect_captcha():
            return True
        
        logger.warning("CAPTCHA detected! Waiting 30 seconds...")
        time.sleep(30)
        return not self._detect_captcha()
    
    def _search_ttb(self, start_date: datetime, end_date: datetime) -> int:
        """Execute TTB search and return total matching records."""
        self._ensure_driver()
        
        self.driver.get(TTB_SEARCH_URL)
        self._delay()
        
        if not self._handle_captcha():
            raise Exception("CAPTCHA not solved")
        
        wait = WebDriverWait(self.driver, self.page_timeout)
        wait.until(EC.presence_of_element_located((By.NAME, 'searchCriteria.dateCompletedFrom')))
        
        # Fill date fields
        date_from = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom')
        date_from.clear()
        date_from.send_keys(start_date.strftime('%m/%d/%Y'))
        
        date_to = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo')
        date_to.clear()
        date_to.send_keys(end_date.strftime('%m/%d/%Y'))
        
        # Submit
        submit = wait.until(EC.element_to_be_clickable(
            (By.XPATH, '//input[@type="submit" and @value="Search"]')
        ))
        submit.click()
        
        self._delay()
        
        if not self._handle_captcha():
            raise Exception("CAPTCHA not solved")
        
        # Get total count
        html = self.driver.page_source
        match = re.search(r'Total Matching Records[:\s]*([\d,]+)', html)
        if match:
            return int(match.group(1).replace(',', ''))
        
        match = re.search(r'(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)', html)
        if match:
            return int(match.group(3).replace(',', ''))
        
        return 0
    
    def _collect_links_from_page(self) -> List[str]:
        """Extract TTB IDs from current search results page."""
        html = self.driver.page_source
        return TTB_ID_PATTERN.findall(html)
    
    def _go_to_next_page(self) -> bool:
        """Navigate to next page of results. Returns False if no more pages."""
        try:
            next_link = self.driver.find_element(By.XPATH, '//a[contains(text(), "Next")]')
            next_link.click()
            self._delay()
            return True
        except:
            return False
    
    def _collect_date_range(self, start_date: datetime, end_date: datetime) -> tuple:
        """
        Collect all links for a date range.
        Uses binary split if results exceed 1000.
        Returns (expected, collected) counts.
        """
        total = self._search_ttb(start_date, end_date)
        
        logger.info(f"  Searching: {start_date.strftime('%m/%d')} - {end_date.strftime('%m/%d')}")
        logger.info(f"    TTB reports: {total:,} records")
        
        if total == 0:
            return 0, 0
        
        # If too many results, split the date range
        if total > MAX_RESULTS_PER_QUERY:
            mid_date = start_date + (end_date - start_date) // 2
            logger.info(f"    Splitting: {start_date.date()} to {mid_date.date()} | {(mid_date + timedelta(days=1)).date()} to {end_date.date()}")
            
            exp1, col1 = self._collect_date_range(start_date, mid_date)
            exp2, col2 = self._collect_date_range(mid_date + timedelta(days=1), end_date)
            return exp1 + exp2, col1 + col2
        
        # Collect links from all pages
        collected = 0
        page = 1
        
        while True:
            ttb_ids = self._collect_links_from_page()
            
            for ttb_id in ttb_ids:
                # Parse the date from ttb_id to get year/month
                # TTB ID format: YYDDD... where YY=year, DDD=julian day
                try:
                    year_prefix = int(ttb_id[:2])
                    year = 2000 + year_prefix if year_prefix < 50 else 1900 + year_prefix
                    julian_day = int(ttb_id[2:5])
                    record_date = datetime(year, 1, 1) + timedelta(days=julian_day - 1)
                    month = record_date.month
                except:
                    year = start_date.year
                    month = start_date.month
                
                detail_url = f"{TTB_BASE_URL}/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid={ttb_id}"
                
                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO collected_links (ttb_id, detail_url, year, month)
                        VALUES (?, ?, ?, ?)
                    """, (ttb_id, detail_url, year, month))
                    if self.conn.execute("SELECT changes()").fetchone()[0] > 0:
                        collected += 1
                except:
                    pass
            
            self.conn.commit()
            
            if not self._go_to_next_page():
                break
            page += 1
        
        logger.info(f"    Collected: {collected:,} new links (page {page})")
        return total, collected
    
    def _extract_field(self, soup, label: str) -> Optional[str]:
        """
        Extract a field value by its label.
        Handles TTB's HTML structure where labels are in <strong> tags.
        """
        try:
            # Method 1: Find exact match in strong tag
            strong = soup.find('strong', string=lambda t: t and label in t)
            
            # Method 2: Try partial match if exact not found
            if not strong:
                label_lower = label.rstrip(':').lower()
                for s in soup.find_all('strong'):
                    s_text = s.get_text() if s else ''
                    if label_lower in s_text.lower():
                        strong = s
                        break
            
            if not strong:
                return None
            
            # Get parent td and extract text after the label
            td = strong.find_parent('td')
            if not td:
                return None
            
            full_text = td.get_text(strip=True)
            
            # Remove the label from the text
            # Try various label formats
            for possible_label in [label, label.rstrip(':') + ':', label.rstrip(':')]:
                if full_text.startswith(possible_label):
                    full_text = full_text[len(possible_label):].strip()
                    break
                # Also try case-insensitive
                if full_text.lower().startswith(possible_label.lower()):
                    full_text = full_text[len(possible_label):].strip()
                    break
            
            return full_text if full_text else None
            
        except Exception as e:
            return None
    
    def _extract_company_details(self, soup) -> Dict:
        """Extract company details from the second info box."""
        data = {}
        
        try:
            boxes = soup.find_all('div', class_='box')
            if len(boxes) < 2:
                return data
            
            box = boxes[1]
            rows = box.find_all('tr')
            
            if len(rows) > 5:
                data['plant_registry'] = rows[2].find('td').get_text(strip=True) if rows[2].find('td') else None
                data['company_name'] = rows[3].find('td').get_text(strip=True) if rows[3].find('td') else None
                data['street'] = rows[4].find('td').get_text(strip=True) if rows[4].find('td') else None
                data['state'] = rows[5].find('td').get_text(strip=True) if rows[5].find('td') else None
            
            # Contact info
            for i, row in enumerate(rows):
                if 'Contact Information:' in row.get_text():
                    if i + 1 < len(rows):
                        td = rows[i + 1].find('td')
                        if td:
                            data['contact_person'] = ' '.join(td.get_text(strip=True).split())
                    if i + 2 < len(rows):
                        td = rows[i + 2].find('td')
                        if td:
                            text = td.get_text(separator=' ').strip()
                            data['phone_number'] = re.sub(r'^Phone Number:\s*', '', text).strip()
                    break
        except:
            pass
        
        return data
    
    def _scrape_detail_page(self, ttb_id: str, url: str) -> Optional[Dict]:
        """Scrape a single COLA detail page with ALL fields."""
        for attempt in range(self.max_retries):
            try:
                self.driver.get(url)
                WebDriverWait(self.driver, self.page_timeout).until(
                    lambda d: d.execute_script('return document.readyState') == 'complete'
                )
                
                if not self._handle_captcha():
                    return None
                
                soup = BeautifulSoup(self.driver.page_source, 'html.parser')
                
                # Core fields - using EXACT labels from TTB website
                data = {
                    'ttb_id': ttb_id,
                    'status': self._extract_field(soup, 'Status:'),
                    'vendor_code': self._extract_field(soup, 'Vendor Code:'),
                    'serial_number': self._extract_field(soup, 'Serial #:'),
                    'class_type_code': self._extract_field(soup, 'Class/Type Code:'),
                    'origin_code': self._extract_field(soup, 'Origin Code:'),
                    'brand_name': self._extract_field(soup, 'Brand Name:'),
                    'fanciful_name': self._extract_field(soup, 'Fanciful Name:'),
                    'type_of_application': self._extract_field(soup, 'Type of Application:'),
                    'for_sale_in': self._extract_field(soup, 'For Sale In:'),
                    'total_bottle_capacity': self._extract_field(soup, 'Total Bottle Capacity:'),
                    'formula': self._extract_field(soup, 'Formula :'),  # TTB has space before colon
                    'approval_date': self._extract_field(soup, 'Approval Date:'),
                    'qualifications': self._extract_field(soup, 'Qualifications:'),
                }
                
                # Wine-specific fields - try multiple label variations
                data['grape_varietal'] = self._extract_field(soup, 'Grape Varietal(s):')
                if not data['grape_varietal']:
                    data['grape_varietal'] = self._extract_field(soup, 'Grape Varietal:')
                
                data['wine_vintage'] = self._extract_field(soup, 'Vintage Date:')
                if not data['wine_vintage']:
                    data['wine_vintage'] = self._extract_field(soup, 'Wine Vintage:')
                
                data['appellation'] = self._extract_field(soup, 'Appellation:')
                
                # Other product-specific fields
                data['alcohol_content'] = self._extract_field(soup, 'Alcohol Content:')
                data['ph_level'] = self._extract_field(soup, 'pH Level:')
                
                # Add company details
                data.update(self._extract_company_details(soup))
                
                # Extract year/month/day from approval_date for indexing
                # Format: MM/DD/YYYY
                if data.get('approval_date'):
                    try:
                        parts = data['approval_date'].split('/')
                        if len(parts) == 3:
                            data['month'] = int(parts[0])
                            data['day'] = int(parts[1])
                            data['year'] = int(parts[2])
                    except:
                        data['year'] = None
                        data['month'] = None
                        data['day'] = None
                else:
                    data['year'] = None
                    data['month'] = None
                    data['day'] = None
                
                return data
                
            except Exception as e:
                if attempt < self.max_retries - 1:
                    logger.warning(f"  Retry {attempt + 1} for {ttb_id}: {e}")
                    self._delay(2)
                else:
                    logger.error(f"  Failed to scrape {ttb_id}: {e}")
                    return None
        
        return None
    
    def scrape_date_range(self, start_date: datetime, end_date: datetime) -> Dict:
        """
        Main method: Scrape all COLAs in a specific date range.
        """
        logger.info(f"Scraping date range: {start_date.date()} to {end_date.date()}")
        
        self._ensure_driver()
        
        # Phase 1: Collect links
        logger.info("Phase 1: Collecting links...")
        expected, collected = self._collect_date_range(start_date, end_date)
        
        total_links = self.conn.execute("SELECT COUNT(*) FROM collected_links").fetchone()[0]
        logger.info(f"Total links in database: {total_links:,}")
        
        # Phase 2: Scrape details for unscraped links
        logger.info("Phase 2: Scraping details...")
        unscraped = self.conn.execute("""
            SELECT ttb_id, detail_url FROM collected_links WHERE scraped = 0
        """).fetchall()
        
        logger.info(f"Links to scrape: {len(unscraped):,}")
        
        scraped_count = 0
        for i, (ttb_id, url) in enumerate(unscraped):
            if (i + 1) % 50 == 0:
                logger.info(f"  Progress: {i + 1}/{len(unscraped)}")
            
            data = self._scrape_detail_page(ttb_id, url)
            
            if data:
                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO colas
                        (ttb_id, status, vendor_code, serial_number, class_type_code,
                         origin_code, brand_name, fanciful_name, type_of_application,
                         for_sale_in, total_bottle_capacity, formula, approval_date,
                         qualifications, grape_varietal, wine_vintage, appellation,
                         alcohol_content, ph_level, plant_registry, company_name,
                         street, state, contact_person, phone_number, year, month, day)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        data.get('ttb_id'), data.get('status'), data.get('vendor_code'),
                        data.get('serial_number'), data.get('class_type_code'),
                        data.get('origin_code'), data.get('brand_name'),
                        data.get('fanciful_name'), data.get('type_of_application'),
                        data.get('for_sale_in'), data.get('total_bottle_capacity'),
                        data.get('formula'), data.get('approval_date'),
                        data.get('qualifications'), data.get('grape_varietal'),
                        data.get('wine_vintage'), data.get('appellation'),
                        data.get('alcohol_content'), data.get('ph_level'),
                        data.get('plant_registry'), data.get('company_name'),
                        data.get('street'), data.get('state'),
                        data.get('contact_person'), data.get('phone_number'),
                        data.get('year'), data.get('month'), data.get('day')
                    ))
                    
                    self.conn.execute(
                        "UPDATE collected_links SET scraped = 1 WHERE ttb_id = ?",
                        (ttb_id,)
                    )
                    self.conn.commit()
                    scraped_count += 1
                except Exception as e:
                    logger.warning(f"  Failed to save {ttb_id}: {e}")
            
            self._delay(0.5)
        
        total_colas = self.conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        return {
            'expected_links': expected,
            'collected_links': collected,
            'scraped_details': scraped_count,
            'total_colas': total_colas
        }


def scrape_date_range(start_date: datetime, end_date: datetime) -> Dict:
    """
    Scrape COLAs for a specific date range.
    Returns stats dict.
    """
    if not SELENIUM_AVAILABLE:
        return {'success': False, 'error': 'Selenium not available'}

    logger.info(f"Scraping date range: {start_date.date()} to {end_date.date()}")

    # Create a temporary database
    temp_db = os.path.join(os.path.dirname(DB_PATH), "weekly_temp.db")

    # Remove old temp db if exists
    if os.path.exists(temp_db):
        os.remove(temp_db)

    try:
        scraper = DateRangeScraper(db_path=temp_db, headless=True)

        result = scraper.scrape_date_range(start_date, end_date)

        scraper.close()

        return {
            'success': True,
            'temp_db': temp_db,
            'links': result['collected_links'],
            'colas': result['total_colas'],
            'start_date': start_date.date().isoformat(),
            'end_date': end_date.date().isoformat(),
        }

    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def scrape_recent_days(days: int = 14) -> Dict:
    """
    Scrape the last N days of COLAs using exact date range (not full months).
    Returns stats dict.
    """
    if not SELENIUM_AVAILABLE:
        return {'success': False, 'error': 'Selenium not available'}

    logger.info(f"Scraping last {days} days from TTB...")

    # Calculate exact date range
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    logger.info(f"Date range: {start_date.date()} to {end_date.date()}")
    
    # Create a temporary database
    temp_db = os.path.join(os.path.dirname(DB_PATH), "weekly_temp.db")
    
    # Remove old temp db if exists
    if os.path.exists(temp_db):
        os.remove(temp_db)
    
    try:
        scraper = DateRangeScraper(db_path=temp_db, headless=True)
        
        result = scraper.scrape_date_range(start_date, end_date)
        
        scraper.close()
        
        return {
            'success': True,
            'temp_db': temp_db,
            'links': result['collected_links'],
            'colas': result['total_colas'],
            'start_date': start_date.date().isoformat(),
            'end_date': end_date.date().isoformat(),
        }
        
    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }

# ============================================================================
# MERGING
# ============================================================================

def merge_new_data(temp_db: str) -> Dict:
    """
    Merge new data from temp database into consolidated database.
    Returns stats dict INCLUDING the actual new records for D1 sync.
    """
    logger.info(f"Merging new data into {DB_PATH}...")
    
    if not os.path.exists(temp_db):
        return {'success': False, 'error': 'Temp database not found'}
    
    try:
        # Connect to both databases
        src = sqlite3.connect(temp_db)
        src.row_factory = sqlite3.Row
        dst = sqlite3.connect(DB_PATH)
        
        # Get column names from source
        src_cols = [desc[0] for desc in src.execute("SELECT * FROM colas LIMIT 1").description]
        
        # Merge COLAs
        rows = src.execute("SELECT * FROM colas").fetchall()
        
        added = 0
        new_records = []  # Track the actual records that were added
        
        for row in rows:
            r = dict(row)
            try:
                dst.execute("""
                    INSERT OR IGNORE INTO colas
                    (ttb_id, status, vendor_code, serial_number, class_type_code,
                     origin_code, brand_name, fanciful_name, type_of_application,
                     for_sale_in, total_bottle_capacity, formula, approval_date,
                     qualifications, grape_varietal, wine_vintage, appellation,
                     alcohol_content, ph_level, plant_registry, company_name,
                     street, state, contact_person, phone_number, year, month, day)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    r.get('ttb_id'), r.get('status'), r.get('vendor_code'),
                    r.get('serial_number'), r.get('class_type_code'),
                    r.get('origin_code'), r.get('brand_name'),
                    r.get('fanciful_name'), r.get('type_of_application'),
                    r.get('for_sale_in'), r.get('total_bottle_capacity'),
                    r.get('formula'), r.get('approval_date'),
                    r.get('qualifications'), r.get('grape_varietal'),
                    r.get('wine_vintage'), r.get('appellation'),
                    r.get('alcohol_content'), r.get('ph_level'),
                    r.get('plant_registry'), r.get('company_name'),
                    r.get('street'), r.get('state'),
                    r.get('contact_person'), r.get('phone_number'),
                    r.get('year'), r.get('month'), r.get('day')
                ))
                if dst.execute("SELECT changes()").fetchone()[0] > 0:
                    added += 1
                    new_records.append(r)  # Save the record that was actually added
            except Exception as e:
                logger.warning(f"Failed to insert {r.get('ttb_id')}: {e}")
        
        dst.commit()
        
        # Get total count
        total = dst.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        src.close()
        dst.close()
        
        # Clean up temp database
        os.remove(temp_db)
        logger.info(f"Removed temp database: {temp_db}")
        
        return {
            'success': True,
            'added': added,
            'total': total,
            'new_records': new_records  # Return the actual records
        }
        
    except Exception as e:
        logger.error(f"Merge failed: {e}")
        return {'success': False, 'error': str(e)}

# ============================================================================
# BATCH CLASSIFICATION (optimized - fetches all data upfront)
# ============================================================================

def classify_new_records(new_records: List[Dict]) -> Dict:
    """
    Classify new records using NORMALIZED company IDs and UPDATE their signal in D1.

    OPTIMIZED VERSION: Fetches all existing data in 3 queries instead of per-record.

    Uses company_aliases to map raw company_name to normalized company_id.
    This ensures "ABC Inc" and "ABC Inc." are treated as the same company.

    Priority order (highest to lowest):
    1. NEW_COMPANY = first time seeing this normalized company
    2. NEW_BRAND = company exists, but first time seeing company_id + brand_name
    3. NEW_SKU = company+brand exists, but first time seeing company_id + brand + fanciful_name
    4. REFILE = we've seen company_id + brand + fanciful_name before
    """
    if not new_records:
        return {'total': 0, 'new_companies': 0, 'new_brands': 0, 'new_skus': 0, 'refiles': 0}

    logger.info(f"Classifying {len(new_records):,} new records (batch mode)...")

    stats = {
        'total': len(new_records),
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0,
        'new_company_list': [],
        'new_brand_list': [],
        'new_sku_list': []
    }

    # Step 1: Fetch ALL company_aliases into memory (one query)
    logger.info("  Fetching company aliases...")
    aliases_result = d1_execute("SELECT raw_name, company_id FROM company_aliases")
    company_aliases = {}
    if aliases_result.get("success") and aliases_result.get("result"):
        for row in aliases_result["result"][0].get("results", []):
            raw_name = row.get('raw_name', '')
            company_aliases[raw_name] = row.get('company_id')
    logger.info(f"  Loaded {len(company_aliases):,} company aliases")

    # Helper to get company_id from local cache
    def get_company_id_cached(company_name: str) -> int:
        return company_aliases.get(company_name)

    # Step 2: Get all unique company_ids from new records
    batch_company_ids = set()
    for record in new_records:
        company_name = record.get('company_name', '') or ''
        cid = get_company_id_cached(company_name)
        if cid is not None:
            batch_company_ids.add(cid)

    # Step 3: Fetch existing companies (company_ids that have filings BEFORE this batch)
    logger.info("  Fetching existing companies...")
    existing_companies = set()
    if batch_company_ids:
        # Get company_ids that have existing filings (not in current batch)
        # We need to get ttb_ids from current batch to exclude them
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                existing_companies.add(row.get('company_id'))
    logger.info(f"  Found {len(existing_companies):,} companies with prior filings")

    # Step 4: Fetch existing brands (company_id + brand_name pairs that exist BEFORE this batch)
    logger.info("  Fetching existing brands...")
    existing_brands = set()
    if batch_company_ids:
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id, c.brand_name
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
            AND c.brand_name IS NOT NULL
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                cid = row.get('company_id')
                brand = row.get('brand_name', '')
                if cid and brand:
                    existing_brands.add((cid, brand))
    logger.info(f"  Found {len(existing_brands):,} existing company-brand pairs")

    # Step 5: Fetch existing SKUs (company_id + brand_name + fanciful_name that exist BEFORE this batch)
    logger.info("  Fetching existing SKUs...")
    existing_skus = set()
    if batch_company_ids:
        batch_ttb_ids = {r.get('ttb_id') for r in new_records}
        batch_ttb_ids_str = ','.join(f"'{tid}'" for tid in batch_ttb_ids if tid)

        query = f"""
            SELECT DISTINCT ca.company_id, c.brand_name, c.fanciful_name
            FROM colas c
            JOIN company_aliases ca ON c.company_name = ca.raw_name
            WHERE c.ttb_id NOT IN ({batch_ttb_ids_str})
            AND c.brand_name IS NOT NULL
        """
        result = d1_execute(query)
        if result.get("success") and result.get("result"):
            for row in result["result"][0].get("results", []):
                cid = row.get('company_id')
                brand = row.get('brand_name', '')
                fanciful = row.get('fanciful_name', '') or ''
                if cid and brand:
                    existing_skus.add((cid, brand, fanciful))
    logger.info(f"  Found {len(existing_skus):,} existing SKUs")

    # Step 6: Classify each record (all in memory, no API calls)
    logger.info("  Classifying records...")

    # Track what we've seen within this batch (for handling duplicates)
    seen_companies = set()
    seen_brands = set()
    seen_skus = set()

    # Track unknown companies (not in aliases table)
    seen_unknown_companies = set()
    seen_unknown_brands = set()
    seen_unknown_skus = set()

    classifications = []

    for record in new_records:
        ttb_id = record.get('ttb_id')
        company_name = record.get('company_name', '') or ''
        brand_name = record.get('brand_name', '') or ''
        fanciful_name = record.get('fanciful_name', '') or ''

        if not company_name or not brand_name:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            continue

        company_id = get_company_id_cached(company_name)

        if company_id is None:
            # Company not in aliases table - track by company_name
            if company_name not in seen_unknown_companies:
                classifications.append((ttb_id, 'NEW_COMPANY'))
                stats['new_companies'] += 1
                if len(stats['new_company_list']) < 20:
                    stats['new_company_list'].append(company_name[:40])
                seen_unknown_companies.add(company_name)
                seen_unknown_brands.add((company_name, brand_name))
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            elif (company_name, brand_name) not in seen_unknown_brands:
                classifications.append((ttb_id, 'NEW_BRAND'))
                stats['new_brands'] += 1
                if len(stats['new_brand_list']) < 20:
                    stats['new_brand_list'].append(f"{brand_name} ({company_name[:25]})")
                seen_unknown_brands.add((company_name, brand_name))
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            elif (company_name, brand_name, fanciful_name) not in seen_unknown_skus:
                classifications.append((ttb_id, 'NEW_SKU'))
                stats['new_skus'] += 1
                if len(stats['new_sku_list']) < 20:
                    stats['new_sku_list'].append(f"{brand_name} - {fanciful_name[:30]}")
                seen_unknown_skus.add((company_name, brand_name, fanciful_name))
            else:
                classifications.append((ttb_id, 'REFILE'))
                stats['refiles'] += 1
            continue

        # Check if company existed BEFORE this batch (using pre-fetched data)
        company_existed_before = company_id in existing_companies

        if not company_existed_before and company_id not in seen_companies:
            classifications.append((ttb_id, 'NEW_COMPANY'))
            stats['new_companies'] += 1
            if len(stats['new_company_list']) < 20:
                stats['new_company_list'].append(company_name[:40])
            seen_companies.add(company_id)
            seen_brands.add((company_id, brand_name))
            seen_skus.add((company_id, brand_name, fanciful_name))
            continue

        seen_companies.add(company_id)

        # Check if brand existed BEFORE this batch
        brand_key = (company_id, brand_name)
        brand_existed_before = brand_key in existing_brands

        if not brand_existed_before and brand_key not in seen_brands:
            classifications.append((ttb_id, 'NEW_BRAND'))
            stats['new_brands'] += 1
            if len(stats['new_brand_list']) < 20:
                stats['new_brand_list'].append(f"{brand_name} ({company_name[:25]})")
            seen_brands.add(brand_key)
            seen_skus.add((company_id, brand_name, fanciful_name))
            continue

        seen_brands.add(brand_key)

        # Check if SKU existed BEFORE this batch
        sku_key = (company_id, brand_name, fanciful_name)
        sku_existed_before = sku_key in existing_skus

        if not sku_existed_before and sku_key not in seen_skus:
            classifications.append((ttb_id, 'NEW_SKU'))
            stats['new_skus'] += 1
            if len(stats['new_sku_list']) < 20:
                stats['new_sku_list'].append(f"{brand_name} - {fanciful_name[:30]}")
            seen_skus.add(sku_key)
        else:
            classifications.append((ttb_id, 'REFILE'))
            stats['refiles'] += 1
            seen_skus.add(sku_key)

    # Step 7: Apply all classifications to D1 (batch updates)
    logger.info(f"  Applying {len(classifications)} classifications to D1...")

    # Group by signal for batch updates
    by_signal = {}
    for ttb_id, signal in classifications:
        if signal not in by_signal:
            by_signal[signal] = []
        by_signal[signal].append(ttb_id)

    for signal, ttb_ids in by_signal.items():
        # Update in batches of 100 to avoid query size limits
        for i in range(0, len(ttb_ids), 100):
            batch = ttb_ids[i:i+100]
            ids_str = ','.join(f"'{tid}'" for tid in batch)
            d1_execute(f"UPDATE colas SET signal = '{signal}' WHERE ttb_id IN ({ids_str})")

    logger.info(f"Classification complete:")
    logger.info(f"  New companies: {stats['new_companies']:,}")
    logger.info(f"  New brands: {stats['new_brands']:,}")
    logger.info(f"  New SKUs: {stats['new_skus']:,}")
    logger.info(f"  Refiles: {stats['refiles']:,}")

    return stats

# ============================================================================
# WEBSITE ENRICHMENT OUTPUT
# ============================================================================

def output_enrichment_list(new_records: List[Dict], classify_result: Dict):
    """
    Output a list of new brands/companies that need website enrichment.
    Only includes NEW_COMPANY and NEW_BRAND signals (not NEW_SKU or REFILE).
    Creates a file that can be used for manual enrichment with Claude.
    """
    if not new_records:
        return

    # Query D1 for records needing website enrichment
    # CRITICAL ORDER:
    # 1. All NEW_COMPANY/NEW_BRAND/NEW_SKU first (by date DESC, then signal priority)
    # 2. Then ALL REFILE records last (by date DESC)
    # This ensures high-value signals get enriched across all dates before touching refiles
    query = """
        SELECT DISTINCT c.brand_name, c.company_name, c.class_type_code, c.signal, c.approval_date
        FROM colas c
        LEFT JOIN brand_websites bw ON UPPER(c.brand_name) = UPPER(bw.brand_name)
        WHERE c.signal IN ('NEW_COMPANY', 'NEW_BRAND', 'NEW_SKU', 'REFILE')
        AND bw.brand_name IS NULL
        AND c.brand_name IS NOT NULL
        AND c.brand_name != ''
        ORDER BY
            CASE c.signal WHEN 'REFILE' THEN 1 ELSE 0 END,
            substr(c.approval_date, 7, 4) || substr(c.approval_date, 1, 2) || substr(c.approval_date, 4, 2) DESC,
            CASE c.signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 ELSE 4 END,
            c.brand_name
    """

    result = d1_execute(query)
    if not result.get("success") or not result.get("result"):
        logger.warning("Failed to query for enrichment candidates")
        return

    rows = result["result"][0].get("results", [])
    if not rows:
        logger.info("No new brands need website enrichment")
        return

    # Build enrichment list (already deduplicated by DISTINCT)
    # Sorted by: most recent approval_date DESC, then NEW_COMPANY before NEW_BRAND
    needs_enrichment = []
    for row in rows:
        needs_enrichment.append({
            'brand_name': row.get('brand_name', ''),
            'company_name': row.get('company_name', ''),
            'class_type_code': row.get('class_type_code', ''),
            'signal': row.get('signal', ''),
            'approval_date': row.get('approval_date', '')
        })

    # Output to file
    enrichment_file = os.path.join(LOGS_DIR, "needs_enrichment.json")
    with open(enrichment_file, 'w') as f:
        json.dump(needs_enrichment, f, indent=2)

    # Count by signal type
    new_companies = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_COMPANY')
    new_brands = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_BRAND')
    new_skus = sum(1 for x in needs_enrichment if x.get('signal') == 'NEW_SKU')
    refiles = sum(1 for x in needs_enrichment if x.get('signal') == 'REFILE')

    logger.info(f"Brands needing website enrichment: {len(needs_enrichment)} ({new_companies} NEW_COMPANY, {new_brands} NEW_BRAND, {new_skus} NEW_SKU, {refiles} REFILE)")
    logger.info(f"Enrichment list saved to: {enrichment_file}")

    # Also log first 10 for visibility (now sorted by approval_date DESC)
    if needs_enrichment:
        logger.info("First 10 brands needing enrichment (most recent first):")
        for item in needs_enrichment[:10]:
            signal = item.get('signal', '')
            date = item.get('approval_date', '')
            logger.info(f"  [{date}] [{signal}] {item['brand_name']} ({item['company_name'][:30]})")


# ============================================================================
# WATCHLIST ALERTS
# ============================================================================

def check_watchlist_and_alert(new_records: List[Dict], dry_run: bool = False) -> Dict:
    """
    Check new records against user watchlists and send real-time alerts.

    Returns dict with stats on matches and alerts sent.
    """
    if not new_records:
        return {'matches': 0, 'alerts_sent': 0}

    logger.info(f"Checking {len(new_records):,} new records against watchlists...")

    # Get all watchlist entries
    watchlist_result = d1_execute("SELECT email, type, value FROM watchlist")
    if not watchlist_result.get("success") or not watchlist_result.get("result"):
        logger.warning("Failed to fetch watchlist entries")
        return {'matches': 0, 'alerts_sent': 0, 'error': 'Failed to fetch watchlist'}

    watchlist_entries = watchlist_result["result"][0].get("results", [])
    if not watchlist_entries:
        logger.info("No watchlist entries found")
        return {'matches': 0, 'alerts_sent': 0}

    logger.info(f"Found {len(watchlist_entries)} watchlist entries")

    # Group watchlist by email for efficient matching
    # Structure: {email: {'brands': set(), 'companies': set()}}
    watchlist_by_user = {}
    for entry in watchlist_entries:
        email = entry.get('email', '').lower()
        entry_type = entry.get('type', '')
        value = entry.get('value', '').upper()  # Normalize to uppercase for matching

        if email not in watchlist_by_user:
            watchlist_by_user[email] = {'brands': set(), 'companies': set()}

        if entry_type == 'brand':
            watchlist_by_user[email]['brands'].add(value)
        elif entry_type == 'company':
            watchlist_by_user[email]['companies'].add(value)

    # Check each new record against watchlists
    # Structure: {email: [matched_records]}
    matches_by_user = {}
    total_matches = 0

    for record in new_records:
        brand_name = (record.get('brand_name', '') or '').upper()
        company_name = (record.get('company_name', '') or '').upper()

        for email, watches in watchlist_by_user.items():
            matched = False
            match_type = None

            # Check brand match
            if brand_name and brand_name in watches['brands']:
                matched = True
                match_type = 'brand'

            # Check company match (partial match for company names)
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
                total_matches += 1

    logger.info(f"Found {total_matches} watchlist matches for {len(matches_by_user)} users")

    if not matches_by_user:
        return {'matches': 0, 'alerts_sent': 0}

    if dry_run:
        logger.info("[DRY RUN] Would send alerts to:")
        for email, matches in matches_by_user.items():
            logger.info(f"  {email}: {len(matches)} matches")
        return {'matches': total_matches, 'alerts_sent': 0, 'dry_run': True}

    # Send alerts via Node.js email sender (uses React Email templates)
    alerts_sent = 0
    resend_api_key = os.environ.get('RESEND_API_KEY')

    if not resend_api_key:
        logger.warning("RESEND_API_KEY not set, skipping alert emails")
        return {'matches': total_matches, 'alerts_sent': 0, 'error': 'No RESEND_API_KEY'}

    for email, matches in matches_by_user.items():
        try:
            # Build matches array for the template
            matches_data = []
            for m in matches[:20]:  # Limit to 20 matches per email
                r = m['record']
                matches_data.append({
                    'brandName': r.get('brand_name', 'Unknown'),
                    'fancifulName': r.get('fanciful_name', '') or '',
                    'companyName': (r.get('company_name', 'Unknown') or '')[:50],
                    'signal': r.get('signal', 'FILING')
                })

            # Create the Node.js script to send the email
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
            # Write temp script
            temp_script = EMAILS_DIR / "_send_alert_temp.js"
            with open(temp_script, 'w') as f:
                f.write(send_script)

            try:
                result = subprocess.run(
                    f"npx tsx {temp_script.name}",
                    cwd=str(EMAILS_DIR),
                    capture_output=True,
                    text=True,
                    timeout=30,
                    shell=True  # Required on Windows
                )

                if result.returncode == 0:
                    alerts_sent += 1
                    logger.info(f"  Sent alert to {email}: {len(matches)} matches")
                else:
                    logger.warning(f"  Failed to send alert to {email}: {result.stderr}")

            except subprocess.TimeoutExpired:
                logger.error(f"  Timeout sending alert to {email}")
            finally:
                # Clean up temp script
                if temp_script.exists():
                    temp_script.unlink()

        except Exception as e:
            logger.error(f"  Error sending alert to {email}: {e}")

    logger.info(f"Sent {alerts_sent} watchlist alerts")

    return {
        'matches': total_matches,
        'alerts_sent': alerts_sent,
        'users_notified': len(matches_by_user)
    }


# ============================================================================
# MAIN
# ============================================================================

def get_records_from_temp_db(temp_db: str) -> List[Dict]:
    """
    Read all COLA records from the temp scrape database.
    Used when there's no local consolidated DB (GitHub Actions).
    """
    if not os.path.exists(temp_db):
        return []

    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM colas").fetchall()
    records = [dict(row) for row in rows]
    conn.close()
    return records


def run_weekly_update(days: int = DEFAULT_LOOKBACK_DAYS, dry_run: bool = False, sync_only: bool = False,
                      start_date: datetime = None, end_date: datetime = None):
    """
    Run the full weekly update pipeline.

    Handles two scenarios:
    - Local machine (Windows): consolidated_colas.db exists, merge new data into it
    - GitHub Actions: No local DB, sync scraped records directly to D1

    Args:
        days: Lookback period (used if start_date/end_date not provided)
        dry_run: If True, skip D1 push
        sync_only: If True, skip scraping
        start_date: Explicit start date (optional)
        end_date: Explicit end date (optional)
    """
    logger.info("=" * 60)
    logger.info("WEEKLY COLA UPDATE")
    logger.info(f"Started: {datetime.now()}")
    logger.info("=" * 60)

    # Check if we have a local consolidated DB
    has_local_db = os.path.exists(DB_PATH)
    if has_local_db:
        logger.info(f"Local DB found: {DB_PATH}")
    else:
        logger.info(f"No local DB at {DB_PATH} (GitHub Actions mode)")

    results = {}
    new_records = []

    if not sync_only:
        # Step 1: Scrape
        logger.info("\n[STEP 1/4] Scraping TTB...")
        if start_date and end_date:
            scrape_result = scrape_date_range(start_date, end_date)
        else:
            scrape_result = scrape_recent_days(days)
        results['scrape'] = scrape_result

        if not scrape_result.get('success'):
            logger.error("Scraping failed, aborting")
            return results

        temp_db = scrape_result['temp_db']

        # Step 2: Merge to local DB OR read directly from temp DB
        if has_local_db:
            # Local machine: merge into consolidated DB
            logger.info("\n[STEP 2/4] Merging new data to local DB...")
            merge_result = merge_new_data(temp_db)
            results['merge'] = merge_result

            if not merge_result.get('success'):
                logger.error("Merge failed, aborting")
                return results

            # Get the new records from merge
            new_records = merge_result.get('new_records', [])
        else:
            # GitHub Actions: no local DB, read records directly from temp DB
            logger.info("\n[STEP 2/4] No local DB - reading scraped records directly...")
            new_records = get_records_from_temp_db(temp_db)
            results['merge'] = {
                'skipped': True,
                'reason': 'No local consolidated DB',
                'records_from_temp': len(new_records)
            }
            logger.info(f"Read {len(new_records):,} records from temp DB")

            # Clean up temp DB
            if os.path.exists(temp_db):
                os.remove(temp_db)
                logger.info(f"Removed temp database: {temp_db}")

        # Step 3: Sync records to D1
        logger.info("\n[STEP 3/4] Syncing to Cloudflare D1...")
        sync_result = sync_to_d1(DB_PATH, dry_run=dry_run, records_to_sync=new_records)
        results['sync'] = sync_result

    else:
        # Sync-only mode: use slow path (compare everything)
        logger.info("\n[SYNC ONLY MODE] Comparing local DB to D1...")
        results['scrape'] = {'skipped': True}
        results['merge'] = {'skipped': True}

        if not has_local_db:
            logger.error("Cannot use --sync-only without a local consolidated DB")
            results['sync'] = {'success': False, 'error': 'No local DB for sync-only mode'}
            return results

        logger.info("\n[STEP 3/4] Syncing to Cloudflare D1...")
        sync_result = sync_to_d1(DB_PATH, dry_run=dry_run, records_to_sync=None)
        results['sync'] = sync_result
        new_records = sync_result.get('new_records', [])
    
    # Step 4: Classify new records
    logger.info("\n[STEP 4/5] Classifying new records...")
    if not dry_run and new_records:
        try:
            classify_result = classify_new_records(new_records)
            results['classify'] = classify_result

            # Output brands needing website enrichment
            output_enrichment_list(new_records, classify_result)
        except Exception as e:
            logger.error(f"Classification failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            results['classify'] = {'total': 0, 'error': str(e)}
    else:
        logger.info(f"No new records to classify (dry_run={dry_run}, records={len(new_records) if new_records else 0})")
        results['classify'] = {'total': 0, 'new_companies': 0, 'new_brands': 0, 'refiles': 0}

    # Step 5: Check watchlists and send alerts
    logger.info("\n[STEP 5/5] Checking watchlists and sending alerts...")
    if new_records:
        alert_result = check_watchlist_and_alert(new_records, dry_run=dry_run)
        results['alerts'] = alert_result
    else:
        logger.info("No new records to check against watchlists")
        results['alerts'] = {'matches': 0, 'alerts_sent': 0}
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    
    if not sync_only:
        logger.info(f"Scraped: {results.get('scrape', {}).get('colas', 0):,} COLAs")
        logger.info(f"Added to local: {results.get('merge', {}).get('added', 0):,} new COLAs")
        logger.info(f"Local total: {results.get('merge', {}).get('total', 0):,} COLAs")
    
    logger.info(f"Synced to D1: {sync_result.get('inserted', 0):,} new COLAs")
    
    # Classification summary
    c = results.get('classify', {})
    if c.get('total', 0) > 0:
        logger.info(f"Classification:")
        logger.info(f"  New brands: {c.get('new_brands', 0):,}")
        logger.info(f"  New SKUs: {c.get('new_skus', 0):,}")
        logger.info(f"  Refiles: {c.get('refiles', 0):,}")
        if c.get('new_brand_list'):
            logger.info(f"  Example new brands: {c['new_brand_list'][:5]}")
        if c.get('new_sku_list'):
            logger.info(f"  Example new SKUs: {c['new_sku_list'][:5]}")
    
    if sync_result.get('errors'):
        logger.warning(f"Sync errors: {sync_result['errors']}")

    # Alert summary
    a = results.get('alerts', {})
    if a.get('matches', 0) > 0:
        logger.info(f"Watchlist Alerts:")
        logger.info(f"  Matches found: {a.get('matches', 0)}")
        logger.info(f"  Alerts sent: {a.get('alerts_sent', 0)}")

    logger.info(f"Completed: {datetime.now()}")
    logger.info("=" * 60)
    
    return results


def parse_date(s: str) -> datetime:
    """Parse date string in various formats."""
    formats = [
        '%Y-%m-%d',   # 2026-01-05
        '%m/%d/%Y',   # 01/05/2026
        '%m-%d-%Y',   # 01-05-2026
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Invalid date format: {s}. Use YYYY-MM-DD or MM/DD/YYYY")


def main():
    parser = argparse.ArgumentParser(
        description='Weekly COLA update with D1 sync',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Default: last 14 days
  python weekly_update.py

  # Custom lookback
  python weekly_update.py --days 7

  # Specific single date
  python weekly_update.py --date 2026-01-05
  python weekly_update.py --date 01/05/2026

  # Date range
  python weekly_update.py --dates 2026-01-01 2026-01-07

  # Dry run (no D1 push)
  python weekly_update.py --date 2026-01-05 --dry-run
        """
    )
    parser.add_argument('--days', type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f'Days to look back (default: {DEFAULT_LOOKBACK_DAYS})')
    parser.add_argument('--date', metavar='DATE',
                        help='Single date to scrape (e.g., 2026-01-05 or 01/05/2026)')
    parser.add_argument('--dates', nargs=2, metavar=('START', 'END'),
                        help='Date range to scrape (e.g., --dates 2026-01-01 2026-01-07)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Run without pushing to D1')
    parser.add_argument('--sync-only', action='store_true',
                        help='Skip scraping, only sync existing local data to D1')

    args = parser.parse_args()

    # Validate configuration before running
    validate_config()

    # Determine date range
    if args.date:
        # Single date
        start_date = parse_date(args.date)
        end_date = start_date
        logger.info(f"Scraping single date: {start_date.date()}")
        run_weekly_update(start_date=start_date, end_date=end_date, dry_run=args.dry_run, sync_only=args.sync_only)
    elif args.dates:
        # Date range
        start_date = parse_date(args.dates[0])
        end_date = parse_date(args.dates[1])
        logger.info(f"Scraping date range: {start_date.date()} to {end_date.date()}")
        run_weekly_update(start_date=start_date, end_date=end_date, dry_run=args.dry_run, sync_only=args.sync_only)
    else:
        # Default: use --days lookback
        run_weekly_update(days=args.days, dry_run=args.dry_run, sync_only=args.sync_only)


if __name__ == '__main__':
    main()


# ============================================================================
# WINDOWS TASK SCHEDULER SETUP
# ============================================================================
"""
To set up Windows Task Scheduler to run this script every Sunday at 2am:

1. Open Task Scheduler (search "Task Scheduler" in Start menu)

2. Click "Create Task" (not "Create Basic Task")

3. General tab:
   - Name: "Weekly COLA Update"
   - Check "Run whether user is logged on or not"
   - Check "Run with highest privileges"

4. Triggers tab:
   - Click "New"
   - Begin the task: "On a schedule"
   - Settings: Weekly
   - Start: [pick next Sunday] at 2:00:00 AM
   - Recur every: 1 week
   - Check "Sunday"
   - Check "Enabled"

5. Actions tab:
   - Click "New"
   - Action: "Start a program"
   - Program/script: C:\\Users\\MacRo\\Anaconda3\\python.exe
   - Add arguments: "C:\\Projects\\bevalc-intelligence\\scripts\\weekly_update.py"
   - Start in: C:\\Projects\\bevalc-intelligence\\scripts

6. Conditions tab:
   - Check "Wake the computer to run this task"
   - Uncheck "Start only if on AC power" (optional)

7. Settings tab:
   - Check "Allow task to be run on demand"
   - Check "Run task as soon as possible after a scheduled start is missed"
   - Check "If the task fails, restart every: 1 hour"
   - Attempt to restart up to: 3 times

8. Click OK and enter your Windows password when prompted

To test:
   - Right-click the task and select "Run"
   - Check the log file at: C:\\Projects\\bevalc-intelligence\\logs\\weekly_update.log
   
MANUAL TESTING:
   # Test D1 sync without scraping (uses existing local data)
   python weekly_update.py --sync-only --dry-run
   
   # Actually sync existing local data to D1
   python weekly_update.py --sync-only
   
   # Full run with scraping
   python weekly_update.py
"""