"""
weekly_report.py — BevAlc Intelligence Weekly Snapshot PDF (Free Version)

STRUCTURE (per spec):
- Page 1: Headline metrics (total, unique, new brands, new SKUs, refile share, pace, YoY) + category table
- Page 2: Market Direction chart (rolling 4/13/52 week averages)
- Page 3: Category Trends (small multiples)
- Page 4: Competitive Activity (top brands this week)
- Page 5: Origin Mix (domestic/import split + top origins)

FIXES APPLIED:
1. Removed blank Page 2 issue (no premature page breaks)
2. Removed broken "New vs Re-file Share" chart
3. Added new brands / new SKUs / refile share metrics
4. Added methodology footnote defining "unique approval"

USAGE:
    python weekly_report.py
    python weekly_report.py --months 36
    python weekly_report.py --dry-run
"""

import os
import argparse
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from pathlib import Path

import requests
import pandas as pd
import numpy as np

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import MaxNLocator

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle,
    PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.utils import ImageReader


# =============================================================================
# CONFIG - Auto-detect paths (works on Windows and Linux/GitHub Actions)
# =============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent  # Goes up from /scripts to repo root

ENV_FILE = str(BASE_DIR / ".env")
OUTPUT_DIR = str(BASE_DIR / "reports")
LOG_FILE = str(BASE_DIR / "logs" / "weekly_report.log")
LOGO_PATH = str(BASE_DIR / "Logo.jpg")

COLORS = {
    "primary": "#0d9488",
    "secondary": "#0f172a",
    "text": "#0f172a",
    "muted": "#64748b",
    "grid": "#e5e7eb",
    "bar": "#99d9d6",
    "line": "#0f172a",
    "gold": "#f59e0b",
    "orange": "#f59e0b",
}

# =============================================================================
# EXACT TTB_CODE_CATEGORIES FROM database.js
# =============================================================================

