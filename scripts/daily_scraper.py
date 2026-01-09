"""
daily_scraper.py - Daily TTB COLA scraper with D1 sync

Runs daily at 7pm ET to capture same-day TTB approvals.

USAGE:
    # Scrape today's data
    python daily_scraper.py

    # Scrape specific date
    python daily_scraper.py --date 2025-12-31

    # Scrape last N days (catch up)
    python daily_scraper.py --days 3

    # Dry run (no D1 push)
    python daily_scraper.py --dry-run

    # Verbose output
    python daily_scraper.py --verbose

SCHEDULING (Windows Task Scheduler):
    Run at 7pm ET daily - see bottom of file for setup instructions.

SCHEDULING (GitHub Actions):
    See .github/workflows/daily-scraper.yml
"""

import os
import sys
import json
import sqlite3
import argparse
import logging
import requests
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"

LOG_FILE = str(LOGS_DIR / "daily_scraper.log")
ENV_FILE = str(BASE_DIR / ".env")
TEMP_DB = str(DATA_DIR / "daily_temp.db")

# Load environment variables
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

# Cloudflare D1 Configuration
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_D1_DATABASE_ID}/query" if CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID else None

D1_BATCH_SIZE = 500

# TTB Configuration
TTB_BASE_URL = "https://ttbonline.gov"
TTB_SEARCH_URL = f"{TTB_BASE_URL}/colasonline/publicSearchColasBasic.do"
TTB_ID_PATTERN = re.compile(r'ttbid=(\d{14})')
MAX_RESULTS_PER_QUERY = 1000

# ============================================================================
# LOGGING
# ============================================================================

