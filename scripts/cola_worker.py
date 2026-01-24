"""
cola_worker.py - COLA Scraper Worker with Manual Month Assignment

You specify exactly which months this worker should process.
Multiple workers can run in parallel on different months.

USAGE:
    # Single month
    python cola_worker.py --name worker_1 --months 2025-01
    
    # Multiple months
    python cola_worker.py --name worker_1 --months 2025-01 2025-02 2025-03
    
    # Range of months
    python cola_worker.py --name worker_1 --range 2025-01 2025-06
    
    # Full year
    python cola_worker.py --name worker_1 --year 2025
    
    # Just links (Phase 1)
    python cola_worker.py --name worker_1 --months 2025-01 --links-only
    
    # Just details (Phase 2) - requires links already collected
    python cola_worker.py --name worker_1 --months 2025-01 --details-only
    
    # Check status
    python cola_worker.py --name worker_1 --status

PARALLEL EXAMPLE (run in separate terminals):
    Terminal 1: python cola_worker.py --name w1 --months 2025-01 2025-02 2025-03
    Terminal 2: python cola_worker.py --name w2 --months 2025-04 2025-05 2025-06
    Terminal 3: python cola_worker.py --name w3 --months 2025-07 2025-08 2025-09
    Terminal 4: python cola_worker.py --name w4 --months 2025-10 2025-11
    
    (December already done in test.db)
"""

import os
import re
import time
import json
import logging
import sqlite3
import argparse
from datetime import datetime, timedelta
from calendar import monthrange
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass
from bs4 import BeautifulSoup

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.firefox import GeckoDriverManager


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

TTB_BASE_URL = "https://ttbonline.gov"
TTB_SEARCH_URL = f"{TTB_BASE_URL}/colasonline/publicSearchColasBasic.do"
TTB_ID_PATTERN = re.compile(r'ttbid=(\d{14})')
MAX_RESULTS_PER_QUERY = 1000
VERIFICATION_TOLERANCE = 1.0  # 100% match required


# ─────────────────────────────────────────────────────────────────────────────
# Data Classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MonthResult:
    """Result of processing a month."""
    year: int
    month: int
    
    # Phase 1
    expected_links: int = 0
    collected_links: int = 0
    links_verified: bool = False
    
    # Phase 2
    expected_details: int = 0
    scraped_details: int = 0
    details_verified: bool = False
    
    error: Optional[str] = None
    
    @property
    def month_str(self) -> str:
        return f"{self.year}-{self.month:02d}"
    
    @property
    def fully_complete(self) -> bool:
        return self.links_verified and self.details_verified


# ─────────────────────────────────────────────────────────────────────────────
# Worker Class
# ─────────────────────────────────────────────────────────────────────────────