TTB_CODE_CATEGORIES = {
    # WHISKEY
    'STRAIGHT WHISKY': 'Whiskey', 'STRAIGHT BOURBON WHISKY': 'Whiskey', 'STRAIGHT RYE WHISKY': 'Whiskey',
    'STRAIGHT CORN WHISKY': 'Whiskey', 'OTHER STRAIGHT WHISKY': 'Whiskey', 'WHISKY BOTTLED IN BOND (BIB)': 'Whiskey',
    'BOURBON WHISKY BIB': 'Whiskey', 'RYE WHISKY BIB': 'Whiskey', 'CORN WHISKY BIB': 'Whiskey',
    'STRAIGHT MALT WHISKY': 'Whiskey', 'MALT WHISKY': 'Whiskey', 'OTHER WHISKY BIB': 'Whiskey',
    'STRAIGHT WHISKY BLENDS': 'Whiskey', 'STRAIGHT BOURBON WHISKY BLENDS': 'Whiskey',
    'STRAIGHT RYE WHISKY BLENDS': 'Whiskey', 'STRAIGHT CORN WHISKY BLENDS': 'Whiskey',
    'OTHER STRAIGHT BLENDED WHISKY': 'Whiskey', 'WHISKY BLENDS': 'Whiskey', 'BLENDED BOURBON WHISKY': 'Whiskey',
    'BLENDED RYE WHISKY': 'Whiskey', 'BLENDED CORN WHISKY': 'Whiskey', 'BLENDED LIGHT WHISKY': 'Whiskey',
    'BLENDED WHISKY': 'Whiskey', 'DILUTED BLENDED WHISKY': 'Whiskey', 'OTHER WHISKY BLENDS': 'Whiskey',
    'WHISKY': 'Whiskey', 'BOURBON WHISKY': 'Whiskey', 'RYE WHISKY': 'Whiskey', 'CORN WHISKY': 'Whiskey',
    'LIGHT WHISKY': 'Whiskey', 'WHISKY PROPRIETARY': 'Whiskey', 'SPIRIT WHISKY': 'Whiskey',
    'DILUTED WHISKY': 'Whiskey', 'OTHER WHISKY (FLAVORED)': 'Whiskey', 'SCOTCH WHISKY': 'Whiskey',
    'SCOTCH WHISKY FB': 'Whiskey', 'SCOTCH WHISKY USB': 'Whiskey', 'SINGLE MALT SCOTCH WHISKY': 'Whiskey',
    'UNBLENDED SCOTCH WHISKY USB': 'Whiskey', 'DILUTED SCOTCH WHISKY FB': 'Whiskey',
    'DILUTED SCOTCH WHISKY USB': 'Whiskey', 'CANADIAN WHISKY': 'Whiskey', 'CANADIAN WHISKY FB': 'Whiskey',
    'CANADIAN WHISKY USB': 'Whiskey', 'STRAIGHT AMERICAN SINGLE MALT': 'Whiskey',
    'AMERICAN SINGLE MALT WHISKEY': 'Whiskey', 'DILUTED CANADIAN WHISKY FB': 'Whiskey',
    'DILUTED CANADIAN WHISKY USB': 'Whiskey', 'IRISH WHISKY': 'Whiskey', 'IRISH WHISKY FB': 'Whiskey',
    'IRISH WHISKY USB': 'Whiskey', 'DILUTED IRISH WHISKY FB': 'Whiskey', 'DILUTED IRISH WHISKY USB': 'Whiskey',
    'WHISKY ORANGE FLAVORED': 'Whiskey', 'WHISKY GRAPE FLAVORED': 'Whiskey', 'WHISKY LIME FLAVORED': 'Whiskey',
    'WHISKY LEMON FLAVORED': 'Whiskey', 'WHISKY CHERRY FLAVORED': 'Whiskey', 'WHISKY CHOCOLATE FLAVORED': 'Whiskey',
    'WHISKY MINT FLAVORED': 'Whiskey', 'WHISKY PEPPERMINT FLAVORED': 'Whiskey', 'WHISKY OTHER FLAVORED': 'Whiskey',
    'OTHER IMPORTED WHISKY': 'Whiskey', 'OTHER IMPORTED WHISKY FB': 'Whiskey', 'OTHER IMPORTED WHISKY USB': 'Whiskey',
    'DILUTED OTHER IMPORTED WHISKY FB': 'Whiskey', 'DILUTED OTHER IMPORTED WHISKY USB': 'Whiskey',
    'AMERICAN SINGLE MALT WHISKEY - BIB': 'Whiskey', 'WHISKY SPECIALTIES': 'Whiskey',
    'LIQUEURS (WHISKY)': 'Whiskey', 'TENNESSEE WHISKY': 'Whiskey',
    
    # GIN
    'DISTILLED GIN': 'Gin', 'LONDON DRY DISTILLED GIN': 'Gin', 'OTHER DISTILLED GIN': 'Gin',
    'GIN': 'Gin', 'LONDON DRY GIN': 'Gin', 'OTHER GIN': 'Gin', 'GIN - FLAVORED': 'Gin',
    'GIN - MINT FLAVORED': 'Gin', 'GIN - ORANGE FLAVORED': 'Gin', 'GIN - LEMON FLAVORED': 'Gin',
    'OTHER GIN - FLAVORED': 'Gin', 'DILUTED GIN': 'Gin', 'LONDON DRY DISTILLED GIN FB': 'Gin',
    'LONDON DRY DISTILLED GIN USB': 'Gin', 'OTHER DISTILLED GIN FB': 'Gin', 'OTHER DISTILLED GIN USB': 'Gin',
    'LONDON DRY GIN FB': 'Gin', 'LONDON DRY GIN USB': 'Gin', 'OTHER GIN FB': 'Gin', 'OTHER GIN USB': 'Gin',
    'GIN - CHERRY FLAVORED': 'Gin', 'GIN - APPLE FLAVORED': 'Gin', 'GIN - BLACKBERRY FLAVORED': 'Gin',
    'GIN - PEACH FLAVORED': 'Gin', 'GIN - GRAPE FLAVORED': 'Gin', 'DILUTED GIN FB': 'Gin',
    'DILUTED GIN USB': 'Gin', 'GIN SPECIALTIES': 'Gin', 'LIQUEURS (GIN)': 'Gin', 'SLOE GIN': 'Gin',
    
    # VODKA
    'VODKA': 'Vodka', 'VODKA 80-89 PROOF': 'Vodka', 'VODKA 90-99 PROOF': 'Vodka', 'VODKA 100 PROOF UP': 'Vodka',
    'VODKA - FLAVORED': 'Vodka', 'VODKA - ORANGE FLAVORED': 'Vodka', 'VODKA - GRAPE FLAVORED': 'Vodka',
    'VODKA - LIME FLAVORED': 'Vodka', 'VODKA - LEMON FLAVORED': 'Vodka', 'VODKA - CHERRY FLAVORED': 'Vodka',
    'VODKA - CHOCOLATE FLAVORED': 'Vodka', 'VODKA - MINT FLAVORED': 'Vodka', 'VODKA - PEPPERMINT FLAVORED': 'Vodka',
    'VODKA - OTHER FLAVORED': 'Vodka', 'OTHER VODKA': 'Vodka', 'DILUTED VODKA': 'Vodka',
    'VODKA 80-89 PROOF FB': 'Vodka', 'VODKA 80-89 PROOF USB': 'Vodka', 'VODKA 90-99 PROOF FB': 'Vodka',
    'VODKA 90-99 PROOF USB': 'Vodka', 'VODKA 100 PROOF UP FB': 'Vodka', 'VODKA 100 PROOF UP USB': 'Vodka',
    'DILUTED VODKA FB': 'Vodka', 'DILUTED VODKA USB': 'Vodka', 'VODKA SPECIALTIES': 'Vodka', 'LIQUEURS (VODKA)': 'Vodka',
    
    # RUM
    'U.S. RUM (WHITE)': 'Rum', 'UR.S. RUM (WHITE)': 'Rum', 'PUERTO RICAN RUM (WHITE)': 'Rum',
    'VIRGIN ISLANDS RUM (WHITE)': 'Rum', 'HAWAIIAN RUM (WHITE)': 'Rum', 'FLORIDA RUM (WHITE)': 'Rum',
    'OTHER RUM (WHITE)': 'Rum', 'U.S. RUM (GOLD)': 'Rum', 'PUERTO RICAN RUM (GOLD)': 'Rum',
    'VIRGIN ISLANDS RUM (GOLD)': 'Rum', 'VIRGIN ISLANDS RUM': 'Rum', 'HAWAIIAN RUM (GOLD)': 'Rum',
    'FLORIDA RUM (GOLD)': 'Rum', 'OTHER RUM (GOLD)': 'Rum', 'RUM FLAVORED (BOLD)': 'Rum',
    'RUM ORANGE GLAVORED': 'Rum', 'RUM GRAPE FLAVORED': 'Rum', 'RUM LIME FLAVORED': 'Rum',
    'RUM LEMON FLAVORED': 'Rum', 'RUM CHERRY FLAVORED': 'Rum', 'RUM CHOCOLATE FLAVORED': 'Rum',
    'RUM MINT FLAVORED': 'Rum', 'RUM PEPPERMINT FLAVORED': 'Rum', 'RUM OTHER FLAVORED': 'Rum',
    'OTHER WHITE RUM': 'Rum', 'FLAVORED RUM (BOLD)': 'Rum', 'RUM ORANGE FLAVORED': 'Rum',
    'DILUTED RUM (WHITE)': 'Rum', 'DILUTED RUM (GOLD)': 'Rum', 'DOMESTIC FLAVORED RUM': 'Rum',
    'FOREIGN RUM': 'Rum', 'OTHER FOREIGN RUM': 'Rum', 'RUM SPECIALTIES': 'Rum', 'LIQUEURS (RUM)': 'Rum', 'CACHACA': 'Rum',
    
    # BRANDY
    'BRANDY': 'Brandy', 'CALIFORNIA BRANDY': 'Brandy', 'NEW YORK BRANDY': 'Brandy', 'FRUIT BRANDY': 'Brandy',
    'APPLE BRANDY': 'Brandy', 'CHERRY BRANDY': 'Brandy', 'PLUM BRANDY': 'Brandy', 'BLACKBERRY BRANDY': 'Brandy',
    'APRICOT BRANDY': 'Brandy', 'PEAR BRANDY': 'Brandy', 'COGNAC (BRANDY) FB': 'Brandy', 'COGNAC (BRANDY) USB': 'Brandy',
    'ARMAGNAC (BRANDY) FB': 'Brandy', 'ARMAGNAC (BRANDY) USB': 'Brandy', 'GRAPPA BRANDY': 'Brandy', 'PISCO': 'Brandy',
    'APPLE BRANDY (CALVADOS)': 'Brandy', 'PLUM BRANDY (SLIVOVITZ)': 'Brandy', 'BRANDY - FLAVORED': 'Brandy',
    'FLAVORED BRANDY': 'Brandy', 'BLACKBERRY FLAVORED BRANDY': 'Brandy', 'LIQUEUR & BRANDY': 'Brandy',
    'BRANDY - APRICOT FLAVORED': 'Brandy', 'BRANDY - BLACKBERRY FLAVORED': 'Brandy',
    'BRANDY - CHERRY FLAVORED': 'Brandy', 'BRANDY - COFFEE FLAVORED': 'Brandy',
    'BLENDED APPLE JACK BRANDY': 'Brandy',
    
    # LIQUEUR
    'CORDIALS (FRUIT & PEELS)': 'Liqueur', 'FRUIT FLAVORED LIQUEURS': 'Liqueur', 'CURACAO': 'Liqueur',
    'TRIPLE SEC': 'Liqueur', 'CORDIALS (HERBS & SEEDS)': 'Liqueur',
    'ANISETTE, OUZO, OJEN': 'Liqueur', 'COFFEE (CAFE) LIQUEUR': 'Liqueur', 'KUMMEL': 'Liqueur',
    'PEPPERMINT SCHNAPPS': 'Liqueur', 'AMARETTO': 'Liqueur', 'SAMBUCA': 'Liqueur', 'ARACK/RAKI': 'Liqueur',
    'CORDIALS (CREMES OR CREAMS)': 'Liqueur', 'CREME DE CACAO WHITE': 'Liqueur', 'CREME DE CACAO BROWN': 'Liqueur',
    'CREME DE MENTHE WHITE': 'Liqueur', 'CREME DE MENTHE GREEN': 'Liqueur', 'CREME DE ALMOND (NOYAUX)': 'Liqueur',
    'DAIRY CREAM LIQUEUR/CORDIAL': 'Liqueur', 'NON DAIRY CREME LIQUEUR/CORDIAL': 'Liqueur',
    'SPECIALTIES & PROPRIETARIES': 'Liqueur', 'OTHER SPECIALTIES & PROPRIETARIES': 'Liqueur',
    
    # COCKTAILS / RTD
    'COCKTAILS 48 PROOF UP': 'RTD', 'COCKTAILS UNDER 48 PROOF': 'RTD',
    'MIXED DRINKS-HI BALLS COCKTAILS': 'RTD', 'SCREW DRIVER': 'RTD', 'COLLINS': 'RTD',
    'BLOODY MARY': 'RTD', 'EGG NOG': 'RTD', 'DAIQUIRI (48 PROOF UP)': 'RTD',
    'DAIQUIRI (UNDER 48 PROOF)': 'RTD', 'MARGARITA (48 PROOF UP)': 'RTD',
    'MARGARITA (UNDER 48 PROOF)': 'RTD', 'COLADA (48 PROOF UP)': 'RTD', 'COLADA (UNDER 48 PROOF)': 'RTD',
    
    # WINE
    'TABLE RED WINE': 'Wine', 'ROSE WINE': 'Wine', 'TABLE WHITE WINE': 'Wine', 'TABLE FLAVORED WINE': 'Wine',
    'TABLE FRUIT WINE': 'Wine', 'SPARKLING WINE/CHAMPAGNE': 'Wine', 'SPARKLING WINE': 'Wine', 'CHAMPAGNE': 'Wine',
    'CARBONATED WINE': 'Wine', 'VERMOUTH/MIXED TYPES': 'Wine', 'DESSERT FLAVORED WINE': 'Wine',
    'DESSERT /PORT/SHERRY/(COOKING) WINE': 'Wine', 'DESSERT FRUIT WINE': 'Wine', 'WINE': 'Wine',
    'PORT': 'Wine', 'SHERRY': 'Wine', 'VERMOUTH': 'Wine', 'SANGRIA': 'Wine', 'MEAD': 'Wine', 'CIDER': 'Wine',
    'SAKE': 'Wine', 'SAKE - IMPORTED': 'Wine', 'SAKE - DOMESTIC FLAVORED': 'Wine', 'SAKE - IMPORTED FLAVORED': 'Wine',
    
    # BEER
    'MALT BEVERAGES': 'Beer', 'BEER': 'Beer', 'ALE': 'Beer', 'MALT LIQUOR': 'Beer', 'STOUT': 'Beer', 'PORTER': 'Beer',
    'MALT BEVERAGES SPECIALITIES - FLAVORED': 'Beer', 'OTHER MALT BEVERAGES': 'Beer',
    
    # TEQUILA
    'TEQUILA': 'Tequila', 'TEQUILA FB': 'Tequila', 'TEQUILA USB': 'Tequila', 'MEZCAL': 'Tequila',
    'MEZCAL FB': 'Tequila', 'AGAVE SPIRITS': 'Tequila', 'FLAVORED TEQUILA': 'Tequila', 'FLAVORED MEZCAL': 'Tequila',
    
    # OTHER
    'OTHER SPIRITS': 'Other', 'NEUTRAL SPIRITS - GRAIN': 'Other', 'BITTERS - BEVERAGE': 'Other',
    'BITTERS - BEVERAGE*': 'Other', 'GRAIN SPIRITS': 'Other',
    'NON ALCOHOLIC MIXES': 'Other', 'ADMINISTRATIVE WITHDRAWAL': 'Other'
}

CATEGORY_ORDER = ['Whiskey', 'Vodka', 'Wine', 'Beer', 'Tequila', 'RTD', 'Rum', 'Gin', 'Brandy', 'Liqueur', 'Other']

# Logging setup
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


# =============================================================================
# DATA LOADING
# =============================================================================

def load_env():
    """Load environment variables from .env file."""
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")


def get_category(class_type_code) -> str:
    """Map TTB class/type code to category using exact lookup."""
    if class_type_code is None or (isinstance(class_type_code, float) and pd.isna(class_type_code)):
        return 'Other'
    if not isinstance(class_type_code, str):
        return 'Other'
    code = class_type_code.strip().upper()
    return TTB_CODE_CATEGORIES.get(code, 'Other')