def setup_logging(verbose: bool = False):
    """Setup logging to file and console."""
    os.makedirs(LOGS_DIR, exist_ok=True)

    level = logging.DEBUG if verbose else logging.INFO

    logging.basicConfig(
        level=level,
        format='%(asctime)s | %(levelname)s | %(message)s',
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

logger = setup_logging()

# ============================================================================
# D1 FUNCTIONS
# ============================================================================

def d1_execute(sql: str, params: List[Any] = None) -> Dict:
    """Execute a SQL query against Cloudflare D1."""
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


def escape_sql_value(value) -> str:
    """Escape a value for inline SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def d1_insert_batch(records: List[Dict]) -> Dict:
    """Insert a batch of records into D1 using bulk INSERT."""
    if not records:
        return {"success": True, "inserted": 0}

    columns = [
        'ttb_id', 'status', 'vendor_code', 'serial_number', 'class_type_code',
        'origin_code', 'brand_name', 'fanciful_name', 'type_of_application',
        'for_sale_in', 'total_bottle_capacity', 'formula', 'approval_date',
        'qualifications', 'grape_varietal', 'wine_vintage', 'appellation',
        'alcohol_content', 'ph_level', 'plant_registry', 'company_name',
        'street', 'state', 'contact_person', 'phone_number', 'year', 'month'
    ]

    columns_str = ', '.join(columns)

    statements = []
    for record in records:
        values = [escape_sql_value(record.get(col)) for col in columns]
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
        return {"success": False, "inserted": 0, "errors": [result.get("error", "Unknown error")]}


def make_slug(text: str) -> str:
    """Convert brand name to URL slug."""
    if not text:
        return ''
    text = text.lower()
    text = re.sub(r"[''']", '', text)
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')
    return text


def update_brand_slugs(new_records: List[Dict], dry_run: bool = False) -> Dict:
    """Add new brand names to brand_slugs table."""
    if not new_records or dry_run:
        return {"success": True, "inserted": 0}

    brand_names = set()
    for record in new_records:
        brand_name = record.get('brand_name')
        if brand_name:
            brand_names.add(brand_name)

    if not brand_names:
        return {"success": True, "inserted": 0}

    logger.info(f"Updating brand_slugs with {len(brand_names)} unique brands...")

    values = []
    for brand_name in brand_names:
        slug = make_slug(brand_name)
        if slug:
            values.append(f"({escape_sql_value(slug)}, {escape_sql_value(brand_name)}, 1)")

    if not values:
        return {"success": True, "inserted": 0}

    total_inserted = 0
    for i in range(0, len(values), 500):
        batch = values[i:i + 500]
        sql = f"INSERT OR IGNORE INTO brand_slugs (slug, brand_name, filing_count) VALUES {','.join(batch)}"
        result = d1_execute(sql)
        if result.get("success"):
            for res in result.get("result", []):
                total_inserted += res.get("meta", {}).get("changes", 0)

    logger.info(f"Added {total_inserted} new brands to brand_slugs")
    return {"success": True, "inserted": total_inserted}


def sync_to_d1(records: List[Dict], dry_run: bool = False) -> Dict:
    """Sync records directly to D1."""
    logger.info(f"Syncing {len(records):,} records to D1...")

    if dry_run:
        logger.info("[DRY RUN] Would insert records to D1")
        return {"success": True, "dry_run": True, "inserted": 0}

    if not records:
        logger.info("No records to sync")
        return {"success": True, "inserted": 0}

    total_inserted = 0
    all_errors = []

    for i in range(0, len(records), D1_BATCH_SIZE):
        batch = records[i:i + D1_BATCH_SIZE]
        batch_num = i // D1_BATCH_SIZE + 1
        total_batches = (len(records) + D1_BATCH_SIZE - 1) // D1_BATCH_SIZE

        logger.info(f"  Batch {batch_num}/{total_batches} ({len(batch)} records)...")

        result = d1_insert_batch(batch)
        total_inserted += result.get("inserted", 0)

        if result.get("errors"):
            all_errors.extend(result["errors"])

    logger.info(f"Sync complete: {total_inserted:,} records inserted")

    # Update brand_slugs
    update_brand_slugs(records, dry_run)

    return {
        "success": True,
        "inserted": total_inserted,
        "attempted": len(records),
        "errors": all_errors[:5] if all_errors else []
    }

# ============================================================================
# SCRAPING
# ============================================================================

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.firefox.service import Service as FirefoxService
    from selenium.common.exceptions import TimeoutException, WebDriverException
    from webdriver_manager.firefox import GeckoDriverManager
    from bs4 import BeautifulSoup
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    logger.warning("Selenium not available - install with: pip install selenium webdriver-manager beautifulsoup4")


class DailyScraper:
    """Lightweight scraper for daily TTB updates."""

    def __init__(self, headless: bool = True):
        self.headless = headless
        self.driver = None
        self.conn = None
        self.request_delay = 1.5
        self.page_timeout = 30
        self.max_retries = 3

        self._init_database()

    def _init_database(self):
        """Initialize temp SQLite database."""
        os.makedirs(DATA_DIR, exist_ok=True)

        # Remove old temp db
        if os.path.exists(TEMP_DB):
            os.remove(TEMP_DB)

        self.conn = sqlite3.connect(TEMP_DB)
        self.conn.row_factory = sqlite3.Row

        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS collected_links (
                id INTEGER PRIMARY KEY,
                ttb_id TEXT UNIQUE NOT NULL,
                detail_url TEXT NOT NULL,
                scraped INTEGER DEFAULT 0
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
                month INTEGER
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

    def _search_ttb(self, target_date: datetime) -> int:
        """Execute TTB search for a single date and return total matching records."""
        self._ensure_driver()

        self.driver.get(TTB_SEARCH_URL)
        self._delay()

        if not self._handle_captcha():
            raise Exception("CAPTCHA not solved")

        wait = WebDriverWait(self.driver, self.page_timeout)
        wait.until(EC.presence_of_element_located((By.NAME, 'searchCriteria.dateCompletedFrom')))

        date_str = target_date.strftime('%m/%d/%Y')

        # Fill date fields (same date for from/to = single day)
        date_from = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom')
        date_from.clear()
        date_from.send_keys(date_str)

        date_to = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo')
        date_to.clear()
        date_to.send_keys(date_str)

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
        """Navigate to next page of results."""
        try:
            next_link = self.driver.find_element(By.XPATH, '//a[contains(text(), "Next")]')
            next_link.click()
            self._delay()
            return True
        except:
            return False

    def _collect_links(self, target_date: datetime) -> int:
        """Collect all links for a single date."""
        total = self._search_ttb(target_date)

        logger.info(f"  TTB reports: {total:,} records for {target_date.strftime('%m/%d/%Y')}")

        if total == 0:
            return 0

        if total > MAX_RESULTS_PER_QUERY:
            logger.error(f"  ERROR: {total} results exceeds {MAX_RESULTS_PER_QUERY} limit!")
            logger.error(f"  Use weekly_update.py with --date {target_date.strftime('%Y-%m-%d')} for proper handling")
            raise Exception(f"Too many results ({total}) for single-day scraper. Use weekly_update.py instead.")

        # Collect links from all pages
        collected = 0
        page = 1

        while True:
            ttb_ids = self._collect_links_from_page()

            for ttb_id in ttb_ids:
                detail_url = f"{TTB_BASE_URL}/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid={ttb_id}"

                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO collected_links (ttb_id, detail_url)
                        VALUES (?, ?)
                    """, (ttb_id, detail_url))
                    if self.conn.execute("SELECT changes()").fetchone()[0] > 0:
                        collected += 1
                except:
                    pass

            self.conn.commit()

            if not self._go_to_next_page():
                break
            page += 1

        logger.info(f"  Collected: {collected:,} links (pages: {page})")
        return collected

    def _extract_field(self, soup, label: str) -> Optional[str]:
        """Extract a field value by its label."""
        try:
            strong = soup.find('strong', string=lambda t: t and label in t)

            if not strong:
                label_lower = label.rstrip(':').lower()
                for s in soup.find_all('strong'):
                    s_text = s.get_text() if s else ''
                    if label_lower in s_text.lower():
                        strong = s
                        break

            if not strong:
                return None

            td = strong.find_parent('td')
            if not td:
                return None

            full_text = td.get_text(strip=True)

            for possible_label in [label, label.rstrip(':') + ':', label.rstrip(':')]:
                if full_text.startswith(possible_label):
                    full_text = full_text[len(possible_label):].strip()
                    break
                if full_text.lower().startswith(possible_label.lower()):
                    full_text = full_text[len(possible_label):].strip()
                    break

            return full_text if full_text else None

        except:
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
        """Scrape a single COLA detail page."""
        for attempt in range(self.max_retries):
            try:
                self.driver.get(url)
                WebDriverWait(self.driver, self.page_timeout).until(
                    lambda d: d.execute_script('return document.readyState') == 'complete'
                )

                if not self._handle_captcha():
                    return None

                soup = BeautifulSoup(self.driver.page_source, 'html.parser')

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
                    'formula': self._extract_field(soup, 'Formula :'),
                    'approval_date': self._extract_field(soup, 'Approval Date:'),
                    'qualifications': self._extract_field(soup, 'Qualifications:'),
                }

                # Wine-specific fields
                data['grape_varietal'] = self._extract_field(soup, 'Grape Varietal(s):') or self._extract_field(soup, 'Grape Varietal:')
                data['wine_vintage'] = self._extract_field(soup, 'Vintage Date:') or self._extract_field(soup, 'Wine Vintage:')
                data['appellation'] = self._extract_field(soup, 'Appellation:')
                data['alcohol_content'] = self._extract_field(soup, 'Alcohol Content:')
                data['ph_level'] = self._extract_field(soup, 'pH Level:')

                # Company details
                data.update(self._extract_company_details(soup))

                # Extract year/month from approval_date
                if data.get('approval_date'):
                    try:
                        parts = data['approval_date'].split('/')
                        if len(parts) == 3:
                            data['month'] = int(parts[0])
                            data['year'] = int(parts[2])
                    except:
                        data['year'] = None
                        data['month'] = None
                else:
                    data['year'] = None
                    data['month'] = None

                return data

            except Exception as e:
                if attempt < self.max_retries - 1:
                    logger.warning(f"  Retry {attempt + 1} for {ttb_id}: {e}")
                    self._delay(2)
                else:
                    logger.error(f"  Failed to scrape {ttb_id}: {e}")
                    return None

        return None

    def scrape_date(self, target_date: datetime) -> List[Dict]:
        """
        Main method: Scrape all COLAs for a specific date.
        Returns list of COLA records.
        """
        logger.info(f"Scraping date: {target_date.strftime('%Y-%m-%d')}")

        self._ensure_driver()

        # Phase 1: Collect links
        logger.info("Phase 1: Collecting links...")
        collected = self._collect_links(target_date)

        if collected == 0:
            logger.info("No new filings found for this date")
            return []

        # Phase 2: Scrape details
        logger.info("Phase 2: Scraping details...")
        unscraped = self.conn.execute("""
            SELECT ttb_id, detail_url FROM collected_links WHERE scraped = 0
        """).fetchall()

        logger.info(f"Links to scrape: {len(unscraped):,}")

        records = []
        for i, (ttb_id, url) in enumerate(unscraped):
            if (i + 1) % 25 == 0:
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
                         street, state, contact_person, phone_number, year, month)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        data.get('year'), data.get('month')
                    ))

                    self.conn.execute(
                        "UPDATE collected_links SET scraped = 1 WHERE ttb_id = ?",
                        (ttb_id,)
                    )
                    self.conn.commit()
                    records.append(data)
                except Exception as e:
                    logger.warning(f"  Failed to save {ttb_id}: {e}")

            self._delay(0.5)

        logger.info(f"Scraped {len(records):,} records")
        return records