class ColaWorker:
    """
    COLA scraper worker with manual month assignment.
    """
    
    def __init__(self,
                 name: str,
                 db_path: str = None,
                 headless: bool = False,
                 request_delay: float = 1.5,
                 page_timeout: int = 30,
                 max_retries: int = 3):
        
        self.name = name
        self.db_path = db_path or f"data/{name}.db"
        self.headless = headless
        self.request_delay = request_delay
        self.page_timeout = page_timeout
        self.max_retries = max_retries
        
        self.driver: Optional[webdriver.Firefox] = None
        self.conn: Optional[sqlite3.Connection] = None
        
        # Setup logging
        self._setup_logging()
        
        # Initialize database
        self._init_database()
        
        self.logger.info(f"Worker '{name}' initialized")
        self.logger.info(f"Database: {self.db_path}")
    
    def _setup_logging(self):
        """Setup logging with worker name prefix."""
        self.logger = logging.getLogger(f"cola.{self.name}")
        self.logger.setLevel(logging.INFO)
        
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(
                f'%(asctime)s | {self.name} | %(levelname)s | %(message)s',
                datefmt='%H:%M:%S'
            ))
            self.logger.addHandler(handler)
    
    def _init_database(self):
        """Initialize SQLite database."""
        os.makedirs(os.path.dirname(self.db_path) or '.', exist_ok=True)
        
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        
        self.conn.executescript("""
            -- Track progress for each month
            CREATE TABLE IF NOT EXISTS month_progress (
                id INTEGER PRIMARY KEY,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                
                -- Phase 1: Links
                expected_links INTEGER DEFAULT 0,
                collected_links INTEGER DEFAULT 0,
                links_verified INTEGER DEFAULT 0,
                links_completed_at TEXT,
                
                -- Phase 2: Details
                scraped_details INTEGER DEFAULT 0,
                details_verified INTEGER DEFAULT 0,
                details_completed_at TEXT,
                
                -- Metadata
                error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                
                UNIQUE(year, month)
            );
            
            -- Collected links from search results
            CREATE TABLE IF NOT EXISTS collected_links (
                id INTEGER PRIMARY KEY,
                ttb_id TEXT UNIQUE NOT NULL,
                detail_url TEXT NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                scraped INTEGER DEFAULT 0,
                collected_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Scraped COLA details
            CREATE TABLE IF NOT EXISTS colas (
                id INTEGER PRIMARY KEY,
                ttb_id TEXT UNIQUE NOT NULL,
                
                -- Core fields
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
                
                -- Wine-specific fields
                grape_varietal TEXT,
                wine_vintage TEXT,
                appellation TEXT,
                
                -- Other product fields
                alcohol_content TEXT,
                ph_level TEXT,
                
                -- Company info
                plant_registry TEXT,
                company_name TEXT,
                street TEXT,
                state TEXT,
                contact_person TEXT,
                phone_number TEXT,
                
                -- Metadata
                year INTEGER,
                month INTEGER,
                scraped_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_progress_ym ON month_progress(year, month);
            CREATE INDEX IF NOT EXISTS idx_links_ttb ON collected_links(ttb_id);
            CREATE INDEX IF NOT EXISTS idx_links_ym ON collected_links(year, month);
            CREATE INDEX IF NOT EXISTS idx_links_scraped ON collected_links(year, month, scraped);
            CREATE INDEX IF NOT EXISTS idx_colas_ttb ON colas(ttb_id);
            CREATE INDEX IF NOT EXISTS idx_colas_ym ON colas(year, month);
            CREATE INDEX IF NOT EXISTS idx_colas_date ON colas(approval_date);
        """)
        self.conn.commit()
    
    def _init_driver(self, max_retries: int = 3):
        """Initialize Selenium WebDriver with retry logic."""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass

        options = webdriver.FirefoxOptions()
        if self.headless:
            options.add_argument('--headless')

        last_error = None
        for attempt in range(max_retries):
            try:
                self.logger.info(f"Starting Firefox browser... (attempt {attempt + 1}/{max_retries})")
                self.driver = webdriver.Firefox(
                    service=FirefoxService(GeckoDriverManager().install()),
                    options=options
                )
                self.driver.set_page_load_timeout(self.page_timeout)
                return  # Success
            except Exception as e:
                last_error = e
                self.logger.warning(f"Firefox startup failed: {e}")
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 1)  # 5, 10, 15 seconds
                    self.logger.info(f"Retrying in {wait_time}s...")
                    time.sleep(wait_time)

        raise last_error or Exception("Failed to start Firefox after retries")
    
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
    
    # ─────────────────────────────────────────────────────────────────────────
    # CAPTCHA Handling
    # ─────────────────────────────────────────────────────────────────────────
    
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
        """Handle CAPTCHA if present. Returns True if OK to continue."""
        if not self._detect_captcha():
            return True
        
        print(f"\n{'='*60}")
        print(f"[{self.name}] CAPTCHA DETECTED!")
        print(f"{'='*60}")
        print(f"Solve the CAPTCHA in the browser window.")
        print(f"Then press ENTER to continue (or 'quit' to stop)...")
        
        try:
            response = input("> ").strip().lower()
            if response == 'quit':
                return False
            
            if self._detect_captcha():
                print(f"[{self.name}] CAPTCHA still present. Try again...")
                return self._handle_captcha()
            
            print(f"[{self.name}] [OK] CAPTCHA solved!")
            time.sleep(2)
            return True
        except EOFError:
            time.sleep(30)
            return not self._detect_captcha()
    
    # ─────────────────────────────────────────────────────────────────────────
    # TTB Search
    # ─────────────────────────────────────────────────────────────────────────
    
    # Class/Type code ranges for splitting high-volume single days
    # Split into 5 groups to handle days with >1000 filings
    # Each group covers ~2 first digits worth of codes
    CLASS_TYPE_RANGES = [
        ('0', '2zzz', 'Whisky/Gin (0-2xx)'),       # Admin, Whisky (1xx), Gin (2xx)
        ('3', '4zzz', 'Vodka/Rum (3-4xx)'),        # Vodka (3xx), Rum (4xx)
        ('5', '6zzz', 'Brandy/Cordials (5-6xx)'),  # Brandy (5xx), Cordials (6xx)
        ('7', '8zzz', 'Cocktails/Wine (7-8xx)'),   # Cocktails (7xx), Wine (8x)
        ('9', '9zzz', 'Beer/Other (9xx)'),         # Beer (9xx), Other spirits
    ]
    
    def _search_ttb(self, start_date: datetime, end_date: datetime, 
                    class_type_range: Tuple[str, str] = None) -> int:
        """
        Execute TTB search and return total matching records.
        Browser ends up on results page, ready for pagination.
        
        Args:
            start_date: Start of date range
            end_date: End of date range
            class_type_range: Optional (from_code, to_code) to filter by class/type code range
        """
        self._ensure_driver()
        
        self.driver.get(TTB_SEARCH_URL)
        self._delay()
        
        if not self._handle_captcha():
            raise Exception("CAPTCHA not solved - user quit")
        
        wait = WebDriverWait(self.driver, self.page_timeout)
        wait.until(EC.presence_of_element_located((By.NAME, 'searchCriteria.dateCompletedFrom')))
        
        # Fill date fields
        date_from = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom')
        date_from.clear()
        date_from.send_keys(start_date.strftime('%m/%d/%Y'))
        
        date_to = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo')
        date_to.clear()
        date_to.send_keys(end_date.strftime('%m/%d/%Y'))
        
        # Apply class/type code range filter if specified (for single-day overflow handling)
        if class_type_range:
            try:
                from_code, to_code = class_type_range
                
                # Find and fill the class type code range fields
                # Field names: searchCriteria.classTypeFrom and searchCriteria.classTypeTo
                class_from = self.driver.find_element(By.NAME, 'searchCriteria.classTypeFrom')
                class_from.clear()
                class_from.send_keys(from_code)
                
                class_to = self.driver.find_element(By.NAME, 'searchCriteria.classTypeTo')
                class_to.clear()
                class_to.send_keys(to_code)
                
            except Exception as e:
                self.logger.warning(f"    Could not set class/type filter: {e}")
        
        # Submit
        submit = wait.until(EC.element_to_be_clickable(
            (By.XPATH, '//input[@type="submit" and @value="Search"]')
        ))
        submit.click()
        
        self._delay()
        wait.until(lambda d: d.execute_script('return document.readyState') == 'complete')
        
        if not self._handle_captcha():
            raise Exception("CAPTCHA not solved - user quit")
        
        return self._get_total_count()
    
    def _get_total_count(self) -> int:
        """Extract 'Total Matching Records: X' from current page."""
        try:
            html = self.driver.page_source
            
            # Primary pattern
            match = re.search(r'Total Matching Records:\s*(\d+)', html)
            if match:
                return int(match.group(1))
            
            # Fallback pattern
            match = re.search(r'\d+\s+to\s+\d+\s+of\s+(\d+)', html)
            if match:
                return int(match.group(1))
            
            self.logger.warning("Could not parse total count")
            return 0
        except Exception as e:
            self.logger.error(f"Error getting total count: {e}")
            return 0
    
    def _extract_links_from_page(self) -> List[Tuple[str, str]]:
        """Extract (ttb_id, url) pairs from current results page."""
        links = []
        rows = self.driver.find_elements(By.XPATH, '//tr[@class="lt"] | //tr[@class="dk"]')
        
        for row in rows:
            try:
                anchor = row.find_element(By.TAG_NAME, 'a')
                href = anchor.get_attribute('href')
                
                if href and 'viewColaDetails' in href:
                    match = TTB_ID_PATTERN.search(href)
                    if match:
                        ttb_id = match.group(1)
                        links.append((ttb_id, href))
            except:
                continue
        
        return links
    
    def _go_to_next_page(self) -> bool:
        """Navigate to next results page. Returns False if no more pages."""
        try:
            patterns = [
                '//a[contains(@href, "pgfcn=nextset")]',
                '//a[contains(text(), "Next")]',
            ]
            
            for pattern in patterns:
                try:
                    elem = self.driver.find_element(By.XPATH, pattern)
                    if elem.is_displayed():
                        elem.click()
                        time.sleep(1)
                        WebDriverWait(self.driver, self.page_timeout).until(
                            lambda d: d.execute_script('return document.readyState') == 'complete'
                        )
                        return True
                except:
                    continue
            
            return False
        except:
            return False
    
    def _collect_all_pages(self, year: int, month: int) -> int:
        """Collect links from all pages of current search results."""
        collected = 0
        page = 1
        
        while True:
            links = self._extract_links_from_page()
            
            if not links:
                self.logger.info(f"  Page {page}: no links found, stopping")
                break
            
            # Save to database
            for ttb_id, url in links:
                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO collected_links 
                        (ttb_id, detail_url, year, month)
                        VALUES (?, ?, ?, ?)
                    """, (ttb_id, url, year, month))
                except:
                    pass
            
            self.conn.commit()
            collected += len(links)
            
            self.logger.info(f"  Page {page}: {len(links)} links (total: {collected:,})")
            
            # Next page
            if not self._go_to_next_page():
                break
            
            page += 1
            self._delay(0.5)
            
            if not self._handle_captcha():
                break
            
            # Safety limit
            if page > 100:
                self.logger.warning("  Hit 100 page safety limit")
                break
        
        return collected
    
    # ─────────────────────────────────────────────────────────────────────────
    # Phase 1: Link Collection
    # ─────────────────────────────────────────────────────────────────────────
    
    def _collect_date_range(self, start_date: datetime, end_date: datetime,
                            year: int, month: int, 
                            class_type_range: Tuple[str, str] = None) -> Tuple[int, int]:
        """
        Collect links for date range, recursively splitting if >1000 results.
        Returns (expected, collected).
        
        Splitting strategy:
        1. First, split by date (binary search down to single day)
        2. If single day still >1000, split by class/type code ranges (3 groups)
        3. If single day + code range still >1000, collect max and warn
        """
        range_str = f"{start_date.strftime('%m/%d')} - {end_date.strftime('%m/%d')}"
        filter_str = f" [codes {class_type_range[0]}-{class_type_range[1]}]" if class_type_range else ""
        self.logger.info(f"  Searching: {range_str}{filter_str}")
        
        expected = self._search_ttb(start_date, end_date, class_type_range)
        
        if expected == 0:
            self.logger.info(f"    No results")
            return 0, 0
        
        self.logger.info(f"    TTB reports: {expected:,} records")
        
        if expected >= MAX_RESULTS_PER_QUERY:
            # Need to split
            total_days = (end_date - start_date).days
            
            if total_days <= 0:
                # Single day - try splitting by class/type code if we haven't already
                if class_type_range is None:
                    self.logger.info(f"    Single day exceeds 1000 - splitting by product type")
                    
                    total_expected = 0
                    total_collected = 0
                    
                    for code_from, code_to, desc in self.CLASS_TYPE_RANGES:
                        self.logger.info(f"    → {desc} (codes {code_from}-{code_to})")
                        exp, col = self._collect_date_range(
                            start_date, end_date, year, month, 
                            class_type_range=(code_from, code_to)
                        )
                        total_expected += exp
                        total_collected += col
                    
                    return total_expected, total_collected
                else:
                    # Already filtered by code range and still >1000 - collect what we can
                    self.logger.warning(f"    [WARN] Single day + code range still exceeds 1000 - collecting max available")
                    collected = self._collect_all_pages(year, month)
                    return expected, collected
            
            # Multiple days - split in half
            mid_date = start_date + timedelta(days=total_days // 2)
            self.logger.info(f"    Splitting dates: {start_date.date()} to {mid_date.date()} | {(mid_date + timedelta(days=1)).date()} to {end_date.date()}")
            
            exp1, col1 = self._collect_date_range(start_date, mid_date, year, month, class_type_range)
            exp2, col2 = self._collect_date_range(mid_date + timedelta(days=1), end_date, year, month, class_type_range)
            
            return exp1 + exp2, col1 + col2
        
        # Under 1000 - collect all pages
        collected = self._collect_all_pages(year, month)
        return expected, collected
    
    def collect_links(self, year: int, month: int) -> MonthResult:
        """
        Phase 1: Collect all links for a month.
        Verifies count matches TTB's reported total.
        
        Smart resume: If we already have links collected, check if they're enough.
        Only re-collects if verification failed.
        """
        self._ensure_driver()
        
        result = MonthResult(year=year, month=month)
        
        self.logger.info(f"")
        self.logger.info(f"{'='*60}")
        self.logger.info(f"PHASE 1: Collecting links for {result.month_str}")
        self.logger.info(f"{'='*60}")
        
        try:
            # Get month date range
            start_date = datetime(year, month, 1)
            last_day = monthrange(year, month)[1]
            end_date = datetime(year, month, last_day)
            
            # Check what we already have in database
            existing_links = self.conn.execute(
                "SELECT COUNT(*) FROM collected_links WHERE year = ? AND month = ?",
                (year, month)
            ).fetchone()[0]
            
            # Get the total expected count from TTB
            total_expected = self._search_ttb(start_date, end_date)
            result.expected_links = total_expected
            
            self.logger.info(f"TTB total for {result.month_str}: {total_expected:,}")
            self.logger.info(f"Already have: {existing_links:,} links")
            
            if total_expected == 0:
                result.links_verified = True
                self._save_progress(result)
                self.logger.info(f"[OK] No records for this month")
                return result
            
            # Check if we already have enough links
            if existing_links >= total_expected * VERIFICATION_TOLERANCE:
                result.collected_links = existing_links
                result.links_verified = True
                self._save_progress(result)
                self.logger.info(f"[OK] LINKS ALREADY COMPLETE: {existing_links:,} / {total_expected:,}")
                return result
            
            # Need to collect more - do full collection (INSERT OR IGNORE handles duplicates)
            self.logger.info(f"Need more links, collecting...")
            expected, collected = self._collect_date_range(start_date, end_date, year, month)
            
            # Get actual unique count from database
            actual = self.conn.execute(
                "SELECT COUNT(*) FROM collected_links WHERE year = ? AND month = ?",
                (year, month)
            ).fetchone()[0]
            
            result.collected_links = actual
            
            # Verify
            if actual >= total_expected * VERIFICATION_TOLERANCE:
                result.links_verified = True
                self.logger.info(f"[OK] LINKS VERIFIED: {actual:,} / {total_expected:,}")
            else:
                missing = total_expected - actual
                result.error = f"Links mismatch: {actual} vs {total_expected} (missing {missing})"
                self.logger.error(f"[FAIL] LINKS MISMATCH: {actual:,} / {total_expected:,} (missing {missing:,})")
            
            self._save_progress(result)
            
        except Exception as e:
            result.error = str(e)
            self.logger.error(f"Error collecting links: {e}")
            self._save_progress(result)
        
        return result
    
    # ─────────────────────────────────────────────────────────────────────────
    # Phase 2: Detail Scraping
    # ─────────────────────────────────────────────────────────────────────────
    
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
                
                # Wine-specific fields
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

                # Parse approval_date into year, month, day for indexed queries
                if data.get('approval_date'):
                    parts = data['approval_date'].split('/')
                    if len(parts) == 3:
                        try:
                            data['month'] = int(parts[0])
                            data['day'] = int(parts[1])
                            data['year'] = int(parts[2])
                        except ValueError:
                            pass  # Leave as None if parsing fails

                return data
                
            except TimeoutException:
                if attempt < self.max_retries - 1:
                    self.logger.warning(f"    Timeout, retry {attempt + 1}")
                    time.sleep(2)
                else:
                    self.logger.error(f"    Failed after {self.max_retries} retries")
                    return None
            except Exception as e:
                self.logger.error(f"    Error: {e}")
                return None
        
        return None
    
    def _extract_field(self, soup: BeautifulSoup, label: str) -> Optional[str]:
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
    
    def _extract_company_details(self, soup: BeautifulSoup) -> Dict:
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
    
    def scrape_details(self, year: int, month: int) -> MonthResult:
        """
        Phase 2: Scrape details for all collected links.
        Verifies count matches collected links.
        
        Resume-safe: Only scrapes links where scraped=0 in collected_links table.
        """
        self._ensure_driver()
        
        # Get existing progress
        result = self._get_progress(year, month)
        if not result:
            result = MonthResult(year=year, month=month)
        
        self.logger.info(f"")
        self.logger.info(f"{'='*60}")
        self.logger.info(f"PHASE 2: Scraping details for {result.month_str}")
        self.logger.info(f"{'='*60}")
        
        # Get actual link count from database (not from saved progress)
        total_links = self.conn.execute(
            "SELECT COUNT(*) FROM collected_links WHERE year = ? AND month = ?",
            (year, month)
        ).fetchone()[0]
        
        if total_links == 0:
            self.logger.error(f"No links found for {result.month_str}. Run Phase 1 first.")
            result.error = "No links - run Phase 1 first"
            return result
        
        result.collected_links = total_links
        result.expected_details = total_links
        
        try:
            # Get unscraped links (scraped = 0)
            cursor = self.conn.execute("""
                SELECT ttb_id, detail_url 
                FROM collected_links
                WHERE year = ? AND month = ? AND scraped = 0
            """, (year, month))
            links = cursor.fetchall()
            
            to_scrape = len(links)
            already_done = total_links - to_scrape
            
            self.logger.info(f"Total links: {total_links:,}")
            self.logger.info(f"Already scraped: {already_done:,}")
            self.logger.info(f"Remaining to scrape: {to_scrape:,}")
            
            if to_scrape == 0:
                # Already done
                scraped = self.conn.execute(
                    "SELECT COUNT(*) FROM colas WHERE year = ? AND month = ?",
                    (year, month)
                ).fetchone()[0]
                
                result.scraped_details = scraped
                
                if scraped >= result.expected_details * VERIFICATION_TOLERANCE:
                    result.details_verified = True
                    self.logger.info(f"[OK] Already complete: {scraped:,} details")
                
                self._save_progress(result)
                return result
            
            # Scrape each link
            scraped = 0
            failed = 0
            
            for i, (ttb_id, url) in enumerate(links):
                # Log every scrape with TTB ID
                self.logger.info(f"  [{i+1+already_done}/{total_links}] {ttb_id}")
                
                data = self._scrape_detail_page(ttb_id, url)
                
                if data:
                    try:
                        self.conn.execute("""
                            INSERT OR REPLACE INTO colas
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
                        
                        # Mark as scraped so we don't re-scrape on resume
                        self.conn.execute(
                            "UPDATE collected_links SET scraped = 1 WHERE ttb_id = ?",
                            (ttb_id,)
                        )
                        self.conn.commit()
                        scraped += 1
                        
                    except Exception as e:
                        self.logger.error(f"    DB error: {e}")
                        failed += 1
                else:
                    self.logger.warning(f"    Failed to scrape")
                    failed += 1
                
                self._delay(0.5)
                
                # Progress summary every 100
                if (i + 1) % 100 == 0:
                    self.logger.info(f"  Progress: {i+1+already_done:,}/{total_links:,} ({scraped:,} OK, {failed:,} failed)")
            
            # Final count
            total_scraped = self.conn.execute(
                "SELECT COUNT(*) FROM colas WHERE year = ? AND month = ?",
                (year, month)
            ).fetchone()[0]
            
            result.scraped_details = total_scraped
            
            # Verify
            if total_scraped >= result.expected_details * VERIFICATION_TOLERANCE:
                result.details_verified = True
                self.logger.info(f"[OK] DETAILS VERIFIED: {total_scraped:,} / {result.expected_details:,}")
            else:
                missing = result.expected_details - total_scraped
                result.error = f"Details mismatch: {total_scraped} vs {result.expected_details}"
                self.logger.error(f"[FAIL] DETAILS MISMATCH: {total_scraped:,} / {result.expected_details:,} (missing {missing:,})")
            
            self._save_progress(result)
            
        except Exception as e:
            result.error = str(e)
            self.logger.error(f"Error scraping details: {e}")
            self._save_progress(result)
        
        return result
    
    # ─────────────────────────────────────────────────────────────────────────
    # Progress Tracking
    # ─────────────────────────────────────────────────────────────────────────
    
    def _get_progress(self, year: int, month: int) -> Optional[MonthResult]:
        """Get existing progress for a month."""
        row = self.conn.execute(
            "SELECT * FROM month_progress WHERE year = ? AND month = ?",
            (year, month)
        ).fetchone()
        
        if not row:
            return None
        
        return MonthResult(
            year=row['year'],
            month=row['month'],
            expected_links=row['expected_links'],
            collected_links=row['collected_links'],
            links_verified=bool(row['links_verified']),
            scraped_details=row['scraped_details'],
            details_verified=bool(row['details_verified']),
            error=row['error']
        )
    
    def _save_progress(self, result: MonthResult):
        """Save progress for a month."""
        now = datetime.now().isoformat()
        
        self.conn.execute("""
            INSERT OR REPLACE INTO month_progress
            (year, month, expected_links, collected_links, links_verified,
             scraped_details, details_verified, error, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            result.year, result.month, result.expected_links,
            result.collected_links, 1 if result.links_verified else 0,
            result.scraped_details, 1 if result.details_verified else 0,
            result.error, now
        ))
        self.conn.commit()
    
    # ─────────────────────────────────────────────────────────────────────────
    # Main Entry Points
    # ─────────────────────────────────────────────────────────────────────────
    
    def process_month(self, year: int, month: int,
                      links_only: bool = False,
                      details_only: bool = False) -> MonthResult:
        """
        Process a single month (Phase 1 + Phase 2).
        """
        self._ensure_driver()
        
        result = self._get_progress(year, month) or MonthResult(year=year, month=month)
        
        # Phase 1: Links
        if not details_only:
            if result.links_verified:
                self.logger.info(f"Skipping links for {result.month_str} (already verified)")
            else:
                result = self.collect_links(year, month)
                
                if not result.links_verified and result.expected_links > 0:
                    self.logger.error(f"Link collection failed for {result.month_str}")
                    return result
        
        # Phase 2: Details
        if not links_only:
            if result.details_verified:
                self.logger.info(f"Skipping details for {result.month_str} (already verified)")
            else:
                result = self.scrape_details(year, month)
        
        return result
    
    def process_months(self, months: List[Tuple[int, int]],
                       links_only: bool = False,
                       details_only: bool = False) -> List[MonthResult]:
        """
        Process multiple months.
        months: List of (year, month) tuples
        """
        self._ensure_driver()
        
        self.logger.info(f"")
        self.logger.info(f"{'#'*60}")
        self.logger.info(f"WORKER: {self.name}")
        self.logger.info(f"Months to process: {len(months)}")
        for year, month in months:
            self.logger.info(f"  - {year}-{month:02d}")
        self.logger.info(f"{'#'*60}")
        
        results = []
        
        for year, month in months:
            result = self.process_month(year, month, links_only, details_only)
            results.append(result)
            
            # Stop on unrecoverable error (optional - you might want to continue)
            if result.error and not result.links_verified and result.expected_links > 0:
                self.logger.warning(f"Stopping due to error in {result.month_str}")
                break
        
        self._print_summary(results)
        return results
    
    def process_date_range(self, start_date: datetime, end_date: datetime,
                           links_only: bool = False,
                           details_only: bool = False) -> dict:
        """
        Process a custom date range (can be single day or span months).
        Returns summary dict with collected/scraped counts.
        """
        self._ensure_driver()

        date_str = start_date.strftime('%Y-%m-%d')
        if start_date != end_date:
            date_str = f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}"

        self.logger.info(f"")
        self.logger.info(f"{'#'*60}")
        self.logger.info(f"WORKER: {self.name}")
        self.logger.info(f"Date range: {date_str}")
        self.logger.info(f"{'#'*60}")

        # Use the start date's year/month for storage
        year = start_date.year
        month = start_date.month

        result = {
            'start_date': start_date,
            'end_date': end_date,
            'expected_links': 0,
            'collected_links': 0,
            'scraped_details': 0,
            'links_verified': False,
            'details_verified': False,
            'error': None
        }

        try:
            # Phase 1: Collect links
            if not details_only:
                self.logger.info(f"")
                self.logger.info(f"{'='*60}")
                self.logger.info(f"PHASE 1: Collecting links for {date_str}")
                self.logger.info(f"{'='*60}")

                expected, collected = self._collect_date_range(start_date, end_date, year, month)

                # Get actual count from DB
                actual = self.conn.execute(
                    "SELECT COUNT(*) FROM collected_links WHERE year = ? AND month = ?",
                    (year, month)
                ).fetchone()[0]

                result['expected_links'] = expected
                result['collected_links'] = actual

                if actual >= expected * VERIFICATION_TOLERANCE:
                    result['links_verified'] = True
                    self.logger.info(f"[OK] LINKS VERIFIED: {actual:,} / {expected:,}")
                else:
                    result['error'] = f"Links mismatch: {actual} vs {expected}"
                    self.logger.error(f"[FAIL] LINKS MISMATCH: {actual:,} / {expected:,}")

            # Phase 2: Scrape details
            if not links_only:
                if details_only or result.get('links_verified', False) or result['expected_links'] == 0:
                    detail_result = self.scrape_details(year, month)
                    result['scraped_details'] = detail_result.scraped_details
                    result['details_verified'] = detail_result.details_verified
                    if detail_result.error:
                        result['error'] = detail_result.error

        except Exception as e:
            result['error'] = str(e)
            self.logger.error(f"Error processing date range: {e}")

        # Print summary
        self._print_date_summary(result)

        return result

    def _print_date_summary(self, result: dict):
        """Print date range processing summary."""
        print(f"\n{'='*60}")
        print(f"SUMMARY - {self.name}")
        print(f"{'='*60}")

        start = result['start_date'].strftime('%Y-%m-%d')
        end = result['end_date'].strftime('%Y-%m-%d')
        date_str = start if start == end else f"{start} to {end}"

        links_icon = "[OK]" if result['links_verified'] else "[FAIL]"
        details_icon = "[OK]" if result['details_verified'] else "[FAIL]"

        print(f"  Date: {date_str}")
        print(f"  Links:   {links_icon} {result['collected_links']:,} / {result['expected_links']:,}")
        print(f"  Details: {details_icon} {result['scraped_details']:,}")

        if result['error']:
            print(f"  Error: {result['error']}")

        print(f"{'='*60}\n")

    def _print_summary(self, results: List[MonthResult]):
        """Print processing summary."""
        print(f"\n{'='*60}")
        print(f"SUMMARY - {self.name}")
        print(f"{'='*60}")
        
        total_expected = 0
        total_collected = 0
        total_scraped = 0
        
        for r in results:
            links_icon = "[OK]" if r.links_verified else "[FAIL]"
            details_icon = "[OK]" if r.details_verified else "[FAIL]"
            
            print(f"  {r.month_str}: Links {links_icon} {r.collected_links:,}/{r.expected_links:,} | Details {details_icon} {r.scraped_details:,}")
            
            total_expected += r.expected_links
            total_collected += r.collected_links
            total_scraped += r.scraped_details
        
        print(f"")
        print(f"  Total Expected:  {total_expected:,}")
        print(f"  Total Collected: {total_collected:,}")
        print(f"  Total Scraped:   {total_scraped:,}")
        print(f"{'='*60}\n")
    
    def status(self):
        """Print database status."""
        print(f"\n{'='*60}")
        print(f"STATUS - {self.name}")
        print(f"Database: {self.db_path}")
        print(f"{'='*60}")
        
        # Month progress
        rows = self.conn.execute("""
            SELECT * FROM month_progress ORDER BY year DESC, month DESC
        """).fetchall()
        
        if rows:
            print(f"\nMonth Progress:")
            for row in rows:
                links_icon = "[OK]" if row['links_verified'] else "[FAIL]"
                details_icon = "[OK]" if row['details_verified'] else "[FAIL]"
                err = f" ERR: {row['error'][:30]}..." if row['error'] else ""
                print(f"  {row['year']}-{row['month']:02d}: Links {links_icon} {row['collected_links']:,}/{row['expected_links']:,} | Details {details_icon} {row['scraped_details']:,}{err}")
        else:
            print(f"\nNo month progress yet.")
        
        # Totals
        links = self.conn.execute("SELECT COUNT(*) FROM collected_links").fetchone()[0]
        colas = self.conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
        
        print(f"\nTotals:")
        print(f"  Links: {links:,}")
        print(f"  COLAs: {colas:,}")
        print(f"{'='*60}\n")


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def parse_month(s: str) -> Tuple[int, int]:
    """Parse 'YYYY-MM' string to (year, month) tuple."""
    parts = s.split('-')
    if len(parts) != 2:
        raise ValueError(f"Invalid month format: {s}. Use YYYY-MM")
    return int(parts[0]), int(parts[1])


def parse_date(s: str) -> datetime:
    """Parse date string in various formats."""
    # Try different formats
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


def generate_month_range(start: str, end: str) -> List[Tuple[int, int]]:
    """Generate list of (year, month) tuples from start to end inclusive."""
    start_year, start_month = parse_month(start)
    end_year, end_month = parse_month(end)
    
    months = []
    year, month = start_year, start_month
    
    while (year, month) <= (end_year, end_month):
        months.append((year, month))
        
        month += 1
        if month > 12:
            month = 1
            year += 1
    
    return months


def generate_year_months(year: int) -> List[Tuple[int, int]]:
    """Generate all months for a year (up to current month if current year)."""
    now = datetime.now()
    months = []
    
    for month in range(1, 13):
        if year > now.year:
            continue
        if year == now.year and month > now.month:
            continue
        months.append((year, month))
    
    return months


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='COLA Scraper Worker - Manual Month Assignment',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single month
  python cola_worker.py --name w1 --months 2025-01
  
  # Multiple specific months
  python cola_worker.py --name w1 --months 2025-01 2025-02 2025-03
  
  # Range of months
  python cola_worker.py --name w1 --range 2025-01 2025-06
  
  # Full year
  python cola_worker.py --name w1 --year 2025
  
  # Links only (Phase 1)
  python cola_worker.py --name w1 --months 2025-01 --links-only
  
  # Details only (Phase 2)
  python cola_worker.py --name w1 --months 2025-01 --details-only
  
  # Status
  python cola_worker.py --name w1 --status

Parallel Example (4 terminals):
  Terminal 1: python cola_worker.py --name w1 --months 2025-01 2025-02 2025-03
  Terminal 2: python cola_worker.py --name w2 --months 2025-04 2025-05 2025-06
  Terminal 3: python cola_worker.py --name w3 --months 2025-07 2025-08 2025-09
  Terminal 4: python cola_worker.py --name w4 --months 2025-10 2025-11
        """
    )
    
    parser.add_argument('--name', required=True, 
                        help='Worker name (used for database filename)')
    parser.add_argument('--months', nargs='+', metavar='YYYY-MM',
                        help='Specific months to process')
    parser.add_argument('--range', nargs=2, metavar=('START', 'END'),
                        help='Range of months (e.g., --range 2025-01 2025-06)')
    parser.add_argument('--year', type=int,
                        help='Process entire year')
    parser.add_argument('--date', metavar='DATE',
                        help='Single date (e.g., 2026-01-05 or 01/05/2026)')
    parser.add_argument('--dates', nargs=2, metavar=('START', 'END'),
                        help='Date range (e.g., --dates 2026-01-01 2026-01-07)')
    parser.add_argument('--db',
                        help='Database path (default: data/{name}.db)')
    parser.add_argument('--links-only', action='store_true',
                        help='Only collect links (Phase 1)')
    parser.add_argument('--details-only', action='store_true',
                        help='Only scrape details (Phase 2)')
    parser.add_argument('--headless', action='store_true',
                        help='Run browser in headless mode')
    parser.add_argument('--status', action='store_true',
                        help='Show database status')
    
    args = parser.parse_args()
    
    # Create worker
    worker = ColaWorker(
        name=args.name,
        db_path=args.db,
        headless=args.headless
    )
    
    try:
        if args.status:
            worker.status()
            return
        
        # Determine months to process
        months = []
        
        if args.months:
            months = [parse_month(m) for m in args.months]
        elif args.range:
            months = generate_month_range(args.range[0], args.range[1])
        elif args.year:
            months = generate_year_months(args.year)
        else:
            parser.print_help()
            return
        
        if not months:
            print("No months to process")
            return
        
        # Process
        worker.process_months(
            months,
            links_only=args.links_only,
            details_only=args.details_only
        )
        
    finally:
        worker.close()


if __name__ == '__main__':
    main()