def d1_query(sql: str) -> List[Dict]:
    """Execute a D1 query and return results."""
    load_env()

    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    database_id = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")

    if not all([account_id, database_id, api_token]):
        raise RuntimeError("Missing Cloudflare credentials in environment")

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    resp = requests.post(url, headers=headers, json={"sql": sql})
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        raise RuntimeError(f"D1 query failed: {data}")

    return data.get("result", [{}])[0].get("results", [])


def fetch_week_data(week_start: datetime, week_end: datetime) -> pd.DataFrame:
    """Fetch this week's COLA records with pre-computed signals."""
    # Format dates for SQL (MM/DD/YYYY)
    start_str = week_start.strftime("%m/%d/%Y")
    end_str = week_end.strftime("%m/%d/%Y")

    # Query for this week's records - use year/month/day for efficient indexed lookup
    query = f"""
        SELECT ttb_id, brand_name, fanciful_name, class_type_code, origin_code,
               approval_date, status, company_name, year, month, day, signal
        FROM colas
        WHERE status = 'APPROVED'
        AND year = {week_end.year}
        AND (
            (month = {week_start.month} AND day >= {week_start.day})
            OR (month = {week_end.month} AND day <= {week_end.day})
            OR (month > {week_start.month} AND month < {week_end.month})
        )
    """

    # Handle year boundary (e.g., week spanning Dec-Jan)
    if week_start.year != week_end.year:
        query = f"""
            SELECT ttb_id, brand_name, fanciful_name, class_type_code, origin_code,
                   approval_date, status, company_name, year, month, day, signal
            FROM colas
            WHERE status = 'APPROVED'
            AND (
                (year = {week_start.year} AND month = {week_start.month} AND day >= {week_start.day})
                OR (year = {week_end.year} AND month = {week_end.month} AND day <= {week_end.day})
            )
        """

    results = d1_query(query)
    logger.info(f"Fetched {len(results):,} records for week {start_str} - {end_str}")

    if not results:
        return pd.DataFrame()

    df = pd.DataFrame(results)
    df["approval_date"] = pd.to_datetime(df["approval_date"], format="%m/%d/%Y", errors="coerce")
    df = df.dropna(subset=["approval_date"])

    # Filter to exact date range (in case query was broader)
    df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)]

    df["category"] = df["class_type_code"].apply(get_category)
    df["week"] = df["approval_date"].dt.to_period("W-SUN").dt.start_time

    return df


def fetch_daily_aggregates(years_back: int = 3) -> pd.DataFrame:
    """Fetch daily aggregate counts for rolling averages (much faster than full data)."""
    min_year = datetime.now().year - years_back

    query = f"""
        SELECT year, month, day,
               COUNT(*) as total_count,
               COUNT(DISTINCT company_name || '|' || brand_name || '|' ||
                     COALESCE(fanciful_name, '') || '|' || COALESCE(class_type_code, '')) as unique_skus
        FROM colas
        WHERE status = 'APPROVED' AND year >= {min_year}
        GROUP BY year, month, day
        ORDER BY year, month, day
    """

    results = d1_query(query)
    logger.info(f"Fetched {len(results):,} daily aggregates (years >= {min_year})")

    if not results:
        return pd.DataFrame()

    df = pd.DataFrame(results)

    # Build date column
    df["date"] = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2) + "-" + df["day"].astype(str).str.zfill(2),
        format="%Y-%m-%d",
        errors="coerce"
    )
    df = df.dropna(subset=["date"])

    # Add week column (Monday-based, ending Sunday)
    df["week"] = df["date"].dt.to_period("W-SUN").dt.start_time

    return df


def fetch_category_aggregates(week_start: datetime, week_end: datetime, weeks_back: int = 52) -> pd.DataFrame:
    """Fetch category-wise aggregates for historical comparison."""
    lookback_start = week_start - timedelta(weeks=weeks_back)
    min_year = lookback_start.year

    query = f"""
        SELECT class_type_code, year, month, day, COUNT(*) as count
        FROM colas
        WHERE status = 'APPROVED' AND year >= {min_year}
        GROUP BY class_type_code, year, month, day
    """

    results = d1_query(query)
    logger.info(f"Fetched {len(results):,} category daily aggregates")

    if not results:
        return pd.DataFrame()

    df = pd.DataFrame(results)
    df["date"] = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2) + "-" + df["day"].astype(str).str.zfill(2),
        format="%Y-%m-%d",
        errors="coerce"
    )
    df = df.dropna(subset=["date"])
    df["category"] = df["class_type_code"].apply(get_category)
    df["week"] = df["date"].dt.to_period("W-SUN").dt.start_time

    return df


def fetch_recent_data_for_charts(weeks_back: int = 130) -> pd.DataFrame:
    """Fetch recent data for category trend charts (limited scope)."""
    cutoff = datetime.now() - timedelta(weeks=weeks_back)
    min_year = cutoff.year

    # Paginate to get all records for chart period
    all_results = []
    offset = 0
    batch_size = 50000

    while True:
        query = f"""
            SELECT ttb_id, brand_name, fanciful_name, class_type_code, origin_code,
                   approval_date, company_name, year, month, day, signal
            FROM colas
            WHERE status = 'APPROVED' AND year >= {min_year}
            ORDER BY year DESC, month DESC, day DESC
            LIMIT {batch_size} OFFSET {offset}
        """

        results = d1_query(query)
        if not results:
            break

        all_results.extend(results)
        logger.info(f"Fetched batch: {len(results)} records (total: {len(all_results)})")

        if len(results) < batch_size:
            break
        offset += batch_size

    if not all_results:
        return pd.DataFrame()

    df = pd.DataFrame(all_results)
    df["approval_date"] = pd.to_datetime(df["approval_date"], format="%m/%d/%Y", errors="coerce")
    df = df.dropna(subset=["approval_date"])

    # Filter to exact date range
    df = df[df["approval_date"] >= cutoff]

    df["week"] = df["approval_date"].dt.to_period("W-SUN").dt.start_time
    df["category"] = df["class_type_code"].apply(get_category)

    logger.info(f"Fetched {len(df):,} records for charts (last {weeks_back} weeks)")
    return df


def fetch_historical_data() -> pd.DataFrame:
    """
    OPTIMIZED: Fetch data needed for the weekly report.

    Instead of fetching ALL 2.7M records, we now fetch only the last 2.5 years
    (~300-600k records for charts and metrics).

    This reduces fetch time from ~12 minutes to ~2-3 minutes.
    """
    load_env()

    # Fetch recent data for charts (last 2.5 years = 130 weeks)
    # This is still needed for category trend charts which need raw data
    df = fetch_recent_data_for_charts(weeks_back=130)

    if df.empty:
        raise RuntimeError("No data fetched. Check D1 creds and database contents.")

    logger.info(f"Total records for report: {len(df):,}")
    return df


# =============================================================================
# METRICS COMPUTATION
# =============================================================================

