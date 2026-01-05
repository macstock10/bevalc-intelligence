"""
scraper.py - Main scraper for BevAlc Intelligence

Handles:
- Link collection from TTB search results (resumable)
- Detail page scraping (resumable)
- Image URL extraction
- CAPTCHA handling with auto-resume
"""

import os
import re
import time
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any
from urllib.parse import urljoin, parse_qs, urlparse

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.firefox import GeckoDriverManager
from bs4 import BeautifulSoup

from .database import Database, get_database
from .captcha import detect_captcha, detect_captcha_selenium, CaptchaHandler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

TTB_BASE_URL = "https://ttbonline.gov"
TTB_SEARCH_URL = f"{TTB_BASE_URL}/colasonline/publicSearchColasBasic.do"
TTB_DETAIL_URL = f"{TTB_BASE_URL}/colasonline/viewColaDetails.do"

# Class/Type code ranges for different spirit categories
# Source: TTB Classification Codes
CLASS_TYPE_RANGES = {
    'whiskey': [('100', '199'), ('641', '641')],
    'brandy': [('400', '499')],
    'rum': [('600', '609')],
    'gin': [('200', '298'), ('642', '642')],
    'vodka': [('300', '398'), ('643', '643')],
    'cordials_liqueurs': [('500', '599')],
    'cocktails': [('700', '799')],
    'tequila_mezcal': [('943', '943'), ('977', '980'), ('983', '983'), ('985', '989')],
    'wine': [('001', '099')],  # Table wines
    'beer_malt': [('800', '899')],  # Malt beverages
    'specialty': [('900', '999')],  # Specialty and other
}

# To scrape ALL types, use empty filter (TTB returns everything)
ALL_TYPES_FILTER = None

# TTB ID regex pattern (14 digits)
TTB_ID_PATTERN = re.compile(r'ttbid=(\d{14})')


# ─────────────────────────────────────────────────────────────────────────────
# Scraper Class
# ─────────────────────────────────────────────────────────────────────────────