# ============================================================================
# CLASSIFICATION
# ============================================================================

def get_company_id(company_name: str) -> int:
    """Look up normalized company_id from company_aliases table."""
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


def classify_records(records: List[Dict], dry_run: bool = False) -> Dict:
    """
    Classify records using normalized company IDs.

    Priority:
    1. NEW_COMPANY = first time seeing this normalized company
    2. NEW_BRAND = company exists, but new brand
    3. NEW_SKU = company+brand exists, but new fanciful name
    4. REFILE = seen before
    """
    if not records or dry_run:
        return {'total': 0, 'new_companies': 0, 'new_brands': 0, 'new_skus': 0, 'refiles': 0}

    logger.info(f"Classifying {len(records):,} records...")

    stats = {
        'total': len(records),
        'new_companies': 0,
        'new_brands': 0,
        'new_skus': 0,
        'refiles': 0
    }

    for record in records:
        ttb_id = record.get('ttb_id')
        company_name = record.get('company_name', '') or ''
        brand_name = record.get('brand_name', '') or ''
        fanciful_name = record.get('fanciful_name', '') or ''

        if not company_name or not brand_name:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['REFILE', ttb_id])
            stats['refiles'] += 1
            continue

        company_id = get_company_id(company_name)

        if company_id is None:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['NEW_COMPANY', ttb_id])
            stats['new_companies'] += 1
            continue

        # Check if company has filed before
        company_result = d1_execute(
            """SELECT COUNT(*) as cnt FROM colas c
               JOIN company_aliases ca ON c.company_name = ca.raw_name
               WHERE ca.company_id = ? AND c.ttb_id != ?""",
            [company_id, ttb_id]
        )
        company_existed = False
        if company_result.get("success") and company_result.get("result"):
            cnt = company_result["result"][0].get("results", [{}])[0].get("cnt", 0)
            company_existed = cnt > 0

        if not company_existed:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['NEW_COMPANY', ttb_id])
            stats['new_companies'] += 1
            continue

        # Check if brand exists for this company
        brand_result = d1_execute(
            """SELECT COUNT(*) as cnt FROM colas c
               JOIN company_aliases ca ON c.company_name = ca.raw_name
               WHERE ca.company_id = ? AND c.brand_name = ? AND c.ttb_id != ?""",
            [company_id, brand_name, ttb_id]
        )
        brand_existed = False
        if brand_result.get("success") and brand_result.get("result"):
            cnt = brand_result["result"][0].get("results", [{}])[0].get("cnt", 0)
            brand_existed = cnt > 0

        if not brand_existed:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['NEW_BRAND', ttb_id])
            stats['new_brands'] += 1
            continue

        # Check if SKU exists
        sku_result = d1_execute(
            """SELECT COUNT(*) as cnt FROM colas c
               JOIN company_aliases ca ON c.company_name = ca.raw_name
               WHERE ca.company_id = ? AND c.brand_name = ? AND c.fanciful_name = ? AND c.ttb_id != ?""",
            [company_id, brand_name, fanciful_name, ttb_id]
        )
        sku_existed = False
        if sku_result.get("success") and sku_result.get("result"):
            cnt = sku_result["result"][0].get("results", [{}])[0].get("cnt", 0)
            sku_existed = cnt > 0

        if not sku_existed:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['NEW_SKU', ttb_id])
            stats['new_skus'] += 1
        else:
            d1_execute("UPDATE colas SET signal = ? WHERE ttb_id = ?", ['REFILE', ttb_id])
            stats['refiles'] += 1

    logger.info(f"Classification: {stats['new_companies']} new companies, {stats['new_brands']} new brands, {stats['new_skus']} new SKUs, {stats['refiles']} refiles")
    return stats