def last_complete_week(today: datetime) -> Tuple[datetime, datetime]:
    """Get the start and end of the last complete week (Mon-Sun)."""
    days_since_sunday = (today.weekday() + 1) % 7
    week_end = (today - timedelta(days=days_since_sunday)).replace(hour=23, minute=59, second=59, microsecond=0)
    week_start = (week_end - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    return week_start, week_end


def weekly_series(df: pd.DataFrame) -> pd.DataFrame:
    """Create weekly aggregation (total filings)."""
    w = df.groupby("week").size().reset_index(name="count").sort_values("week")
    return w


def weekly_series_unique(df: pd.DataFrame) -> pd.DataFrame:
    """Create weekly aggregation based on unique SKUs (not total filings)."""
    df = df.copy()
    
    # Create SKU key as a string for proper grouping
    df["sku_key"] = (
        df["company_name"].fillna("").str.upper().str.strip() + "|" +
        df["brand_name"].fillna("").str.upper().str.strip() + "|" +
        df["fanciful_name"].fillna("").str.upper().str.strip() + "|" +
        df["class_type_code"].fillna("").str.upper().str.strip()
    )
    
    # Count unique SKUs per week
    w = df.groupby("week")["sku_key"].nunique().reset_index(name="count").sort_values("week")
    return w


def rolling_mean(series: pd.Series, window: int) -> pd.Series:
    """Compute rolling mean."""
    return series.rolling(window=window, min_periods=window).mean()


def compute_newness_metrics(df: pd.DataFrame, week_start: datetime, week_end: datetime) -> Dict:
    """
    Compute new brand / new SKU / refile metrics for the report week.

    OPTIMIZED: Uses pre-computed 'signal' column from D1 instead of re-computing
    by comparing against all historical data. This is much faster.

    Signal values in D1:
    - NEW_COMPANY: First filing from this company
    - NEW_BRAND: First filing of this brand for this company
    - NEW_SKU: First filing of this specific SKU (brand + fanciful + class)
    - REFILE: SKU has been filed before

    Returns top 10 for each category plus full row data for Pro teaser table.
    """
    # Filter to report week
    week_df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)].copy()

    total_this_week = len(week_df)

    # Create SKU key for unique counting
    def sku_key(row):
        return (str(row.get("company_name", "")).upper().strip(),
                str(row.get("brand_name", "")).upper().strip(),
                str(row.get("fanciful_name", "")).upper().strip(),
                str(row.get("class_type_code", "")).upper().strip())

    week_df["sku_key"] = week_df.apply(sku_key, axis=1)
    unique_skus_this_week = week_df["sku_key"].nunique()

    # Use pre-computed signal column
    # Normalize signal values (handle None/NaN and variations)
    week_df["signal_norm"] = week_df["signal"].fillna("").str.upper().str.strip()

    # Count by signal type
    # NEW_COMPANY and NEW_BRAND both count as "new brands" for the report
    new_brand_mask = week_df["signal_norm"].isin(["NEW_COMPANY", "NEW_BRAND"])
    new_sku_mask = week_df["signal_norm"] == "NEW_SKU"
    refile_mask = week_df["signal_norm"] == "REFILE"

    # For new brands, count unique (company, brand) combinations
    new_brand_df = week_df[new_brand_mask].copy()
    new_brand_df["brand_key"] = new_brand_df.apply(
        lambda r: (str(r.get("company_name", "")).upper().strip(),
                   str(r.get("brand_name", "")).upper().strip()),
        axis=1
    )
    new_brands = new_brand_df["brand_key"].nunique()

    # For new SKUs, count unique SKU keys (includes NEW_COMPANY and NEW_BRAND since they're also new SKUs)
    new_sku_df = week_df[new_brand_mask | new_sku_mask].copy()
    new_skus = new_sku_df["sku_key"].nunique()

    # Refiles = unique SKUs that were seen before
    refiles = unique_skus_this_week - new_skus
    refile_share = (refiles / unique_skus_this_week * 100) if unique_skus_this_week > 0 else 0

    # Build teaser lists for new brands
    new_brand_details = []
    new_brand_rows = []
    seen_brands = set()

    for _, row in new_brand_df.drop_duplicates(subset=["brand_key"]).head(20).iterrows():
        brand_name = str(row.get("brand_name", "")).strip()
        category = row.get("category", "Other")
        fanciful = str(row.get("fanciful_name", "")).strip()
        origin = str(row.get("origin_code", "")).strip()
        approval_date = row.get("approval_date")
        ttb_id = str(row.get("ttb_id", "")).strip()
        signal = row.get("signal", "NEW_BRAND")

        brand_key = (str(row.get("company_name", "")).upper(), brand_name.upper())
        if brand_key not in seen_brands:
            seen_brands.add(brand_key)
            if len(new_brand_details) < 10:
                new_brand_details.append((brand_name, category))
            if len(new_brand_rows) < 10:
                new_brand_rows.append({
                    "brand_name": brand_name,
                    "fanciful_name": fanciful,
                    "category": category,
                    "origin": origin,
                    "approval_date": approval_date,
                    "ttb_id": ttb_id,
                    "signal": signal,
                })

    # Build teaser lists for new SKUs (only those with fanciful names, excluding new brands)
    new_sku_details = []
    new_sku_rows = []

    sku_only_df = week_df[new_sku_mask].copy()  # Only NEW_SKU, not NEW_BRAND/NEW_COMPANY
    for _, row in sku_only_df.drop_duplicates(subset=["sku_key"]).head(20).iterrows():
        brand_name = str(row.get("brand_name", "")).strip()
        fanciful = str(row.get("fanciful_name", "")).strip()
        category = row.get("category", "Other")
        origin = str(row.get("origin_code", "")).strip()
        approval_date = row.get("approval_date")
        ttb_id = str(row.get("ttb_id", "")).strip()

        # Only add to teaser list if it has a real fanciful name
        if fanciful and fanciful.upper() not in ("NONE", "N/A", ""):
            sku_display = f"{brand_name} - {fanciful}"
            if len(new_sku_details) < 10:
                new_sku_details.append((sku_display, category))
            if len(new_sku_rows) < 10:
                new_sku_rows.append({
                    "brand_name": brand_name,
                    "fanciful_name": fanciful,
                    "category": category,
                    "origin": origin,
                    "approval_date": approval_date,
                    "ttb_id": ttb_id,
                    "signal": "NEW_SKU",
                })

    return {
        "total_approvals": total_this_week,
        "unique_approvals": unique_skus_this_week,
        "new_brands": new_brands,
        "new_skus": new_skus,
        "refiles": refiles,
        "refile_share": refile_share,
        "top_new_brands": new_brand_details[:10],
        "top_new_skus": new_sku_details[:10],
        "new_brand_rows": new_brand_rows[:10],
        "new_sku_rows": new_sku_rows[:10],
    }


def compute_category_metrics(df: pd.DataFrame, week_start: datetime, week_end: datetime) -> pd.DataFrame:
    """Compute per-category metrics for the headline table."""
    week_df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)]
    
    # Total approvals by category this week
    cat_totals = week_df.groupby("category").size().reset_index(name="total_this_week")
    
    # Unique approvals by category (unique SKU keys)
    def sku_key(row):
        return (str(row.get("company_name", "")).upper().strip(),
                str(row.get("brand_name", "")).upper().strip(),
                str(row.get("fanciful_name", "")).upper().strip(),
                str(row.get("class_type_code", "")).upper().strip())
    
    week_df_copy = week_df.copy()
    week_df_copy["sku_key"] = week_df_copy.apply(sku_key, axis=1)
    cat_unique = week_df_copy.groupby("category")["sku_key"].nunique().reset_index(name="unique_this_week")
    
    # 13-week and 52-week averages
    weeks_13_ago = week_start - timedelta(weeks=13)
    weeks_52_ago = week_start - timedelta(weeks=52)
    
    df_13w = df[(df["approval_date"] >= weeks_13_ago) & (df["approval_date"] < week_start)]
    df_52w = df[(df["approval_date"] >= weeks_52_ago) & (df["approval_date"] < week_start)]
    
    cat_13w = df_13w.groupby("category").size().reset_index(name="count_13w")
    cat_13w["avg_13w"] = cat_13w["count_13w"] / 13
    
    cat_52w = df_52w.groupby("category").size().reset_index(name="count_52w")
    cat_52w["avg_52w"] = cat_52w["count_52w"] / 52
    
    # Merge all
    result = cat_totals.merge(cat_unique, on="category", how="outer")
    result = result.merge(cat_13w[["category", "avg_13w"]], on="category", how="outer")
    result = result.merge(cat_52w[["category", "avg_52w"]], on="category", how="outer")
    result = result.fillna(0)
    
    # Sort by category order
    result["sort_order"] = result["category"].apply(lambda x: CATEGORY_ORDER.index(x) if x in CATEGORY_ORDER else 99)
    result = result.sort_values("sort_order").drop(columns=["sort_order"])
    
    return result


def compute_metrics(df: pd.DataFrame) -> Dict:
    """Compute all metrics for the report."""
    today = datetime.now()
    week_start, week_end = last_complete_week(today)
    
    # Total filings weekly series (for reference)
    w = weekly_series(df)
    
    # Unique SKUs weekly series (for charts - this is the primary metric)
    w_unique = weekly_series_unique(df)
    
    current_week_monday = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    this_week_count = int(w.loc[w["week"] == current_week_monday, "count"].sum())
    
    # Rolling averages for unique SKUs (used in charts)
    w_unique["ma_4"] = rolling_mean(w_unique["count"], 4)
    w_unique["ma_13"] = rolling_mean(w_unique["count"], 13)
    w_unique["ma_52"] = rolling_mean(w_unique["count"], 52)
    
    w_curr = w_unique[w_unique["week"] <= current_week_monday].copy()
    if w_curr.empty:
        raise RuntimeError("No weekly data up to the current report week.")
    last_row = w_curr.iloc[-1]
    
    pace_4 = float(last_row["ma_4"]) if not np.isnan(last_row["ma_4"]) else float(w_curr["count"].tail(4).mean())
    pace_13 = float(last_row["ma_13"]) if not np.isnan(last_row["ma_13"]) else float(w_curr["count"].tail(13).mean())
    
    # YoY on 4-week pace
    w_curr = w_curr.reset_index(drop=True)
    tail4 = w_curr["count"].tail(4)
    last4_avg = float(tail4.mean())
    
    if len(w_curr) >= 56:
        last_year_window = w_curr["count"].iloc[-(52+4):-(52)]
        last_year_avg = float(last_year_window.mean()) if len(last_year_window) == 4 else np.nan
    else:
        last_year_avg = np.nan
    
    yoy_4w = ((last4_avg - last_year_avg) / last_year_avg * 100) if (last_year_avg and not np.isnan(last_year_avg) and last_year_avg > 0) else np.nan
    
    # Direction
    if len(w_curr) >= 8:
        prior4_avg = float(w_curr["count"].iloc[-8:-4].mean())
        accel = ((last4_avg - prior4_avg) / prior4_avg * 100) if prior4_avg > 0 else np.nan
    else:
        accel = np.nan
    
    if np.isnan(accel):
        direction = "Unclear"
    else:
        direction = "Heating up" if accel > 0 else "Cooling down" if accel < 0 else "Flat"
    
    # Newness metrics
    newness = compute_newness_metrics(df, week_start, week_end)
    
    # Category metrics
    category_df = compute_category_metrics(df, week_start, week_end)
    
    # Compute unique SKU averages for 4w and 13w (for delta comparison)
    # We need to compute unique SKUs per week for the past weeks
    def sku_key(row):
        return (str(row.get("company_name", "")).upper().strip(),
                str(row.get("brand_name", "")).upper().strip(),
                str(row.get("fanciful_name", "")).upper().strip(),
                str(row.get("class_type_code", "")).upper().strip())
    
    # Get unique SKUs per week for past 13 weeks
    weeks_back_13 = week_start - timedelta(weeks=13)
    recent_df = df[(df["approval_date"] >= weeks_back_13) & (df["approval_date"] < week_start)].copy()
    
    if len(recent_df) > 0:
        recent_df["sku_key"] = recent_df.apply(sku_key, axis=1)
        weekly_unique = recent_df.groupby("week")["sku_key"].nunique().reset_index(name="unique_count")
        
        # 4-week average (last 4 weeks before this week)
        weeks_4 = weekly_unique.tail(4)
        unique_4w_avg = weeks_4["unique_count"].mean() if len(weeks_4) > 0 else 0
        
        # 13-week average
        unique_13w_avg = weekly_unique["unique_count"].mean() if len(weekly_unique) > 0 else 0
    else:
        unique_4w_avg = 0
        unique_13w_avg = 0
    
    # Delta calculations
    unique_this_week = newness["unique_approvals"]
    delta_vs_4w = ((unique_this_week / unique_4w_avg) - 1) * 100 if unique_4w_avg > 0 else 0
    delta_vs_13w = ((unique_this_week / unique_13w_avg) - 1) * 100 if unique_13w_avg > 0 else 0
    
    return {
        "week_start": week_start,
        "week_end": week_end,
        "week_end_label": week_end.strftime("%B %d, %Y"),
        "week_range_label": f"{week_start.strftime('%B %d')} — {week_end.strftime('%B %d, %Y')}",
        "this_week_count": this_week_count,
        "pace_4": pace_4,
        "pace_13": pace_13,
        "yoy_4w": yoy_4w,
        "direction": direction,
        "weekly_df": w_unique,  # Use unique-based series for charts
        "report_week_monday": current_week_monday,
        # Newness metrics
        "total_approvals": newness["total_approvals"],
        "unique_approvals": newness["unique_approvals"],
        "new_brands": newness["new_brands"],
        "new_skus": newness["new_skus"],
        "refiles": newness["refiles"],
        "refile_share": newness["refile_share"],
        "top_new_brands": newness["top_new_brands"],
        "top_new_skus": newness["top_new_skus"],
        "new_brand_rows": newness.get("new_brand_rows", []),  # Full row data for Pro teaser
        "new_sku_rows": newness.get("new_sku_rows", []),      # Full row data for Pro teaser
        # Delta vs averages (unique-based)
        "delta_vs_4w": delta_vs_4w,
        "delta_vs_13w": delta_vs_13w,
        # Category breakdown
        "category_df": category_df,
    }


