#!/usr/bin/env python3
"""
completed_date_scraper.py - Scrape "Date Completed" from TTB search results

This script extracts the completed_date field from TTB search results pages.
It uses the same search/pagination logic as cola_worker.py but only collects
TTB ID + completed_date pairs (no detail page scraping needed).

USAGE:
    # Scrape specific month
    python completed_date_scraper.py --months 2025-01

    # Scrape range of months
    python completed_date_scraper.py --range 2020-01 2025-12

    # Scrape full year
    python completed_date_scraper.py --year 2024

    # Resume from where you left off
    python completed_date_scraper.py --range 2020-01 2025-12

    # Check progress
    python completed_date_scraper.py --status

OUTPUT:
    Stores ttb_id + completed_date pairs in data/completed_dates.db
"""

import os
import re
import sys
import time
import sqlite3
import logging
import argparse
from datetime import datetime, timedelta
from calendar import monthrange
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import dataclass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.firefox import GeckoDriverManager

# =============================================================================
# CONFIGURATION
# =============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"

DB_PATH = str(DATA_DIR / "completed_dates.db")
LOG_FILE = str(LOGS_DIR / "completed_date_scraper.log")

TTB_SEARCH_URL = "https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do"
MAX_RESULTS_PER_QUERY = 1000
TTB_ID_PATTERN = re.compile(r'ttbid=(\d+)')

# Class/type code ranges for splitting large result sets
CLASS_TYPE_RANGES = [
    ('000', '399'),
    ('400', '699'),
    ('700', '999'),
]

# =============================================================================
# LOGGING
# =============================================================================

def setup_logging(verbose: bool = False) -> logging.Logger:
    os.makedirs(LOGS_DIR, exist_ok=True)

    level = logging.DEBUG if verbose else logging.INFO

    # Create logger
    logger = logging.getLogger('completed_date_scraper')
    logger.setLevel(level)

    # Clear existing handlers
    logger.handlers = []

    # File handler
    fh = logging.FileHandler(LOG_FILE, encoding='utf-8')
    fh.setLevel(level)
    fh.setFormatter(logging.Formatter('%(asctime)s | %(levelname)s | %(message)s'))
    logger.addHandler(fh)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(level)
    ch.setFormatter(logging.Formatter('%(asctime)s | %(levelname)s | %(message)s'))
    logger.addHandler(ch)

    return logger

logger = setup_logging()

# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class MonthProgress:
    year: int
    month: int
    expected_records: int = 0
    collected_records: int = 0
    completed: bool = False
    error: str = None

    @property
    def month_str(self) -> str:
        return f"{self.year}-{self.month:02d}"

# =============================================================================
# MAIN SCRAPER CLASS
# =============================================================================

