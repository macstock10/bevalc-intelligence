"""
BevAlc Intelligence - TTB COLA Database Scraper

A robust, resumable scraper for the TTB Public COLA Registry.
"""

__version__ = "1.0.0"

from .database import Database, get_database
from .scraper import ColaScraper, scrape_week, scrape_recent_days
from .images import ImageDownloader, download_all_images
from .captcha import detect_captcha, CaptchaHandler

__all__ = [
    'Database',
    'get_database',
    'ColaScraper',
    'scrape_week',
    'scrape_recent_days',
    'ImageDownloader',
    'download_all_images',
    'detect_captcha',
    'CaptchaHandler',
]