# =============================================================================
# CHART HELPERS
# =============================================================================

def _save_fig(fig, out_path: str, dpi: int = 200):
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight", facecolor="white", edgecolor="none")
    plt.close(fig)


def add_watermark(ax):
    ax.text(0.99, 0.01, "bevalcintel.com", transform=ax.transAxes, ha="right", va="bottom",
            fontsize=8, color=COLORS["muted"], alpha=0.7)


def chart_market_direction(weekly_df: pd.DataFrame, out_path: str):
    """
    Single chart showing rolling 4-week, 13-week, and 52-week moving averages of unique SKUs.
    """
    df = weekly_df.copy()
    df = df.sort_values("week")
    
    # Calculate MAs if not present
    if "ma_4" not in df.columns:
        df["ma_4"] = rolling_mean(df["count"], 4)
    if "ma_13" not in df.columns:
        df["ma_13"] = rolling_mean(df["count"], 13)
    if "ma_52" not in df.columns:
        df["ma_52"] = rolling_mean(df["count"], 52)
    
    # Last 2.5 years for clarity
    cutoff = df["week"].max() - timedelta(weeks=130)
    df = df[df["week"] >= cutoff]
    
    fig, ax = plt.subplots(figsize=(8, 2.8))
    
    ax.plot(df["week"], df["ma_4"], color=COLORS["secondary"], linewidth=2, label="Rolling 4-week average")
    ax.plot(df["week"], df["ma_13"], color=COLORS["primary"], linewidth=2, label="Rolling 13-week average")
    ax.plot(df["week"], df["ma_52"], color=COLORS["gold"], linewidth=1.5, linestyle="--", label="Rolling 52-week average")
    
    ax.set_ylabel("Unique SKUs per week", fontsize=9)
    ax.set_xlabel("Week", fontsize=9)
    ax.legend(loc="lower left", fontsize=8, frameon=False)
    ax.grid(True, alpha=0.2)
    ax.set_ylim(bottom=0)
    
    # Remove top/right spines
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    
    # Format x-axis
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b\n%Y"))
    ax.tick_params(axis="both", labelsize=8)
    
    add_watermark(ax)
    fig.tight_layout()
    _save_fig(fig, out_path)


def chart_category_trends(df: pd.DataFrame, out_path: str):
    """Small multiples showing each category's weekly approvals + 13-week MA."""
    categories = ['Whiskey', 'Wine', 'Beer', 'Tequila', 'Vodka', 'RTD', 'Rum', 'Gin']
    
    # Last 2 years
    cutoff = df["week"].max() - timedelta(weeks=104)
    df_filtered = df[df["approval_date"] >= cutoff].copy()
    
    fig, axes = plt.subplots(4, 2, figsize=(8, 6.5))
    axes = axes.flatten()
    
    for idx, cat in enumerate(categories):
        ax = axes[idx]
        cat_df = df_filtered[df_filtered["category"] == cat]
        weekly = cat_df.groupby("week").size().reset_index(name="count")
        weekly = weekly.sort_values("week")
        weekly["ma_13"] = rolling_mean(weekly["count"], 13)
        
        ax.bar(weekly["week"], weekly["count"], color=COLORS["bar"], alpha=0.7, width=5)
        ax.plot(weekly["week"], weekly["ma_13"], color=COLORS["line"], linewidth=1.5)
        
        ax.set_title(cat, fontsize=10, fontweight="bold", color=COLORS["primary"])
        ax.set_ylim(bottom=0)
        ax.tick_params(axis="both", labelsize=7)
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=4))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b\n%Y"))
        ax.grid(True, alpha=0.2)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
    
    fig.suptitle("Category Trends (Last 2 Years): bars = weekly, line = 13-week avg",
                 fontsize=10, y=0.995)
    fig.tight_layout()
    _save_fig(fig, out_path)


def chart_competitive_activity(df: pd.DataFrame, week_start: datetime, week_end: datetime, out_path: str):
    """Horizontal bar chart of top brands by unique SKUs this week."""
    week_df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)].copy()
    
    # Helper for normalization
    def norm(s):
        return str(s or "").upper().strip()
    
    # Create proper keys - brand_id for grouping, sku_key for unique counting
    week_df["brand_id"] = week_df.apply(
        lambda r: (norm(r["company_name"]), norm(r["brand_name"])), axis=1
    )
    week_df["sku_key"] = week_df.apply(
        lambda r: (norm(r["company_name"]), norm(r["brand_name"]),
                   norm(r["fanciful_name"]), norm(r["class_type_code"])), axis=1
    )
    
    # Create display label: BRAND (COMPANY)
    week_df["brand_label"] = week_df.apply(
        lambda r: f"{r['brand_name']} ({r['company_name'][:25]}{'...' if len(str(r['company_name'])) > 25 else ''})", 
        axis=1
    )
    
    # Count unique SKUs per brand_id
    brand_counts = week_df.groupby("brand_id").agg({
        "sku_key": "nunique",
        "brand_label": "first"  # Get one label per brand_id
    }).reset_index()
    brand_counts.columns = ["brand_id", "count", "label"]
    brand_counts = brand_counts.sort_values("count", ascending=False).head(12)
    brand_counts = brand_counts.sort_values("count", ascending=True)  # Reverse for horizontal bar
    
    fig, ax = plt.subplots(figsize=(8, 4.5))
    
    y_pos = range(len(brand_counts))
    bars = ax.barh(y_pos, brand_counts["count"], color=COLORS["primary"], alpha=0.85)
    
    ax.set_yticks(y_pos)
    ax.set_yticklabels(brand_counts["label"], fontsize=8)
    ax.set_xlabel("Unique SKUs", fontsize=9)
    ax.set_title("Top brands by unique SKUs this week", fontsize=10, fontweight="bold")
    ax.tick_params(axis="both", labelsize=8)
    ax.grid(True, axis="x", alpha=0.2)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    
    # Simple count annotations (no vs-avg)
    for idx, count in enumerate(brand_counts["count"]):
        ax.text(count + 0.2, idx, f"{count}", va="center", fontsize=8)
    
    ax.set_xlim(0, brand_counts["count"].max() * 1.25)
    add_watermark(ax)
    fig.tight_layout()
    _save_fig(fig, out_path)


