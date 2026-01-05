"""
images.py - Image downloading for BevAlc Intelligence

Handles:
- Extracting image URLs from COLA detail pages
- Downloading and saving label images
- Image compression/optimization
- Resume support for interrupted downloads
"""

import os
import re
import time
import base64
import logging
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.firefox.service import Service as FirefoxService
from webdriver_manager.firefox import GeckoDriverManager

# Optional: PIL for image compression
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

import requests
import certifi
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .database import Database, get_database
from .captcha import detect_captcha_selenium, CaptchaHandler

logger = logging.getLogger(__name__)

# TTB image URL pattern
TTB_BASE_URL = "https://ttbonline.gov"
IMAGE_URL_PATTERN = re.compile(r'publicViewAttachment\.do')


class ImageDownloader:
    """
    Downloads and manages COLA label images.
    """
    
    def __init__(self,
                 db: Database = None,
                 images_dir: str = None,
                 compress: bool = True,
                 max_width: int = 1200,
                 jpeg_quality: int = 85):
        """
        Initialize the image downloader.
        
        Args:
            db: Database instance
            images_dir: Directory to save images (default: data/images)
            compress: Whether to compress images
            max_width: Maximum image width (for compression)
            jpeg_quality: JPEG quality (1-100)
        """
        self.db = db or get_database()
        
        # Set up images directory
        if images_dir:
            self.images_dir = Path(images_dir)
        else:
            self.images_dir = Path(__file__).parent.parent / "data" / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)
        
        self.compress = compress and HAS_PIL
        self.max_width = max_width
        self.jpeg_quality = jpeg_quality
        
        # HTTP session with retries disabled (we handle retries ourselves)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/120.0'
        })
        
        # Selenium driver (for fallback and cookie sharing)
        self.driver: Optional[webdriver.Firefox] = None
        self.captcha_handler = CaptchaHandler()
        
        # Stats
        self.stats = {
            'downloaded': 0,
            'skipped': 0,
            'failed': 0,
            'compressed': 0,
            'bytes_saved': 0,
        }
    
    def _ensure_driver(self, headless: bool = False):
        """Initialize Selenium driver if needed."""
        if not self.driver:
            options = webdriver.FirefoxOptions()
            if headless:
                options.add_argument('--headless')
            
            self.driver = webdriver.Firefox(
                service=FirefoxService(GeckoDriverManager().install()),
                options=options
            )
            self.driver.set_page_load_timeout(30)
    
    def close(self):
        """Clean up resources."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None
    
    def _get_cola_dir(self, ttb_id: str) -> Path:
        """Get the directory for a COLA's images."""
        cola_dir = self.images_dir / ttb_id
        cola_dir.mkdir(parents=True, exist_ok=True)
        return cola_dir
    
    def _compress_image(self, image_path: Path) -> Tuple[bool, int]:
        """
        Compress an image file.
        
        Returns:
            (success, bytes_saved)
        """
        if not HAS_PIL:
            return False, 0
        
        try:
            original_size = image_path.stat().st_size
            
            with Image.open(image_path) as img:
                # Convert to RGB if necessary (for JPEG)
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                
                # Resize if too large
                if img.width > self.max_width:
                    ratio = self.max_width / img.width
                    new_size = (self.max_width, int(img.height * ratio))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                
                # Save compressed
                output_path = image_path.with_suffix('.jpg')
                img.save(output_path, 'JPEG', quality=self.jpeg_quality, optimize=True)
                
                # Remove original if different format
                if output_path != image_path:
                    image_path.unlink()
                
                new_size = output_path.stat().st_size
                bytes_saved = original_size - new_size
                
                return True, max(0, bytes_saved)
                
        except Exception as e:
            logger.warning(f"Failed to compress {image_path}: {e}")
            return False, 0
    
    def download_images_for_cola(self, 
                                  ttb_id: str,
                                  image_urls: List[str] = None,
                                  headless: bool = False) -> Tuple[int, List[str]]:
        """
        Download all images for a single COLA.
        
        Args:
            ttb_id: The TTB ID
            image_urls: List of image URLs (if already known)
            headless: Run browser in headless mode
            
        Returns:
            (count_downloaded, list_of_paths)
        """
        self._ensure_driver(headless)
        
        cola_dir = self._get_cola_dir(ttb_id)
        downloaded_paths = []
        
        # If we don't have URLs, need to fetch the detail page
        if not image_urls:
            detail_url = f"{TTB_BASE_URL}/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={ttb_id}"
            
            try:
                self.driver.get(detail_url)
                WebDriverWait(self.driver, 15).until(
                    lambda d: d.execute_script('return document.readyState') == 'complete'
                )
                
                # Handle CAPTCHA
                if detect_captcha_selenium(self.driver):
                    if not self.captcha_handler.handle(self.driver, detail_url):
                        return 0, []
                    self.driver.get(detail_url)
                    time.sleep(2)
                
                # Find image URLs
                image_urls = self._extract_image_urls_from_driver()
                
            except Exception as e:
                logger.error(f"Failed to load detail page for {ttb_id}: {e}")
                return 0, []
        
        if not image_urls:
            logger.info(f"No images found for {ttb_id}")
            return 0, []
        
        # Get cookies from driver for authenticated downloads
        cookies = {c['name']: c['value'] for c in self.driver.get_cookies()}
        
        # Download each image
        for idx, url in enumerate(image_urls, 1):
            try:
                filename = f"label_{idx}.jpg"
                filepath = cola_dir / filename
                
                # Skip if already exists
                if filepath.exists() and filepath.stat().st_size > 1000:
                    logger.debug(f"Skipping existing: {filepath}")
                    downloaded_paths.append(str(filepath))
                    self.stats['skipped'] += 1
                    continue
                
                # Try HTTP download first
                success = self._download_image_http(url, filepath, cookies)
                
                # Fallback to Selenium if HTTP fails
                if not success:
                    success = self._download_image_selenium(url, filepath)
                
                if success:
                    # Compress if enabled
                    if self.compress:
                        compressed, saved = self._compress_image(filepath)
                        if compressed:
                            self.stats['compressed'] += 1
                            self.stats['bytes_saved'] += saved
                            # Update path if extension changed
                            filepath = filepath.with_suffix('.jpg')
                    
                    downloaded_paths.append(str(filepath))
                    self.stats['downloaded'] += 1
                    logger.info(f"  ✓ Downloaded: {filename}")
                else:
                    self.stats['failed'] += 1
                    logger.warning(f"  ✗ Failed: {filename}")
                
                time.sleep(0.5)  # Small delay between images
                
            except Exception as e:
                logger.error(f"Error downloading image {idx} for {ttb_id}: {e}")
                self.stats['failed'] += 1
        
        # Update database
        self.db.update_cola_images(
            ttb_id=ttb_id,
            image_count=len(image_urls),
            images_downloaded=len(downloaded_paths),
            image_paths=downloaded_paths
        )
        
        return len(downloaded_paths), downloaded_paths
    
    def _extract_image_urls_from_driver(self) -> List[str]:
        """Extract image URLs from the current page."""
        urls = []
        
        for img in self.driver.find_elements(By.TAG_NAME, 'img'):
            src = img.get_attribute('src') or ''
            if 'publicViewAttachment' in src:
                if src.startswith('/'):
                    src = TTB_BASE_URL + src
                urls.append(src)
        
        return urls
    
    def _download_image_http(self, url: str, filepath: Path, cookies: dict = None) -> bool:
        """
        Download image via HTTP.
        
        Returns True on success.
        """
        try:
            response = self.session.get(
                url,
                cookies=cookies,
                timeout=15,
                verify=certifi.where(),
                allow_redirects=True
            )
            response.raise_for_status()
            
            content_type = response.headers.get('Content-Type', '').lower()
            
            # Verify it's an image
            if not (content_type.startswith('image/') or content_type == 'application/octet-stream'):
                logger.warning(f"Unexpected content type: {content_type}")
                return False
            
            # Verify we got actual image data (not CAPTCHA HTML)
            if len(response.content) < 1000 or b'<html' in response.content[:100].lower():
                return False
            
            # Save file
            with open(filepath, 'wb') as f:
                f.write(response.content)
            
            return True
            
        except Exception as e:
            logger.debug(f"HTTP download failed: {e}")
            return False
    
    def _download_image_selenium(self, url: str, filepath: Path) -> bool:
        """
        Download image via Selenium (fallback for authenticated content).
        
        Returns True on success.
        """
        try:
            # Use JavaScript to fetch the image with credentials
            js = """
                const url = arguments[0];
                const done = arguments[1];
                fetch(url, {credentials: 'include'})
                    .then(async r => {
                        const ctype = (r.headers.get('content-type') || '').toLowerCase();
                        const buf = await r.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const b64 = btoa(binary);
                        done({ok: true, ctype, b64});
                    })
                    .catch(err => done({ok: false, err: String(err)}));
            """
            
            result = self.driver.execute_async_script(js, url)
            
            if not result or not result.get('ok'):
                logger.warning(f"Selenium fetch failed: {result}")
                return False
            
            # Decode and save
            data = base64.b64decode(result['b64'])
            
            # Verify image data
            if len(data) < 1000:
                return False
            
            with open(filepath, 'wb') as f:
                f.write(data)
            
            return True
            
        except Exception as e:
            logger.warning(f"Selenium download failed: {e}")
            return False
    
    def download_pending_images(self, 
                                 limit: int = None,
                                 headless: bool = False) -> Dict:
        """
        Download images for COLAs that need them.
        
        Args:
            limit: Maximum COLAs to process
            headless: Run browser in headless mode
            
        Returns:
            Statistics dict
        """
        self._ensure_driver(headless)
        
        processed = 0
        
        while True:
            # Get COLAs needing images
            colas = self.db.get_colas_needing_images(limit=50)
            
            if not colas:
                logger.info("No more COLAs need images")
                break
            
            for cola in colas:
                ttb_id = cola['ttb_id']
                
                logger.info(f"Downloading images for: {ttb_id}")
                
                try:
                    count, paths = self.download_images_for_cola(ttb_id, headless=headless)
                    logger.info(f"  Downloaded {count} images")
                except Exception as e:
                    logger.error(f"  Error: {e}")
                
                processed += 1
                
                if limit and processed >= limit:
                    break
                
                time.sleep(1)  # Delay between COLAs
            
            if limit and processed >= limit:
                break
        
        return self.stats
    
    def get_stats(self) -> Dict:
        """Get download statistics."""
        return {
            **self.stats,
            'bytes_saved_mb': round(self.stats['bytes_saved'] / (1024 * 1024), 2),
        }


def download_all_images(limit: int = None, headless: bool = False) -> Dict:
    """
    Convenience function to download all pending images.
    
    Returns statistics dict.
    """
    downloader = ImageDownloader()
    try:
        return downloader.download_pending_images(limit=limit, headless=headless)
    finally:
        downloader.close()