class CompletedDateScraper:
    """Scraper for extracting completed_date from TTB search results."""

    def __init__(self, db_path: str = DB_PATH, headless: bool = True):
        self.db_path = db_path
        self.headless = headless
        self.driver = None
        self.conn = None
        self.page_timeout = 30

        self._init_database()
        logger.info(f"Database: {self.db_path}")

    def _init_database(self):
        """Initialize SQLite database for storing results."""
        os.makedirs(DATA_DIR, exist_ok=True)

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row

        self.conn.executescript("""
            -- Store ttb_id + completed_date pairs
            CREATE TABLE IF NOT EXISTS completed_dates (
                ttb_id TEXT PRIMARY KEY,
                completed_date TEXT NOT NULL
            );

            -- Track progress by month
            CREATE TABLE IF NOT EXISTS month_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                expected_records INTEGER DEFAULT 0,
                collected_records INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,
                error TEXT,
                UNIQUE(year, month)
            );

            CREATE INDEX IF NOT EXISTS idx_completed_dates_ttb ON completed_dates(ttb_id);
            CREATE INDEX IF NOT EXISTS idx_progress_ym ON month_progress(year, month);
        """)
        self.conn.commit()

    def _start_browser(self):
        """Start Firefox browser."""
        if self.driver:
            return

        logger.info("Starting Firefox browser...")

        options = FirefoxOptions()
        if self.headless:
            options.add_argument('--headless')

        options.set_preference('permissions.default.image', 2)  # Disable images
        options.set_preference('dom.ipc.plugins.enabled.libflashplayer.so', False)

        service = FirefoxService(GeckoDriverManager().install())
        self.driver = webdriver.Firefox(service=service, options=options)
        self.driver.set_page_load_timeout(self.page_timeout)

    def _close_browser(self):
        """Close browser."""
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
            self.driver = None

    def close(self):
        """Clean up resources."""
        self._close_browser()
        if self.conn:
            self.conn.close()
            self.conn = None

    def _delay(self, seconds: float = 1.0):
        """Polite delay between requests."""
        time.sleep(seconds)

    def _detect_captcha(self) -> bool:
        """Check if CAPTCHA is present."""
        try:
            page_source = self.driver.page_source.lower()
            return 'captcha' in page_source or 'robot' in page_source
        except:
            return False

    def _handle_captcha(self) -> bool:
        """Handle CAPTCHA if present. Returns True if OK to continue."""
        if not self._detect_captcha():
            return True

        print(f"\n{'='*60}")
        print("CAPTCHA DETECTED!")
        print(f"{'='*60}")
        print("Solve the CAPTCHA in the browser window.")
        print("Then press ENTER to continue (or 'quit' to stop)...")

        try:
            response = input().strip().lower()
            if response == 'quit':
                return False
            print("[OK] CAPTCHA solved!")
            return True
        except:
            return False

    def _search_ttb(self, start_date: datetime, end_date: datetime,
                    class_type_range: Tuple[str, str] = None) -> int:
        """
        Execute TTB search and return total result count.
        """
        self._start_browser()

        try:
            self.driver.get(TTB_SEARCH_URL)
            self._delay(1)

            if not self._handle_captcha():
                return -1

            wait = WebDriverWait(self.driver, self.page_timeout)
            wait.until(EC.presence_of_element_located((By.NAME, "searchCriteria.dateCompletedFrom")))

            # Fill date range
            date_from = self.driver.find_element(By.NAME, "searchCriteria.dateCompletedFrom")
            date_from.clear()
            date_from.send_keys(start_date.strftime("%m/%d/%Y"))

            date_to = self.driver.find_element(By.NAME, "searchCriteria.dateCompletedTo")
            date_to.clear()
            date_to.send_keys(end_date.strftime("%m/%d/%Y"))

            # Fill class/type code range if specified
            if class_type_range:
                try:
                    code_from = self.driver.find_element(By.NAME, "searchCriteria.classTypeFrom")
                    code_from.clear()
                    code_from.send_keys(class_type_range[0])

                    code_to = self.driver.find_element(By.NAME, "searchCriteria.classTypeTo")
                    code_to.clear()
                    code_to.send_keys(class_type_range[1])
                except Exception as e:
                    logger.warning(f"Could not set class/type filter: {e}")

            # Submit search
            submit = wait.until(EC.element_to_be_clickable(
                (By.XPATH, '//input[@type="submit" and @value="Search"]')
            ))
            submit.click()

            self._delay(1)
            wait.until(lambda d: d.execute_script('return document.readyState') == 'complete')

            if not self._handle_captcha():
                return -1

            # Get total count (same logic as cola_worker.py)
            return self._get_total_count()

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return -1

    def _get_total_count(self) -> int:
        """Extract 'Total Matching Records: X' from current page. Same logic as cola_worker.py."""
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

            logger.warning("Could not parse total count")
            return 0
        except Exception as e:
            logger.error(f"Error getting total count: {e}")
            return 0

    def _extract_from_page(self) -> List[Tuple[str, str]]:
        """
        Extract (ttb_id, completed_date) pairs from current results page.
        Completed date is in the 4th column (index 3) of each row.
        """
        results = []
        rows = self.driver.find_elements(By.XPATH, '//tr[@class="lt"] | //tr[@class="dk"]')

        for row in rows:
            try:
                # Get TTB ID from anchor
                anchor = row.find_element(By.TAG_NAME, 'a')
                href = anchor.get_attribute('href')

                if not href or 'viewColaDetails' not in href:
                    continue

                match = TTB_ID_PATTERN.search(href)
                if not match:
                    continue

                ttb_id = match.group(1)

                # Get completed_date from 4th column (index 3)
                cells = row.find_elements(By.TAG_NAME, 'td')
                if len(cells) >= 4:
                    completed_date = cells[3].text.strip()
                    if completed_date:
                        results.append((ttb_id, completed_date))

            except Exception as e:
                continue

        return results

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

    def _collect_all_pages(self) -> int:
        """Collect completed dates from all pages of current search results."""
        collected = 0
        page = 1

        while True:
            results = self._extract_from_page()

            if not results:
                logger.info(f"    Page {page}: no results found, stopping")
                break

            # Save to database
            for ttb_id, completed_date in results:
                try:
                    self.conn.execute("""
                        INSERT OR REPLACE INTO completed_dates (ttb_id, completed_date)
                        VALUES (?, ?)
                    """, (ttb_id, completed_date))
                except:
                    pass

            self.conn.commit()
            collected += len(results)

            logger.info(f"    Page {page}: {len(results)} records (total: {collected:,})")

            # Next page
            if not self._go_to_next_page():
                break

            page += 1
            self._delay(0.5)

            if not self._handle_captcha():
                break

            # Safety limit
            if page > 100:
                logger.warning("    Hit 100 page safety limit")
                break

        return collected

    def _collect_date_range(self, start_date: datetime, end_date: datetime,
                            class_type_range: Tuple[str, str] = None) -> Tuple[int, int]:
        """
        Collect completed dates for date range, recursively splitting if >1000 results.
        Returns (expected, collected).
        """
        range_str = f"{start_date.strftime('%m/%d/%Y')} - {end_date.strftime('%m/%d/%Y')}"
        filter_str = f" [codes {class_type_range[0]}-{class_type_range[1]}]" if class_type_range else ""
        logger.info(f"  Searching: {range_str}{filter_str}")

        expected = self._search_ttb(start_date, end_date, class_type_range)

        if expected == 0:
            logger.info(f"    No results")
            return 0, 0

        if expected < 0:
            logger.error(f"    Search failed")
            return 0, 0

        logger.info(f"    TTB reports: {expected:,} records")

        if expected >= MAX_RESULTS_PER_QUERY:
            # Need to split
            total_days = (end_date - start_date).days

            if total_days <= 0:
                # Single day - try splitting by class/type code
                if class_type_range is None:
                    logger.info(f"    Splitting single day by class/type code...")
                    total_exp = 0
                    total_col = 0
                    for code_range in CLASS_TYPE_RANGES:
                        exp, col = self._collect_date_range(start_date, end_date, code_range)
                        total_exp += exp
                        total_col += col
                    return total_exp, total_col
                else:
                    # Already split by code, just collect what we can
                    logger.warning(f"    Still >{MAX_RESULTS_PER_QUERY} results, collecting available")
                    collected = self._collect_all_pages()
                    return expected, collected
            else:
                # Split date range in half
                mid_date = start_date + timedelta(days=total_days // 2)
                logger.info(f"    Splitting date range at {mid_date.strftime('%m/%d/%Y')}...")

                exp1, col1 = self._collect_date_range(start_date, mid_date, class_type_range)
                exp2, col2 = self._collect_date_range(mid_date + timedelta(days=1), end_date, class_type_range)
                return exp1 + exp2, col1 + col2

        # Under limit, collect all pages
        collected = self._collect_all_pages()
        return expected, collected

    def _get_progress(self, year: int, month: int) -> Optional[MonthProgress]:
        """Get existing progress for a month."""
        row = self.conn.execute(
            "SELECT * FROM month_progress WHERE year = ? AND month = ?",
            (year, month)
        ).fetchone()

        if row:
            return MonthProgress(
                year=row['year'],
                month=row['month'],
                expected_records=row['expected_records'],
                collected_records=row['collected_records'],
                completed=bool(row['completed']),
                error=row['error']
            )
        return None

    def _save_progress(self, progress: MonthProgress):
        """Save progress for a month."""
        self.conn.execute("""
            INSERT OR REPLACE INTO month_progress
            (year, month, expected_records, collected_records, completed, error)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            progress.year, progress.month,
            progress.expected_records, progress.collected_records,
            1 if progress.completed else 0, progress.error
        ))
        self.conn.commit()

    def process_month(self, year: int, month: int, force: bool = False) -> MonthProgress:
        """Process a single month."""
        progress = self._get_progress(year, month)

        if progress and progress.completed and not force:
            logger.info(f"Skipping {progress.month_str} (already completed)")
            return progress

        progress = MonthProgress(year=year, month=month)

        logger.info(f"\n{'='*60}")
        logger.info(f"Processing {progress.month_str}")
        logger.info(f"{'='*60}")

        try:
            # Get month date range
            start_date = datetime(year, month, 1)
            last_day = monthrange(year, month)[1]
            end_date = datetime(year, month, last_day)

            expected, collected = self._collect_date_range(start_date, end_date)

            progress.expected_records = expected
            progress.collected_records = collected
            progress.completed = True

            logger.info(f"\n[OK] {progress.month_str}: {collected:,} / {expected:,} records")

        except Exception as e:
            progress.error = str(e)
            logger.error(f"Error processing {progress.month_str}: {e}")

        self._save_progress(progress)
        return progress

    def process_months(self, months: List[Tuple[int, int]], force: bool = False) -> List[MonthProgress]:
        """Process multiple months."""
        results = []

        logger.info(f"\nMonths to process: {len(months)}")
        for year, month in months:
            logger.info(f"  - {year}-{month:02d}")

        self._start_browser()

        try:
            for year, month in months:
                result = self.process_month(year, month, force)
                results.append(result)

                if result.error:
                    logger.warning(f"Error in {result.month_str}, continuing...")
        finally:
            self._close_browser()

        return results

    def show_status(self):
        """Show current progress."""
        print(f"\n{'='*60}")
        print("COMPLETED DATE SCRAPER - STATUS")
        print(f"{'='*60}")

        # Total records
        total = self.conn.execute("SELECT COUNT(*) FROM completed_dates").fetchone()[0]
        print(f"\nTotal records collected: {total:,}")

        # Progress by month
        rows = self.conn.execute("""
            SELECT * FROM month_progress ORDER BY year DESC, month DESC
        """).fetchall()

        if rows:
            print(f"\nMonth progress:")
            for row in rows:
                status = "[OK]" if row['completed'] else "[...]"
                err = f" ERROR: {row['error']}" if row['error'] else ""
                print(f"  {row['year']}-{row['month']:02d}: {status} {row['collected_records']:,}/{row['expected_records']:,}{err}")
        else:
            print("\nNo months processed yet.")

        print()

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_month(s: str) -> Tuple[int, int]:
    """Parse 'YYYY-MM' string to (year, month) tuple."""
    parts = s.split('-')
    if len(parts) != 2:
        raise ValueError(f"Invalid month format: {s}. Use YYYY-MM")
    return int(parts[0]), int(parts[1])


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
            break
        if year == now.year and month > now.month:
            break
        months.append((year, month))

    return months

# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Scrape completed dates from TTB search results',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape specific month
  python completed_date_scraper.py --months 2025-01

  # Scrape multiple months
  python completed_date_scraper.py --months 2025-01 2025-02 2025-03

  # Scrape range of months
  python completed_date_scraper.py --range 2020-01 2025-12

  # Scrape full year
  python completed_date_scraper.py --year 2024

  # Force re-scrape already completed months
  python completed_date_scraper.py --range 2025-01 2025-06 --force

  # Check progress
  python completed_date_scraper.py --status

  # Run with visible browser (for debugging)
  python completed_date_scraper.py --months 2025-01 --no-headless
        """
    )

    parser.add_argument('--months', nargs='+', metavar='YYYY-MM',
                        help='Specific months to process')
    parser.add_argument('--range', nargs=2, metavar=('START', 'END'),
                        help='Range of months (e.g., --range 2020-01 2025-12)')
    parser.add_argument('--year', type=int,
                        help='Process entire year')
    parser.add_argument('--force', action='store_true',
                        help='Force re-scrape already completed months')
    parser.add_argument('--status', action='store_true',
                        help='Show current progress and exit')
    parser.add_argument('--no-headless', action='store_true',
                        help='Show browser window (for debugging)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Enable verbose output')

    args = parser.parse_args()

    if args.verbose:
        global logger
        logger = setup_logging(verbose=True)

    headless = not args.no_headless

    scraper = CompletedDateScraper(headless=headless)

    try:
        if args.status:
            scraper.show_status()
            return

        # Determine months to process
        months = []

        if args.months:
            months = [parse_month(m) for m in args.months]
        elif args.range:
            months = generate_month_range(args.range[0], args.range[1])
        elif args.year:
            months = generate_year_months(args.year)

        if not months:
            print("No months specified. Use --months, --range, or --year")
            print("Use --status to check progress")
            print("Use --help for more options")
            return

        scraper.process_months(months, force=args.force)
        scraper.show_status()

    finally:
        scraper.close()


if __name__ == '__main__':
    main()