def chart_origin_mix(df: pd.DataFrame, week_start: datetime, week_end: datetime, out_path: str):
    """Pie chart of domestic/import + bar chart of top origins."""
    week_df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)]
    
    # Classify as domestic (US states) vs import (countries)
    us_states = {'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO', 'CONNECTICUT',
                 'DELAWARE', 'FLORIDA', 'GEORGIA', 'HAWAII', 'IDAHO', 'ILLINOIS', 'INDIANA', 'IOWA',
                 'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE', 'MARYLAND', 'MASSACHUSETTS', 'MICHIGAN',
                 'MINNESOTA', 'MISSISSIPPI', 'MISSOURI', 'MONTANA', 'NEBRASKA', 'NEVADA', 'NEW HAMPSHIRE',
                 'NEW JERSEY', 'NEW MEXICO', 'NEW YORK', 'NORTH CAROLINA', 'NORTH DAKOTA', 'OHIO',
                 'OKLAHOMA', 'OREGON', 'PENNSYLVANIA', 'RHODE ISLAND', 'SOUTH CAROLINA', 'SOUTH DAKOTA',
                 'TENNESSEE', 'TEXAS', 'UTAH', 'VERMONT', 'VIRGINIA', 'WASHINGTON', 'WEST VIRGINIA',
                 'WISCONSIN', 'WYOMING', 'DISTRICT OF COLUMBIA', 'PUERTO RICO', 'VIRGIN ISLANDS'}
    
    week_df = week_df.copy()
    week_df["origin_upper"] = week_df["origin_code"].fillna("").str.upper().str.strip()
    week_df["is_domestic"] = week_df["origin_upper"].isin(us_states)
    
    domestic_count = week_df["is_domestic"].sum()
    import_count = len(week_df) - domestic_count
    total = len(week_df)
    
    # Top origins
    origin_counts = week_df.groupby("origin_code").size().reset_index(name="count")
    origin_counts = origin_counts.sort_values("count", ascending=False).head(10)
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8, 4), gridspec_kw={'width_ratios': [1, 1.3]})
    
    # Pie chart - force perfect circle
    if total > 0:
        sizes = [domestic_count, import_count]
        labels = [f"Domestic\n{domestic_count/total*100:.0f}%", f"Import\n{import_count/total*100:.0f}%"]
        colors = [COLORS["primary"], COLORS["gold"]]
        ax1.pie(sizes, labels=labels, colors=colors, autopct="", startangle=90, 
                textprops={'fontsize': 9})
        ax1.axis('equal')  # Force perfect circle
        ax1.set_title("Origin mix (this week)", fontsize=10, fontweight="bold")
    
    # Bar chart - no percentage annotations
    origin_counts_sorted = origin_counts.sort_values("count", ascending=True)
    y_pos = range(len(origin_counts_sorted))
    ax2.barh(y_pos, origin_counts_sorted["count"], color=COLORS["primary"], alpha=0.85)
    ax2.set_yticks(y_pos)
    ax2.set_yticklabels(origin_counts_sorted["origin_code"], fontsize=8)
    ax2.set_xlabel("Approvals (this week)", fontsize=9)
    ax2.set_title("Top origins this week", fontsize=10, fontweight="bold")
    ax2.tick_params(axis="both", labelsize=8)
    ax2.grid(True, axis="x", alpha=0.2)
    ax2.spines["top"].set_visible(False)
    ax2.spines["right"].set_visible(False)
    
    # Just show count, no percentage
    for idx, count in enumerate(origin_counts_sorted["count"]):
        ax2.text(count + 0.5, idx, f"{count}", va="center", fontsize=8)
    
    ax2.set_xlim(0, origin_counts_sorted["count"].max() * 1.3)
    
    add_watermark(ax2)
    fig.tight_layout()
    _save_fig(fig, out_path)


# =============================================================================
# PDF BUILD
# =============================================================================

def _logo_dims(max_w: float, max_h: float):
    if not os.path.exists(LOGO_PATH):
        return None
    img = ImageReader(LOGO_PATH)
    iw, ih = img.getSize()
    scale = min(max_w / iw, max_h / ih)
    return (iw * scale, ih * scale)


def draw_header_footer(canvas, doc):
    # Logo
    if os.path.exists(LOGO_PATH):
        dims = _logo_dims(max_w=1.0*inch, max_h=0.5*inch)
        if dims:
            w, h = dims
            x = doc.pagesize[0] - doc.rightMargin - w
            y = doc.pagesize[1] - doc.topMargin + 0.12*inch
            canvas.drawImage(LOGO_PATH, x, y, width=w, height=h, mask="auto")
    
    # Header divider line
    canvas.setStrokeColor(HexColor(COLORS["grid"]))
    canvas.setLineWidth(0.5)
    line_y = doc.pagesize[1] - doc.topMargin + 0.02*inch
    canvas.line(doc.leftMargin, line_y, doc.pagesize[0] - doc.rightMargin, line_y)
    
    # Footer: database link on left, page number on right
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(HexColor(COLORS["primary"]))
    canvas.drawString(doc.leftMargin, 0.4*inch, "bevalcintel.com/database")
    
    canvas.setFillColor(HexColor(COLORS["muted"]))
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 0.4*inch, f"Page {doc.page}")


def make_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name="BI_Title", parent=styles["Heading1"], fontSize=22,
        alignment=TA_CENTER, textColor=HexColor(COLORS["secondary"]), spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="BI_Subtitle", parent=styles["Normal"], fontSize=10,
        alignment=TA_CENTER, textColor=HexColor(COLORS["muted"]), spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="BI_Body", parent=styles["Normal"], fontSize=10,
        leading=13, textColor=HexColor(COLORS["text"]), spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="BI_Section", parent=styles["Heading2"], fontSize=13,
        textColor=HexColor(COLORS["primary"]), spaceBefore=10, spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="BI_Small", parent=styles["Normal"], fontSize=9,
        leading=11, textColor=HexColor(COLORS["muted"]), spaceAfter=3,
    ))
    styles.add(ParagraphStyle(
        name="BI_TableCell", parent=styles["Normal"], fontSize=9,
        leading=11, textColor=HexColor(COLORS["text"]),
    ))
    styles.add(ParagraphStyle(
        name="BI_TableHeader", parent=styles["Normal"], fontSize=8.5,
        leading=10, textColor=white, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="BI_TableCellRight", parent=styles["Normal"], fontSize=9,
        leading=11, textColor=HexColor(COLORS["text"]), alignment=2,  # RIGHT
    ))
    styles.add(ParagraphStyle(
        name="BI_Footnote", parent=styles["Normal"], fontSize=8,
        leading=10, textColor=HexColor(COLORS["muted"]), spaceAfter=4,
    ))
    # Scoreboard styles
    styles.add(ParagraphStyle(
        name="BI_ScoreLabel", parent=styles["Normal"], fontSize=9,
        leading=11, textColor=HexColor(COLORS["muted"]), alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="BI_ScoreValue", parent=styles["Normal"], fontSize=18,
        leading=20, textColor=HexColor(COLORS["secondary"]), alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    ))
    # CTA box styles
    styles.add(ParagraphStyle(
        name="BI_CTATitle", parent=styles["Heading2"], fontSize=11,
        textColor=HexColor(COLORS["secondary"]), spaceBefore=0, spaceAfter=4,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="BI_CTABody", parent=styles["Normal"], fontSize=9,
        leading=12, textColor=HexColor(COLORS["text"]), spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name="BI_CTABold", parent=styles["Normal"], fontSize=9,
        leading=12, textColor=HexColor(COLORS["text"]), spaceAfter=2,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="BI_Locked", parent=styles["Normal"], fontSize=8,
        leading=10, textColor=HexColor(COLORS["muted"]), alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="BI_PlayTitle", parent=styles["Normal"], fontSize=10,
        leading=12, textColor=HexColor(COLORS["primary"]), spaceAfter=2,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="BI_PlayBody", parent=styles["Normal"], fontSize=9,
        leading=11, textColor=HexColor(COLORS["text"]), spaceAfter=6,
    ))
    return styles