# ============================================================================
# MAIN
# ============================================================================

def validate_config():
    """Check required configuration."""
    missing = []
    if not CLOUDFLARE_ACCOUNT_ID:
        missing.append("CLOUDFLARE_ACCOUNT_ID")
    if not CLOUDFLARE_D1_DATABASE_ID:
        missing.append("CLOUDFLARE_D1_DATABASE_ID")
    if not CLOUDFLARE_API_TOKEN:
        missing.append("CLOUDFLARE_API_TOKEN")

    if missing:
        logger.error(f"Missing environment variables: {', '.join(missing)}")
        logger.error(f"Create .env file at: {ENV_FILE}")
        sys.exit(1)


def run_daily_scraper(target_date: datetime = None, days: int = 1, dry_run: bool = False, verbose: bool = False):
    """
    Run the daily scraper pipeline.

    Args:
        target_date: Specific date to scrape (default: today)
        days: Number of days to scrape if no target_date (default: 1)
        dry_run: Skip D1 sync
        verbose: Enable debug logging
    """
    if verbose:
        global logger
        logger = setup_logging(verbose=True)

    logger.info("=" * 60)
    logger.info("DAILY TTB SCRAPER")
    logger.info(f"Started: {datetime.now()}")
    logger.info("=" * 60)

    if not SELENIUM_AVAILABLE:
        logger.error("Selenium not available. Install: pip install selenium webdriver-manager beautifulsoup4")
        return {'success': False, 'error': 'Selenium not available'}

    validate_config()

    # Determine dates to scrape
    if target_date:
        dates = [target_date]
    else:
        dates = []
        for i in range(days):
            dates.append(datetime.now() - timedelta(days=i))

    all_records = []

    try:
        scraper = DailyScraper(headless=True)

        for date in dates:
            logger.info(f"\n--- Scraping {date.strftime('%Y-%m-%d')} ---")
            records = scraper.scrape_date(date)
            all_records.extend(records)

        scraper.close()

    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

    logger.info(f"\nTotal records scraped: {len(all_records):,}")

    if not all_records:
        logger.info("No new records found")
        return {'success': True, 'scraped': 0, 'synced': 0}

    # Sync to D1
    logger.info("\nSyncing to D1...")
    sync_result = sync_to_d1(all_records, dry_run=dry_run)

    # Classify records
    if not dry_run and sync_result.get('inserted', 0) > 0:
        logger.info("\nClassifying records...")
        classify_result = classify_records(all_records, dry_run=dry_run)
    else:
        classify_result = {'total': 0}

    # Clean up temp database
    if os.path.exists(TEMP_DB):
        os.remove(TEMP_DB)
        logger.info(f"Cleaned up temp database")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Dates scraped: {len(dates)}")
    logger.info(f"Records scraped: {len(all_records):,}")
    logger.info(f"Records synced to D1: {sync_result.get('inserted', 0):,}")
    if classify_result.get('total', 0) > 0:
        logger.info(f"New companies: {classify_result.get('new_companies', 0):,}")
        logger.info(f"New brands: {classify_result.get('new_brands', 0):,}")
        logger.info(f"New SKUs: {classify_result.get('new_skus', 0):,}")
        logger.info(f"Refiles: {classify_result.get('refiles', 0):,}")
    logger.info(f"Completed: {datetime.now()}")
    logger.info("=" * 60)

    return {
        'success': True,
        'dates': [d.strftime('%Y-%m-%d') for d in dates],
        'scraped': len(all_records),
        'synced': sync_result.get('inserted', 0),
        'classification': classify_result
    }