class ColaScraper:
    """
    Robust, resumable COLA scraper for TTB Public Registry.
    """
    
    def __init__(self, 
                 db: Database = None,
                 headless: bool = False,
                 request_delay: float = 1.5,
                 page_timeout: int = 30,
                 max_retries: int = 3):
        """
        Initialize the scraper.
        
        Args:
            db: Database instance (creates default if None)
            headless: Run browser in headless mode (False = visible for CAPTCHA)
            request_delay: Delay between requests in seconds
            page_timeout: Page load timeout in seconds
            max_retries: Max retry attempts for failed requests
        """
        self.db = db or get_database()
        self.headless = headless
        self.request_delay = request_delay
        self.page_timeout = page_timeout
        self.max_retries = max_retries
        
        self.driver: Optional[webdriver.Firefox] = None
        self.captcha_handler = CaptchaHandler()
        
        # Statistics
        self.stats = {
            'links_collected': 0,
            'details_scraped': 0,
            'new_records': 0,
            'updated_records': 0,
            'failed': 0,
            'captchas_solved': 0,
        }
    
    def _init_driver(self):
        """Initialize or reinitialize the Selenium WebDriver."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
        
        options = webdriver.FirefoxOptions()
        if self.headless:
            options.add_argument('--headless')
        
        logger.info("Initializing Firefox WebDriver...")
        self.driver = webdriver.Firefox(
            service=FirefoxService(GeckoDriverManager().install()),
            options=options
        )
        self.driver.set_page_load_timeout(self.page_timeout)
        logger.info("WebDriver initialized")
    
    def _ensure_driver(self):
        """Ensure driver is available."""
        if not self.driver:
            self._init_driver()
    
    def close(self):
        """Clean up resources."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None
    
    def _delay(self, multiplier: float = 1.0):
        """Apply request delay."""
        time.sleep(self.request_delay * multiplier)
    
    def _handle_captcha_if_present(self, page_url: str = None) -> bool:
        """
        Check for and handle CAPTCHA if present.
        
        Returns:
            True if we can continue (no CAPTCHA or solved)
            False if we should stop
        """
        if detect_captcha_selenium(self.driver):
            self.stats['captchas_solved'] += 1
            return self.captcha_handler.handle(self.driver, page_url)
        return True
    
    # ─────────────────────────────────────────────────────────────────────────
    # Link Collection
    # ─────────────────────────────────────────────────────────────────────────
    
    def collect_links(self,
                      start_date: datetime,
                      end_date: datetime,
                      class_type_from: str = None,
                      class_type_to: str = None,
                      resume_job_id: int = None) -> int:
        """
        Collect COLA detail page links from search results.
        
        Automatically splits date ranges if results exceed 1000 (TTB limit).
        
        Args:
            start_date: Start of date range
            end_date: End of date range  
            class_type_from: Optional class/type code range start
            class_type_to: Optional class/type code range end
            resume_job_id: Resume an existing job instead of starting new
            
        Returns:
            Job ID
        """
        self._ensure_driver()
        
        # Create or resume job
        if resume_job_id:
            job = self.db.get_job(resume_job_id)
            if not job:
                raise ValueError(f"Job {resume_job_id} not found")
            job_id = resume_job_id
            logger.info(f"Resuming job {job_id}")
        else:
            job_id = self.db.create_job(
                job_type='links',
                date_from=start_date.strftime('%Y-%m-%d'),
                date_to=end_date.strftime('%Y-%m-%d'),
                class_type_from=class_type_from,
                class_type_to=class_type_to
            )
            logger.info(f"Created new link collection job {job_id}")
        
        try:
            # Use recursive helper that handles splitting
            self._collect_links_recursive(
                job_id, start_date, end_date, class_type_from, class_type_to
            )
            
            self.db.complete_job(job_id, 'completed')
            total = self.db.get_queue_stats(job_id)
            logger.info(f"Link collection complete: {total.get('pending', 0) + total.get('completed', 0)} total links collected")
            
        except Exception as e:
            logger.error(f"Error during link collection: {e}")
            self.db.complete_job(job_id, 'failed', str(e))
            raise
        
        return job_id
    
    def _collect_links_recursive(self,
                                  job_id: int,
                                  start_date: datetime,
                                  end_date: datetime,
                                  class_type_from: str = None,
                                  class_type_to: str = None):
        """
        Recursively collect links, splitting date ranges if >1000 results.
        """
        logger.info(f"Searching COLAs from {start_date.date()} to {end_date.date()}")
        
        # Navigate to search page
        self.driver.get(TTB_SEARCH_URL)
        self._delay()
        
        # Handle initial CAPTCHA if present
        if not self._handle_captcha_if_present(TTB_SEARCH_URL):
            return
        
        # Wait for form to load
        wait = WebDriverWait(self.driver, self.page_timeout)
        wait.until(EC.presence_of_element_located((By.NAME, 'searchCriteria.dateCompletedFrom')))
        
        # Fill search form
        self._fill_search_form(start_date, end_date, class_type_from, class_type_to)
        
        # Submit search
        submit_btn = wait.until(EC.element_to_be_clickable(
            (By.XPATH, '//input[@type="submit" and @value="Search"]')
        ))
        submit_btn.click()
        logger.info("Search submitted")
        
        self._delay()
        
        # Wait for results
        wait.until(lambda d: d.execute_script('return document.readyState') == 'complete')
        
        # Handle CAPTCHA after search
        if not self._handle_captcha_if_present():
            return
        
        # Check total result count BEFORE collecting
        total_results = self._get_total_result_count()
        logger.info(f"Total matching records: {total_results}")
        
        # If over 1000, split the date range and recurse
        if total_results >= 1000:
            logger.warning(f"⚠️ {total_results} results exceeds 1000 limit - splitting date range...")
            
            # Calculate midpoint
            total_days = (end_date - start_date).days
            
            if total_days <= 0:
                # Can't split further - just collect what we can
                logger.warning(f"Cannot split single day further - collecting max 1000")
                self._collect_all_pages(job_id, wait)
                return
            
            mid_date = start_date + timedelta(days=total_days // 2)
            
            logger.info(f"Splitting into: {start_date.date()} to {mid_date.date()} AND {(mid_date + timedelta(days=1)).date()} to {end_date.date()}")
            
            # Recurse on first half
            self._collect_links_recursive(job_id, start_date, mid_date, class_type_from, class_type_to)
            
            # Recurse on second half
            self._collect_links_recursive(job_id, mid_date + timedelta(days=1), end_date, class_type_from, class_type_to)
            
            return
        
        # Under 1000 results - collect all pages
        self._collect_all_pages(job_id, wait)
    
    def _get_total_result_count(self) -> int:
        """
        Extract the total result count from the search results page.
        Looks for text like "Total Matching Records: 1066"
        """
        try:
            page_source = self.driver.page_source
            
            # Look for "Total Matching Records: XXXX"
            import re
            match = re.search(r'Total Matching Records:\s*(\d+)', page_source)
            if match:
                return int(match.group(1))
            
            # Alternative: look for "X to Y of Z"
            match = re.search(r'of\s+(\d+)\s*\(Total', page_source)
            if match:
                return int(match.group(1))
                
            # Another pattern: "1 to 20 of 500"
            match = re.search(r'\d+\s+to\s+\d+\s+of\s+(\d+)', page_source)
            if match:
                return int(match.group(1))
            
            logger.warning("Could not parse total result count, assuming under 1000")
            return 0
            
        except Exception as e:
            logger.warning(f"Error getting result count: {e}")
            return 0
    
    def _collect_all_pages(self, job_id: int, wait: WebDriverWait):
        """
        Collect links from all pages of current search results.
        """
        page = 1
        total_links = 0
        
        while True:
            logger.info(f"Processing results page {page}...")
            
            # Extract links from current page
            links = self._extract_links_from_page()
            
            if not links:
                logger.info(f"No more links found on page {page}")
                break
            
            # Add to queue
            queue_items = []
            for url in links:
                ttb_id = self._extract_ttb_id(url)
                queue_items.append((job_id, 'detail', url, ttb_id, 0))
            
            self.db.add_many_to_queue(queue_items)
            total_links += len(links)
            self.stats['links_collected'] += len(links)
            
            logger.info(f"Found {len(links)} links on page {page} (total: {total_links})")
            self.db.update_job_progress(job_id, self.stats['links_collected'], self.stats['links_collected'])
            
            # Try to go to next page
            if not self._go_to_next_page(wait):
                break
            
            page += 1
            self._delay()
            
            # Check for CAPTCHA
            if not self._handle_captcha_if_present():
                break
        
        logger.info(f"Collected {total_links} links from this date range")
    
    def _fill_search_form(self, start_date: datetime, end_date: datetime,
                          class_type_from: str = None, class_type_to: str = None):
        """Fill in the TTB search form."""
        # Date range
        date_from_field = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom')
        date_from_field.clear()
        date_from_field.send_keys(start_date.strftime('%m/%d/%Y'))
        
        date_to_field = self.driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo')
        date_to_field.clear()
        date_to_field.send_keys(end_date.strftime('%m/%d/%Y'))
        
        # Class/Type code range (optional)
        if class_type_from:
            ct_from = self.driver.find_element(By.NAME, 'searchCriteria.classTypeFrom')
            ct_from.clear()
            ct_from.send_keys(class_type_from)
        
        if class_type_to:
            ct_to = self.driver.find_element(By.NAME, 'searchCriteria.classTypeTo')
            ct_to.clear()
            ct_to.send_keys(class_type_to)
    
    def _extract_links_from_page(self) -> List[str]:
        """Extract COLA detail links from current search results page."""
        links = []
        rows = self.driver.find_elements(By.XPATH, '//tr[@class="lt"] | //tr[@class="dk"]')
        
        for row in rows:
            try:
                link = row.find_element(By.TAG_NAME, 'a').get_attribute('href')
                if link and 'viewColaDetails' in link:
                    links.append(link)
            except Exception:
                continue
        
        return links
    
    def _go_to_next_page(self, wait: WebDriverWait) -> bool:
        """Try to navigate to next results page."""
        try:
            next_btn = wait.until(EC.element_to_be_clickable(
                (By.XPATH, '//a[contains(@href, "publicPageBasicCola.do?action=page&pgfcn=nextset")]')
            ))
            next_btn.click()
            
            # Wait for page load
            wait.until(lambda d: d.execute_script('return document.readyState') == 'complete')
            return True
            
        except TimeoutException:
            return False
        except Exception as e:
            logger.debug(f"No next page: {e}")
            return False
    
    def _extract_ttb_id(self, url: str) -> Optional[str]:
        """Extract TTB ID from a detail page URL."""
        match = TTB_ID_PATTERN.search(url)
        return match.group(1) if match else None
    
    # ─────────────────────────────────────────────────────────────────────────
    # Detail Page Scraping
    # ─────────────────────────────────────────────────────────────────────────
    
    def scrape_details(self, job_id: int = None, limit: int = None) -> int:
        """
        Scrape detail pages from the queue.
        
        Args:
            job_id: Only scrape items from this job (None = all pending)
            limit: Maximum number of items to process
            
        Returns:
            Number of items processed
        """
        self._ensure_driver()
        
        processed = 0
        batch_size = 50  # Save checkpoint every N items
        
        while True:
            # Get pending items
            items = self.db.get_pending_queue_items(
                job_id=job_id,
                item_type='detail',
                limit=min(batch_size, limit - processed if limit else batch_size)
            )
            
            if not items:
                logger.info("No more pending detail pages")
                break
            
            for item in items:
                try:
                    success = self._scrape_single_detail(item)
                    
                    if success:
                        self.db.update_queue_item(item['id'], 'completed')
                        processed += 1
                    else:
                        self.db.update_queue_item(item['id'], 'failed', 'Scrape returned no data')
                        self.stats['failed'] += 1
                    
                    self._delay()
                    
                except Exception as e:
                    logger.error(f"Error scraping {item['url']}: {e}")
                    self.db.update_queue_item(item['id'], 'failed', str(e))
                    self.stats['failed'] += 1
                
                # Check limits
                if limit and processed >= limit:
                    break
            
            # Progress update
            stats = self.db.get_queue_stats(job_id)
            logger.info(f"Progress: {stats['completed']} completed, {stats['pending']} pending, {stats['failed']} failed")
            
            if limit and processed >= limit:
                break
        
        return processed
    
    def _scrape_single_detail(self, queue_item: Dict) -> bool:
        """
        Scrape a single COLA detail page.
        
        Returns True on success.
        """
        url = queue_item['url']
        ttb_id = queue_item.get('ttb_id') or self._extract_ttb_id(url)
        
        logger.info(f"Scraping: {ttb_id}")
        
        # Load page
        for attempt in range(self.max_retries):
            try:
                self.driver.get(url)
                WebDriverWait(self.driver, self.page_timeout).until(
                    lambda d: d.execute_script('return document.readyState') == 'complete'
                )
                break
            except TimeoutException:
                if attempt < self.max_retries - 1:
                    logger.warning(f"Timeout loading {url}, retrying...")
                    self._delay(2)
                else:
                    raise
        
        # Handle CAPTCHA
        if not self._handle_captcha_if_present(url):
            return False
        
        # Parse page
        html = self.driver.page_source
        soup = BeautifulSoup(html, 'html.parser')
        
        # Extract data
        data = self._parse_detail_page(soup, ttb_id)
        
        if not data or not data.get('ttb_id'):
            logger.warning(f"No data extracted from {url}")
            return False
        
        # Count images on page
        image_count = len(self._find_image_urls(soup))
        data['image_count'] = image_count
        
        # Save to database
        is_new, changed_fields = self.db.upsert_cola(data, source_url=url)
        
        if is_new:
            self.stats['new_records'] += 1
            self.stats['details_scraped'] += 1
            logger.info(f"  ✓ New record: {data.get('brand_name', 'Unknown')}")
        elif changed_fields:
            self.stats['updated_records'] += 1
            self.stats['details_scraped'] += 1
            logger.info(f"  ↻ Updated: {', '.join(changed_fields)}")
        else:
            self.stats['details_scraped'] += 1
            logger.debug(f"  = No changes")
        
        return True
    
    def _parse_detail_page(self, soup: BeautifulSoup, ttb_id: str = None) -> Dict[str, Any]:
        """Parse a COLA detail page and extract all fields."""
        data = {}
        
        # Standard fields with their labels
        field_mappings = {
            'ttb_id': 'TTB ID:',
            'status': 'Status:',
            'vendor_code': 'Vendor Code:',
            'serial_number': 'Serial #:',
            'class_type_code': 'Class/Type Code:',
            'origin_code': 'Origin Code:',
            'brand_name': 'Brand Name:',
            'fanciful_name': 'Fanciful Name:',
            'type_of_application': 'Type of Application:',
            'for_sale_in': 'For Sale In:',
            'total_bottle_capacity': 'Total Bottle Capacity:',
            'formula': 'Formula :',  # Note: TTB has a space before colon
            'approval_date': 'Approval Date:',
            'qualifications': 'Qualifications:',
        }
        
        # Extract standard fields
        for field_name, label in field_mappings.items():
            value = self._extract_field(soup, label)
            if value:
                data[field_name] = value
        
        # Use provided TTB ID if extraction failed
        if not data.get('ttb_id') and ttb_id:
            data['ttb_id'] = ttb_id
        
        # Extract company/plant details from second box
        company_data = self._extract_company_details(soup)
        data.update(company_data)
        
        # Extract type-specific fields (wine vintage, grape varietal, etc.)
        extra_fields = self._extract_extra_fields(soup)
        if extra_fields:
            data['extra_fields'] = extra_fields
        
        return data
    
    def _extract_field(self, soup: BeautifulSoup, label: str) -> Optional[str]:
        """Extract a field value by its label."""
        try:
            # Find the label
            strong = soup.find('strong', string=lambda t: t and label in t)
            if not strong:
                # Try partial match
                for s in soup.find_all('strong'):
                    if s.string and label.rstrip(':').lower() in s.string.lower():
                        strong = s
                        break
            
            if not strong:
                return None
            
            # Get parent td and extract text
            td = strong.find_parent('td')
            if not td:
                return None
            
            text = td.get_text(strip=True)
            
            # Remove label from text
            for possible_label in [label, label.rstrip(':') + ':', label.rstrip(':')]:
                if text.startswith(possible_label):
                    text = text[len(possible_label):].strip()
                    break
            
            return text if text else None
            
        except Exception as e:
            logger.debug(f"Error extracting {label}: {e}")
            return None
    
    def _extract_company_details(self, soup: BeautifulSoup) -> Dict[str, str]:
        """Extract company/plant details from the second info box."""
        data = {}
        
        try:
            boxes = soup.find_all('div', class_='box')
            if len(boxes) < 2:
                return data
            
            box = boxes[1]
            rows = box.find_all('tr')
            
            # Standard positions for company info
            if len(rows) > 5:
                try:
                    data['plant_registry'] = rows[2].find('td').get_text(strip=True) if rows[2].find('td') else None
                    data['company_name'] = rows[3].find('td').get_text(strip=True) if rows[3].find('td') else None
                    data['street'] = rows[4].find('td').get_text(strip=True) if rows[4].find('td') else None
                    data['state'] = rows[5].find('td').get_text(strip=True) if rows[5].find('td') else None
                except (IndexError, AttributeError):
                    pass
            
            # Find contact info section
            for i, row in enumerate(rows):
                text = row.get_text()
                if 'Contact Information:' in text:
                    if i + 1 < len(rows):
                        contact_td = rows[i + 1].find('td')
                        if contact_td:
                            data['contact_person'] = ' '.join(contact_td.get_text(strip=True).split())
                    if i + 2 < len(rows):
                        phone_td = rows[i + 2].find('td')
                        if phone_td:
                            phone_text = phone_td.get_text(separator=' ').strip()
                            # Clean up phone number label
                            phone_text = re.sub(r'^Phone Number:\s*', '', phone_text).strip()
                            data['phone_number'] = phone_text
                    break
                    
        except Exception as e:
            logger.debug(f"Error extracting company details: {e}")
        
        return data
    
    def _extract_extra_fields(self, soup: BeautifulSoup) -> Dict[str, str]:
        """Extract type-specific fields (wine vintage, grape varietal, etc.)."""
        extra = {}
        
        # Additional fields that may appear for certain types
        extra_field_labels = [
            ('grape_varietal', 'Grape Varietal'),
            ('wine_vintage', 'Wine Vintage'),
            ('formula_sop_no', 'Formula/SOP No'),
            ('pre_cola_products', 'Pre-COLA Products'),
            ('alcohol_content', 'Alcohol Content'),
            ('net_contents', 'Net Contents'),
            ('country_of_origin', 'Country of Origin'),
            ('appellation', 'Appellation'),
        ]
        
        for field_name, label in extra_field_labels:
            value = self._extract_field(soup, label + ':')
            if not value:
                value = self._extract_field(soup, label)
            if value:
                extra[field_name] = value
        
        return extra if extra else None
    
    def _find_image_urls(self, soup: BeautifulSoup) -> List[str]:
        """Find label image URLs on the page."""
        urls = []
        
        for img in soup.find_all('img'):
            src = img.get('src', '')
            if 'publicViewAttachment' in src:
                if src.startswith('/'):
                    src = TTB_BASE_URL + src
                urls.append(src)
        
        return urls
    
    # ─────────────────────────────────────────────────────────────────────────
    # Convenience Methods
    # ─────────────────────────────────────────────────────────────────────────
    
    def scrape_date_range(self,
                          start_date: datetime,
                          end_date: datetime,
                          class_type_from: str = None,
                          class_type_to: str = None) -> Dict:
        """
        Complete scrape workflow: collect links then scrape details.
        
        Returns statistics dict.
        """
        logger.info(f"Starting scrape: {start_date.date()} to {end_date.date()}")
        
        # Collect links
        job_id = self.collect_links(start_date, end_date, class_type_from, class_type_to)
        
        # Scrape details
        self.scrape_details(job_id=job_id)
        
        # Return stats
        return {
            'job_id': job_id,
            **self.stats,
            **self.captcha_handler.get_stats(),
        }
    
    def resume_pending(self) -> Dict:
        """
        Resume any pending work from previous runs.
        
        Returns statistics dict.
        """
        # Check for pending detail scraping
        stats = self.db.get_queue_stats()
        
        if stats['pending'] > 0:
            logger.info(f"Found {stats['pending']} pending items, resuming...")
            self.scrape_details()
        else:
            logger.info("No pending work to resume")
        
        return self.stats
    
    def get_stats(self) -> Dict:
        """Get current scraper statistics."""
        queue_stats = self.db.get_queue_stats()
        return {
            **self.stats,
            'queue': queue_stats,
            'total_colas': self.db.get_cola_count(),
            'captcha': self.captcha_handler.get_stats(),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────────────────────────────────────

def scrape_week(weeks_ago: int = 0, headless: bool = False) -> Dict:
    """
    Convenience function to scrape a specific week.
    
    Args:
        weeks_ago: 0 = current week, 1 = last week, etc.
        headless: Run in headless mode
        
    Returns:
        Statistics dict
    """
    today = datetime.now()
    # Find start of target week (Monday)
    start_of_this_week = today - timedelta(days=today.weekday())
    target_week_start = start_of_this_week - timedelta(weeks=weeks_ago)
    target_week_end = target_week_start + timedelta(days=6)
    
    scraper = ColaScraper(headless=headless)
    try:
        return scraper.scrape_date_range(target_week_start, target_week_end)
    finally:
        scraper.close()


def scrape_recent_days(days: int = 7, headless: bool = False) -> Dict:
    """
    Scrape the most recent N days.
    
    Args:
        days: Number of days to look back
        headless: Run in headless mode
        
    Returns:
        Statistics dict
    """
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    scraper = ColaScraper(headless=headless)
    try:
        return scraper.scrape_date_range(start_date, end_date)
    finally:
        scraper.close()