def build_pdf(df: pd.DataFrame, metrics: Dict, out_pdf: str):
    os.makedirs(os.path.dirname(out_pdf), exist_ok=True)
    styles = make_styles()

    assets_dir = os.path.join(os.path.dirname(out_pdf), "_assets")
    os.makedirs(assets_dir, exist_ok=True)

    def asset(name: str) -> str:
        return os.path.join(assets_dir, name)

    doc = SimpleDocTemplate(
        out_pdf, pagesize=letter,
        leftMargin=0.65*inch, rightMargin=0.65*inch,
        topMargin=0.75*inch, bottomMargin=0.65*inch,
        title="BevAlc Intelligence — Weekly Snapshot"
    )

    story = []

    # ==========================================================================
    # PAGE 1 — HOOK: METRICS + TOP 5 TEASERS
    # ==========================================================================
    story.append(Paragraph("BevAlc Intelligence", styles["BI_Title"]))
    story.append(Paragraph("Market Pulse — Weekly Snapshot (Free)", styles["BI_Subtitle"]))
    story.append(Paragraph(
        f"Report for week ending <b>{metrics['week_end_label']}</b> "
        f"(<span color='{COLORS['muted']}'>{metrics['week_range_label']}</span>)",
        styles["BI_Subtitle"]
    ))
    story.append(Paragraph(
        "COLA approvals often appear weeks before products hit shelves. "
        "This snapshot shows what's new and what to investigate next.",
        styles["BI_Small"]
    ))
    story.append(Spacer(1, 6))

    # ==========================================================================
    # SCOREBOARD - 2 rows of 3 metrics
    # ==========================================================================
    def score_cell(label, value, subtext=None):
        content = [
            Paragraph(f"<font size='20' color='{COLORS['secondary']}'><b>{value}</b></font>", styles["BI_ScoreValue"]),
            Paragraph(label, styles["BI_ScoreLabel"]),
        ]
        if subtext:
            content.append(Paragraph(f"<font size='8' color='{COLORS['muted']}'>{subtext}</font>", styles["BI_ScoreLabel"]))
        return content
    
    # Format delta (only 13W now)
    delta_13w = metrics.get("delta_vs_13w", 0)
    delta_text = f"{delta_13w:+.0f}% vs 13-week avg"
    
    # Refile share
    refile_share = (metrics['refiles'] / metrics['unique_approvals'] * 100) if metrics['unique_approvals'] > 0 else 0
    
    # Row 1: Total Approvals | Unique SKUs (with delta) | Refile Share (with subtext)
    row1_data = [[
        score_cell("Total Approvals", f"{metrics['total_approvals']:,}"),
        score_cell("Unique SKUs", f"{metrics['unique_approvals']:,}", delta_text),
        score_cell("Refile Share", f"{refile_share:.1f}%", "of unique SKUs"),
    ]]
    
    # Row 2: New Brands (with subtext) | New SKUs | Refiles
    row2_data = [[
        score_cell("New Brands (first-seen)", f"{metrics['new_brands']:,}", "not seen in prior history"),
        score_cell("New SKUs", f"{metrics['new_skus']:,}"),
        score_cell("Refiles", f"{metrics['refiles']:,}"),
    ]]
    
    row1_tbl = Table(row1_data, colWidths=[2.2*inch]*3)
    row1_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    
    row2_tbl = Table(row2_data, colWidths=[2.2*inch]*3)
    row2_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, HexColor(COLORS["grid"])),
    ]))
    
    story.append(row1_tbl)
    story.append(row2_tbl)
    story.append(Spacer(1, 2))
    story.append(Paragraph(
        "<i>Total = filings this week. All other metrics = unique combinations.</i>",
        styles["BI_Footnote"]
    ))
    story.append(Spacer(1, 8))
    
    # ==========================================================================
    # TOP 5 TEASER TABLES - Names with category as muted subtext
    # ==========================================================================
    story.append(Paragraph("New This Week (Preview)", styles["BI_Section"]))
    
    def p(txt): return Paragraph(txt, styles["BI_TableCell"])
    def ph(txt): return Paragraph(txt, styles["BI_TableHeader"])
    def pr(txt): return Paragraph(txt, styles["BI_TableCellRight"])
    
    # Top New Brands table - single column with category as subtext
    brands_data = [[ph("Top 5 New Brands")]]
    brand_items = metrics.get("top_new_brands", [])[:5]
    for item in brand_items:
        if isinstance(item, tuple):
            brand_name, category = item
        else:
            brand_name, category = item, ""
        cell_text = f"{brand_name}<br/><font size='7' color='{COLORS['muted']}'>{category}</font>" if category else brand_name
        brands_data.append([Paragraph(cell_text, styles["BI_TableCell"])])
    # Pad to 6 rows if needed
    while len(brands_data) < 6:
        brands_data.append([p("—")])
    
    brands_tbl = Table(brands_data, colWidths=[3.3*inch], rowHeights=[22] + [32]*5)
    brands_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    
    # Top New SKUs table - single column with category as subtext
    skus_data = [[ph("Top 5 New SKUs")]]
    sku_items = metrics.get("top_new_skus", [])[:5]
    for item in sku_items:
        if isinstance(item, tuple):
            sku_name, category = item
        else:
            sku_name, category = item, ""
        # Truncate if too long
        display_sku = sku_name[:45] + "..." if len(sku_name) > 45 else sku_name
        cell_text = f"{display_sku}<br/><font size='7' color='{COLORS['muted']}'>{category}</font>" if category else display_sku
        skus_data.append([Paragraph(cell_text, styles["BI_TableCell"])])
    # Pad to 6 rows if needed
    while len(skus_data) < 6:
        skus_data.append([p("—")])
    
    skus_tbl = Table(skus_data, colWidths=[3.3*inch], rowHeights=[22] + [32]*5)
    skus_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    
    # Side by side
    teaser_row = Table([[brands_tbl, Spacer(0.15*inch, 0), skus_tbl]])
    story.append(teaser_row)
    story.append(Spacer(1, 8))
    
    # ==========================================================================
    # "DO THIS NEXT (60 seconds)" CTA BOX
    # ==========================================================================
    # Get first 3 brands for dynamic inserts
    first_brand = ""
    second_brand = ""
    third_brand = ""
    if brand_items:
        first_brand = brand_items[0][0] if isinstance(brand_items[0], tuple) else brand_items[0]
        if len(brand_items) > 1:
            second_brand = brand_items[1][0] if isinstance(brand_items[1], tuple) else brand_items[1]
        if len(brand_items) > 2:
            third_brand = brand_items[2][0] if isinstance(brand_items[2], tuple) else brand_items[2]
    
    cta_content = []
    cta_content.append(Paragraph("<b>Do this next (takes 60 seconds)</b>", styles["BI_CTATitle"]))
    cta_content.append(Paragraph(
        "1) Open the database and search any name below.<br/>"
        "2) Click a record to see full label details + filing history.<br/>"
        "3) If it's a competitor, add it to your watchlist (Pro).",
        styles["BI_CTABody"]
    ))
    cta_content.append(Spacer(1, 4))
    cta_content.append(Paragraph("<b>Start here:</b>", styles["BI_CTABody"]))
    if first_brand:
        cta_content.append(Paragraph(
            f"• In search, type: <b><a href='https://bevalcintel.com/database' color='{COLORS['primary']}'>{first_brand}</a></b>",
            styles["BI_CTABody"]
        ))
    if second_brand:
        cta_content.append(Paragraph(
            f"• In search, type: <b><a href='https://bevalcintel.com/database' color='{COLORS['primary']}'>{second_brand}</a></b>",
            styles["BI_CTABody"]
        ))
    if third_brand:
        cta_content.append(Paragraph(
            f"• In search, type: <b><a href='https://bevalcintel.com/database' color='{COLORS['primary']}'>{third_brand}</a></b>",
            styles["BI_CTABody"]
        ))
    cta_content.append(Spacer(1, 6))
    
    # Button-style link
    button_tbl = Table(
        [[Paragraph(
            f"<b><a href='https://bevalcintel.com/database' color='white'>Open the database →</a></b>",
            ParagraphStyle("btn", parent=styles["BI_CTABody"], textColor=white, alignment=TA_CENTER)
        )]],
        colWidths=[2.2*inch]
    )
    button_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor(COLORS["primary"])),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    cta_content.append(button_tbl)
    cta_content.append(Spacer(1, 4))
    cta_content.append(Paragraph(
        f"<b>Upgrade to Pro:</b> Full lists + watchlists + CSV exports + label image links ($49/mo)",
        styles["BI_Small"]
    ))
    
    cta_box = Table([[cta_content]], colWidths=[6.8*inch])
    cta_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#f0fdfa")),
        ("BOX", (0, 0), (-1, -1), 1.5, HexColor(COLORS["primary"])),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(cta_box)
    
    # ========== PAGE 1 ENDS HERE ==========
    story.append(PageBreak())
    
    # ==========================================================================
    # PAGE 2 — CATEGORY TABLE + PRO EXAMPLE TABLE
    # ==========================================================================
    story.append(Paragraph("Unique SKUs by Category (This Week)", styles["BI_Section"]))
    
    cat_df = metrics["category_df"].copy()
    cat_df = cat_df.sort_values("unique_this_week", ascending=False)
    
    # Build single table with 4 columns (Cat1, Unique1, Cat2, Unique2)
    categories = list(cat_df.iterrows())
    mid = (len(categories) + 1) // 2
    left_cats = categories[:mid]
    right_cats = categories[mid:]
    
    # Pad right side if uneven
    while len(right_cats) < len(left_cats):
        right_cats.append((None, {"category": "", "unique_this_week": ""}))
    
    # Build combined table data
    cat_table_data = [[ph("Category"), ph("Unique"), ph("Category"), ph("Unique")]]
    for (_, left_row), (_, right_row) in zip(left_cats, right_cats):
        left_cat = left_row["category"] if left_row["category"] else ""
        left_val = f"{int(left_row['unique_this_week']):,}" if left_row["unique_this_week"] != "" else ""
        right_cat = right_row["category"] if right_row["category"] else ""
        right_val = f"{int(right_row['unique_this_week']):,}" if right_row["unique_this_week"] != "" else ""
        cat_table_data.append([p(left_cat), pr(left_val), p(right_cat), pr(right_val)])
    
    cat_tbl = Table(cat_table_data, colWidths=[1.5*inch, 0.7*inch, 1.5*inch, 0.7*inch])
    cat_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("ALIGN", (2, 0), (2, -1), "LEFT"),
        ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        # Add vertical line between left and right sections (data rows only, not header)
        ("LINEAFTER", (1, 1), (1, -1), 0.75, HexColor(COLORS["secondary"])),
    ]))
    
    # Center the table
    cat_wrapper = Table([[cat_tbl]], colWidths=[7*inch])
    cat_wrapper.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(cat_wrapper)
    story.append(Spacer(1, 8))
    
    # ==========================================================================
    # "WHAT PRO MEMBERS GET (EXAMPLE)" TABLE - 6 ROWS
    # ==========================================================================
    
    # Build 6 rows with robust fallback
    new_sku_rows = metrics.get("new_sku_rows", [])
    new_brand_rows = metrics.get("new_brand_rows", [])
    
    # Primary: take from Top New SKUs first
    teaser_rows = []
    teaser_rows.extend(new_sku_rows[:4])
    
    # Fill remaining from Top New Brands
    if len(teaser_rows) < 6:
        teaser_rows.extend(new_brand_rows[:6-len(teaser_rows)])
    
    # If still need more, pull additional from SKUs
    if len(teaser_rows) < 6:
        remaining_skus = new_sku_rows[4:]
        teaser_rows.extend(remaining_skus[:6-len(teaser_rows)])
    
    # FALLBACK: If still < 6, pull from week's raw data
    if len(teaser_rows) < 6:
        week_start = metrics.get("week_start")
        week_end = metrics.get("week_end")
        if week_start and week_end:
            week_df_fallback = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)].copy()
            week_df_fallback = week_df_fallback.sort_values("approval_date", ascending=False).head(6 - len(teaser_rows))
            for _, row in week_df_fallback.iterrows():
                teaser_rows.append({
                    "brand_name": str(row.get("brand_name", "")).strip(),
                    "fanciful_name": str(row.get("fanciful_name", "")).strip(),
                    "category": row.get("category", "Other"),
                    "origin": str(row.get("origin_code", "")).strip(),
                    "approval_date": row.get("approval_date"),
                    "ttb_id": str(row.get("ttb_id", "")).strip(),
                    "signal": "REFILE",
                })
    
    # Only render the table if we have data
    if len(teaser_rows) > 0:
        story.append(Paragraph("What Pro Members Get (Example)", styles["BI_Section"]))
        
        # State/Country abbreviation mapping
        ORIGIN_ABBREV = {
            'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA',
            'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA',
            'HAWAII': 'HI', 'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA',
            'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
            'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS', 'MISSOURI': 'MO',
            'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
            'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH',
            'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
            'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT',
            'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY',
            'DISTRICT OF COLUMBIA': 'DC', 'PUERTO RICO': 'PR',
            # Countries
            'FRANCE': 'FR', 'SPAIN': 'ES', 'ITALY': 'IT', 'GERMANY': 'DE', 'UNITED KINGDOM': 'UK',
            'MEXICO': 'MX', 'CANADA': 'CA', 'AUSTRALIA': 'AU', 'ARGENTINA': 'AR', 'CHILE': 'CL',
            'IRELAND': 'IE', 'SCOTLAND': 'SCO', 'JAPAN': 'JP', 'NEW ZEALAND': 'NZ', 'SOUTH AFRICA': 'ZA',
            'PORTUGAL': 'PT', 'NETHERLANDS': 'NL', 'BELGIUM': 'BE', 'AUSTRIA': 'AT', 'GREECE': 'GR',
        }
        
        # Header row
        pro_teaser_data = [[
            ph("Brand"),
            ph("SKU"),
            ph("Signal"),
            ph("Approved"),
            ph("Origin"),
            ph("TTB Link"),
        ]]
        
        # Data rows - show ALL columns
        for row in teaser_rows[:6]:
            brand = row.get("brand_name", "")
            brand_display = brand[:20] + "..." if len(brand) > 20 else brand if brand else "—"
            
            # SKU column = fanciful_name, fallback to product_name or placeholder
            fanciful = row.get("fanciful_name", "")
            if fanciful and fanciful.upper() not in ("NONE", "N/A", ""):
                sku_display = fanciful[:22] + "..." if len(fanciful) > 22 else fanciful
            else:
                # Fallback to product_name if available
                product_name = row.get("product_name", "")
                if product_name and product_name.upper() not in ("NONE", "N/A", ""):
                    sku_display = product_name[:22] + "..." if len(product_name) > 22 else product_name
                else:
                    sku_display = "(No fanciful name)"
            
            approval_date = row.get("approval_date")
            if hasattr(approval_date, 'strftime'):
                date_str = approval_date.strftime("%m/%d/%Y")
            else:
                date_str = str(approval_date)[:10] if approval_date else "—"
            
            # Origin - convert to abbreviation
            origin = row.get("origin", "").upper().strip()
            origin_display = ORIGIN_ABBREV.get(origin, origin[:8] if origin else "—")
            
            # Signal - show actual value
            signal = row.get("signal", "—")
            signal_display = signal if signal else "—"
            
            # TTB Link - show "View →" link
            ttb_id = row.get("ttb_id", "")
            if ttb_id:
                ttb_link = Paragraph(
                    f"<a href='https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={ttb_id}' color='{COLORS['primary']}'>View →</a>",
                    styles["BI_TableCell"]
                )
            else:
                ttb_link = p("—")
            
            pro_teaser_data.append([
                p(brand_display),
                p(sku_display),
                p(signal_display),
                p(date_str),
                p(origin_display),
                ttb_link,
            ])
        
        pro_teaser_tbl = Table(
            pro_teaser_data,
            colWidths=[1.2*inch, 1.6*inch, 0.7*inch, 0.8*inch, 0.55*inch, 0.6*inch]
        )
        pro_teaser_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("ALIGN", (0, 1), (1, -1), "LEFT"),
            ("ALIGN", (2, 1), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        
        # Center the table
        pro_wrapper = Table([[pro_teaser_tbl]], colWidths=[7*inch])
        pro_wrapper.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        story.append(pro_wrapper)
    
    story.append(Spacer(1, 6))
    
    # ==========================================================================
    # MARKET DIRECTION (on Page 2)
    # ==========================================================================
    story.append(Paragraph("Market Direction", styles["BI_Section"]))
    story.append(Paragraph(
        "Rolling averages of unique SKUs per week. If the 4-week line is above the 13-week line, activity is accelerating.",
        styles["BI_Small"]
    ))

    md_path = asset("market_direction.png")
    chart_market_direction(metrics["weekly_df"], md_path)
    story.append(Image(md_path, width=7.0*inch, height=2.25*inch))
    
    # ========== PAGE 2 ENDS HERE ==========
    story.append(PageBreak())

    # ==========================================================================
    # PAGE 3 — 3 PLAYS + COMPETITIVE ACTIVITY + CTA
    # ==========================================================================
    
    # "HOW TO USE THIS DATA (3 PLAYS)" SECTION
    story.append(Paragraph("How to use this data (3 plays)", styles["BI_Section"]))
    
    # Play 1
    story.append(Paragraph("<b>Play 1 — Competitor Monitoring</b>", styles["BI_PlayTitle"]))
    story.append(Paragraph(
        "Search your top competitors in the database and track new approvals weekly. "
        "Pro also unlocks label image links so you can see the actual labels.",
        styles["BI_PlayBody"]
    ))
    
    # Play 2
    story.append(Paragraph("<b>Play 2 — New Launch Prospecting</b>", styles["BI_PlayTitle"]))
    story.append(Paragraph(
        "Use the New Brands list as a fresh lead list. Click through to confirm category, origin, and label details.",
        styles["BI_PlayBody"]
    ))
    
    # Play 3
    story.append(Paragraph("<b>Play 3 — Pitch Prep (Distributors &amp; Agencies)</b>", styles["BI_PlayTitle"]))
    story.append(Paragraph(
        "Before a meeting, pull the last 90 days of filings for a brand to see what's coming next. Export to CSV for your deck.",
        styles["BI_PlayBody"]
    ))
    
    story.append(Paragraph(
        f"<b>Pro makes this automatic: watchlists + weekly alerts + CSV exports.</b>",
        styles["BI_Small"]
    ))
    story.append(Spacer(1, 4))
    
    # Competitive Activity
    story.append(Paragraph("Competitive Activity", styles["BI_Section"]))
    story.append(Paragraph(
        "Top brands by unique SKUs this week.",
        styles["BI_Small"]
    ))

    comp_path = asset("competitive_activity.png")
    chart_competitive_activity(df, metrics["week_start"], metrics["week_end"], comp_path)
    story.append(Image(comp_path, width=7.0*inch, height=3.5*inch))
    
    story.append(Spacer(1, 4))
    
    # ==========================================================================
    # UPGRADE BOX (End of Page 3 - final CTA)
    # ==========================================================================
    upgrade_content2 = [
        Paragraph(
            '<b>Upgrade to Pro ($49/mo)</b>',
            styles["BI_CTATitle"]
        ),
        Paragraph(
            "Full list for your category + watchlists + weekly alerts + CSV exports + label image links. Cancel anytime.",
            styles["BI_Small"]
        ),
        Paragraph(
            f"<b>Start here: <a href='https://bevalcintel.com/#pricing' color='{COLORS['primary']}'>bevalcintel.com/#pricing</a></b>",
            styles["BI_Small"]
        ),
    ]
    upgrade_tbl2 = Table([[upgrade_content2]], colWidths=[6.5*inch])
    upgrade_tbl2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 1, HexColor(COLORS["primary"])),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(upgrade_tbl2)

    # Build the PDF
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    logger.info(f"Saved PDF: {out_pdf}")