def parse_date(s: str) -> datetime:
    """Parse date string."""
    formats = ['%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y']
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Invalid date format: {s}. Use YYYY-MM-DD or MM/DD/YYYY")


def main():
    parser = argparse.ArgumentParser(
        description='Daily TTB COLA scraper with D1 sync',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape today's data
  python daily_scraper.py

  # Scrape specific date
  python daily_scraper.py --date 2025-12-31

  # Scrape last 3 days (catch up)
  python daily_scraper.py --days 3

  # Dry run (no D1 push)
  python daily_scraper.py --dry-run
        """
    )
    parser.add_argument('--date', metavar='DATE',
                        help='Specific date to scrape (e.g., 2025-12-31)')
    parser.add_argument('--days', type=int, default=1,
                        help='Number of days to scrape from today (default: 1)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Run without pushing to D1')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose/debug output')

    args = parser.parse_args()

    if args.date:
        target_date = parse_date(args.date)
        run_daily_scraper(target_date=target_date, dry_run=args.dry_run, verbose=args.verbose)
    else:
        run_daily_scraper(days=args.days, dry_run=args.dry_run, verbose=args.verbose)


if __name__ == '__main__':
    main()


# ============================================================================
# SCHEDULING
# ============================================================================
"""
WINDOWS TASK SCHEDULER (7pm ET daily):

1. Open Task Scheduler
2. Create Task (not Basic Task)
3. General:
   - Name: "Daily TTB Scraper"
   - Run whether user is logged on or not
   - Run with highest privileges
4. Triggers:
   - Daily at 7:00:00 PM
   - Recur every 1 day
5. Actions:
   - Program: C:\\Users\\MacRo\\Anaconda3\\python.exe
   - Arguments: "C:\\Projects\\bevalc-intelligence\\scripts\\daily_scraper.py"
   - Start in: C:\\Projects\\bevalc-intelligence\\scripts
6. Conditions:
   - Wake computer to run
7. Settings:
   - Allow task to be run on demand
   - Run as soon as possible after missed start


GITHUB ACTIONS (.github/workflows/daily-scraper.yml):

name: Daily TTB Scraper

on:
  schedule:
    # Run at 7pm ET (midnight UTC in winter, 11pm UTC in summer)
    - cron: '0 0 * * *'
  workflow_dispatch:  # Allow manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Firefox
        run: |
          sudo apt-get update
          sudo apt-get install -y firefox

      - name: Install dependencies
        run: |
          pip install selenium webdriver-manager beautifulsoup4 requests

      - name: Run daily scraper
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_D1_DATABASE_ID: ${{ secrets.CLOUDFLARE_D1_DATABASE_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          cd scripts
          python daily_scraper.py
"""