# =============================================================================
# MAIN
# =============================================================================

def generate_report(dry_run: bool = False):
    df = fetch_historical_data()
    if df.empty:
        raise RuntimeError("No data fetched. Check D1 creds and database contents.")

    metrics = compute_metrics(df)

    eow = metrics["week_end"].strftime("%Y-%m-%d")
    report_dir = os.path.join(OUTPUT_DIR, eow)
    os.makedirs(report_dir, exist_ok=True)

    out_pdf = os.path.join(report_dir, f"bevalc_weekly_snapshot_{eow}.pdf")

    logger.info(f"Report week: {metrics['week_range_label']} (EOW {eow})")
    logger.info(f"This week approvals: {metrics['total_approvals']:,}")
    logger.info(f"Unique approvals: {metrics['unique_approvals']:,}")
    logger.info(f"New brands: {metrics['new_brands']:,} | New SKUs: {metrics['new_skus']:,}")
    logger.info(f"Refile share: {metrics['refile_share']:.1f}%")
    logger.info(f"4w pace: {metrics['pace_4']:,.0f} | 13w pace: {metrics['pace_13']:,.0f} | Direction: {metrics['direction']}")

    if dry_run:
        logger.info("[DRY RUN] Not building PDF.")
        return

    build_pdf(df, metrics, out_pdf)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Fetch + compute metrics, but do not build PDF")
    args = parser.parse_args()
    generate_report(dry_run=args.dry_run)


if __name__ == "__main__":
    main()