"""
whiskey_pack.py — BevAlc Intelligence Whiskey Pack (Paid Version)

STRUCTURE (4 pages):
- Page 1: Hook (scoreboard + Top 10 New Brands + Top 15 New SKUs + Subtype breakdown)
- Page 2: Market Direction (Whiskey-specific unique SKUs/week chart)
- Page 3: Competitive Activity (Top brands + Most active companies)
- Page 4: Origin & Imports (Domestic/Import mix + Top origins + New imported brands)

Also generates:
- Email HTML file with 5-line summary + links

USAGE:
    python whiskey_pack.py
    python whiskey_pack.py --dry-run
"""

import os
import argparse
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from urllib.parse import urlencode

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
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.utils import ImageReader


# =============================================================================
# CONFIG
# =============================================================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Parent of scripts/
ENV_FILE = os.path.join(BASE_DIR, ".env")
OUTPUT_DIR = os.path.join(BASE_DIR, "reports", "whiskey_pack")
LOG_FILE = os.path.join(BASE_DIR, "logs", "whiskey_pack.log")
LOGO_PATH = os.path.join(BASE_DIR, "Logo.jpg")

DATABASE_BASE_URL = "https://bevalcintel.com/database.html"

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
# TTB CODE -> CATEGORY MAPPING (Whiskey only needed here)
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
}

# US States and Territories (for domestic/import classification)
US_DOMESTIC = {
    'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO', 'CONNECTICUT',
    'DELAWARE', 'FLORIDA', 'GEORGIA', 'HAWAII', 'IDAHO', 'ILLINOIS', 'INDIANA', 'IOWA',
    'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE', 'MARYLAND', 'MASSACHUSETTS', 'MICHIGAN',
    'MINNESOTA', 'MISSISSIPPI', 'MISSOURI', 'MONTANA', 'NEBRASKA', 'NEVADA', 'NEW HAMPSHIRE',
    'NEW JERSEY', 'NEW MEXICO', 'NEW YORK', 'NORTH CAROLINA', 'NORTH DAKOTA', 'OHIO',
    'OKLAHOMA', 'OREGON', 'PENNSYLVANIA', 'RHODE ISLAND', 'SOUTH CAROLINA', 'SOUTH DAKOTA',
    'TENNESSEE', 'TEXAS', 'UTAH', 'VERMONT', 'VIRGINIA', 'WASHINGTON', 'WEST VIRGINIA',
    'WISCONSIN', 'WYOMING', 'DISTRICT OF COLUMBIA', 'PUERTO RICO', 'VIRGIN ISLANDS',
    'GUAM', 'AMERICAN SAMOA', 'NORTHERN MARIANA ISLANDS'
}

# Logging setup
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def norm(s) -> str:
    """Normalize string for key creation."""
    return str(s or "").upper().strip()


def truncate(s: str, max_len: int) -> str:
    """Truncate string with ellipsis if too long."""
    s = str(s or "").strip()
    if len(s) > max_len:
        return s[:max_len-3] + "..."
    return s


def brand_short(brand_name: str) -> str:
    """Truncate brand name for chart labels."""
    return truncate(brand_name, 26)


def company_short(company_name: str) -> str:
    """Truncate company name for display."""
    return truncate(company_name, 32)


def brand_company_display(brand_name: str, company_name: str) -> str:
    """Format brand (company) for tables."""
    return f"{brand_short(brand_name)} ({company_short(company_name)})"


def get_category(class_type_code: str) -> str:
    """Map TTB class/type code to category."""
    if not class_type_code:
        return 'Other'
    code = class_type_code.strip().upper()
    return TTB_CODE_CATEGORIES.get(code, 'Other')


def get_whiskey_subtype(class_type_code: str) -> str:
    """
    Map TTB class/type code to whiskey subtype.
    Priority order (deterministic):
    1. American Single Malt
    2. Scotch
    3. Irish
    4. Canadian
    5. Tennessee
    6. Rye
    7. Bourbon
    8. Other Whiskey
    """
    if not class_type_code:
        return 'Other Whiskey'
    
    code = class_type_code.strip().upper()
    
    # Priority order
    if 'AMERICAN SINGLE MALT' in code or 'SINGLE MALT' in code:
        # But exclude Scotch single malt
        if 'SCOTCH' not in code:
            return 'American Single Malt'
    if 'SCOTCH' in code:
        return 'Scotch'
    if 'IRISH' in code:
        return 'Irish'
    if 'CANADIAN' in code:
        return 'Canadian'
    if 'TENNESSEE' in code:
        return 'Tennessee'
    if 'RYE' in code:
        return 'Rye'
    if 'BOURBON' in code:
        return 'Bourbon'
    
    return 'Other Whiskey'


def is_domestic(origin_code: str) -> bool:
    """Check if origin is domestic (US states/territories)."""
    if not origin_code:
        return False
    return norm(origin_code) in US_DOMESTIC


def make_database_url(category: str = None, brand: str = None, company: str = None) -> str:
    """Generate database URL with filters."""
    params = {}
    if category:
        params['category'] = category
    if brand:
        params['brand'] = brand
    if company:
        params['company'] = company
    
    if params:
        return f"{DATABASE_BASE_URL}?{urlencode(params)}"
    return DATABASE_BASE_URL


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


def fetch_all_data() -> pd.DataFrame:
    """Fetch ALL historical COLA data from D1 database via API."""
    load_env()
    
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    database_id = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
    
    if not all([account_id, database_id, api_token]):
        raise RuntimeError("Missing Cloudflare credentials in environment")
    
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    
    # Fetch ALL approved records
    all_results = []
    offset = 0
    batch_size = 50000
    
    while True:
        query = f"""
            SELECT ttb_id, brand_name, fanciful_name, class_type_code, origin_code, 
                   approval_date, status, company_name, year, month, day
            FROM colas 
            WHERE status = 'APPROVED'
            ORDER BY year DESC, month DESC, day DESC
            LIMIT {batch_size} OFFSET {offset}
        """
        
        resp = requests.post(url, headers=headers, json={"sql": query})
        resp.raise_for_status()
        data = resp.json()
        
        if not data.get("success"):
            raise RuntimeError(f"D1 query failed: {data}")
        
        results = data.get("result", [{}])[0].get("results", [])
        if not results:
            break
            
        all_results.extend(results)
        logger.info(f"Fetched batch: {len(results)} records (total: {len(all_results)})")
        
        if len(results) < batch_size:
            break
        offset += batch_size
    
    if not all_results:
        logger.warning("No data returned from D1")
        return pd.DataFrame()
    
    df = pd.DataFrame(all_results)
    
    # Parse dates
    df["approval_date"] = pd.to_datetime(df["approval_date"], format="%m/%d/%Y", errors="coerce")
    df = df.dropna(subset=["approval_date"])
    
    # Add week column
    df["week"] = df["approval_date"].dt.to_period("W-SUN").dt.start_time
    
    # Add category
    df["category"] = df["class_type_code"].apply(get_category)
    
    logger.info(f"Fetched {len(df):,} total records")
    return df


def filter_whiskey(df: pd.DataFrame) -> pd.DataFrame:
    """Filter to Whiskey category only and add subtype."""
    whiskey_df = df[df["category"] == "Whiskey"].copy()
    whiskey_df["subtype"] = whiskey_df["class_type_code"].apply(get_whiskey_subtype)
    whiskey_df["is_domestic"] = whiskey_df["origin_code"].apply(is_domestic)
    logger.info(f"Filtered to {len(whiskey_df):,} Whiskey records")
    return whiskey_df


# =============================================================================
# METRICS COMPUTATION
# =============================================================================

def last_complete_week(today: datetime) -> Tuple[datetime, datetime]:
    """Get the start and end of the last complete week (Mon-Sun)."""
    days_since_sunday = (today.weekday() + 1) % 7
    week_end = (today - timedelta(days=days_since_sunday)).replace(hour=23, minute=59, second=59, microsecond=0)
    week_start = (week_end - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    return week_start, week_end


def compute_metrics(df: pd.DataFrame) -> Dict:
    """Compute all metrics for the Whiskey pack report."""
    today = datetime.now()
    week_start, week_end = last_complete_week(today)
    
    # Filter to report week
    week_df = df[(df["approval_date"] >= week_start) & (df["approval_date"] <= week_end)].copy()
    
    # Historical data (everything before this week)
    hist_df = df[df["approval_date"] < week_start].copy()
    
    # Create canonical keys
    week_df["brand_key"] = week_df.apply(lambda r: (norm(r["company_name"]), norm(r["brand_name"])), axis=1)
    week_df["sku_key"] = week_df.apply(
        lambda r: (norm(r["company_name"]), norm(r["brand_name"]), 
                   norm(r["fanciful_name"]), norm(r["class_type_code"])), axis=1
    )
    
    hist_df["brand_key"] = hist_df.apply(lambda r: (norm(r["company_name"]), norm(r["brand_name"])), axis=1)
    hist_df["sku_key"] = hist_df.apply(
        lambda r: (norm(r["company_name"]), norm(r["brand_name"]), 
                   norm(r["fanciful_name"]), norm(r["class_type_code"])), axis=1
    )
    
    # Historical sets
    hist_brands = set(hist_df["brand_key"].tolist()) if len(hist_df) > 0 else set()
    hist_skus = set(hist_df["sku_key"].tolist()) if len(hist_df) > 0 else set()
    
    # Basic counts
    total_approvals = len(week_df)
    unique_skus = week_df["sku_key"].nunique()
    
    # New brands and SKUs
    unique_sku_df = week_df.drop_duplicates(subset=["sku_key"]).copy()
    
    new_skus = 0
    new_brands = 0
    seen_brands = set()
    
    new_brand_details = []  # For Top 10 New Brands table
    new_sku_details = []    # For Top 15 New SKUs table
    
    for _, row in unique_sku_df.iterrows():
        sk = row["sku_key"]
        bk = row["brand_key"]
        
        brand_name = str(row.get("brand_name", "")).strip()
        company_name = str(row.get("company_name", "")).strip()
        fanciful = str(row.get("fanciful_name", "")).strip()
        subtype = row.get("subtype", "Other Whiskey")
        origin = str(row.get("origin_code", "")).strip()
        approval_date = row.get("approval_date")
        is_dom = row.get("is_domestic", False)
        
        # Is this SKU new?
        if sk not in hist_skus:
            new_skus += 1
            # Add to SKU details (only with fanciful names for better display)
            if fanciful and fanciful.upper() not in ("NONE", "N/A", ""):
                sku_display = f"{brand_name} — {fanciful}"
            else:
                sku_display = f"{brand_name} (no fanciful name)"
            
            if len(new_sku_details) < 20:
                new_sku_details.append({
                    "display": sku_display,
                    "brand": brand_name,
                    "company": company_name,
                    "subtype": subtype,
                    "origin": origin,
                    "is_domestic": is_dom,
                    "approval_date": approval_date,
                })
        
        # Is this brand new?
        if bk not in hist_brands and bk not in seen_brands:
            new_brands += 1
            seen_brands.add(bk)
            if len(new_brand_details) < 15:
                new_brand_details.append({
                    "brand": brand_name,
                    "company": company_name,
                    "subtype": subtype,
                    "origin": origin,
                    "is_domestic": is_dom,
                })
    
    # Refiles
    refiles = unique_skus - new_skus
    refile_share = (refiles / unique_skus * 100) if unique_skus > 0 else 0
    
    # Validate: New SKUs + Refiles = Unique SKUs
    assert new_skus + refiles == unique_skus, f"Math error: {new_skus} + {refiles} != {unique_skus}"
    
    # Subtype breakdown
    subtype_df = week_df.groupby("subtype")["sku_key"].nunique().reset_index(name="unique_skus")
    subtype_df = subtype_df.sort_values("unique_skus", ascending=False)
    
    # Top brands by unique SKUs (for competitive activity)
    brand_activity = week_df.groupby("brand_key").agg({
        "sku_key": "nunique",
        "brand_name": "first",
        "company_name": "first",
        "subtype": "first",
        "origin_code": "first",
        "is_domestic": "first",
    }).reset_index()
    brand_activity.columns = ["brand_key", "unique_skus", "brand_name", "company_name", "subtype", "origin_code", "is_domestic"]
    brand_activity = brand_activity.sort_values("unique_skus", ascending=False).head(15)
    
    # Create brand_sku_details dict for looking up subtype/origin by (brand, company)
    brand_sku_details = {}
    for _, row in brand_activity.iterrows():
        key = (row["brand_name"], row["company_name"])
        origin = "US" if row["is_domestic"] else row["origin_code"]
        brand_sku_details[key] = {"subtype": row["subtype"], "origin": origin}
    
    # Most active companies
    company_activity = week_df.groupby("company_name")["sku_key"].nunique().reset_index(name="unique_skus")
    company_activity = company_activity.sort_values("unique_skus", ascending=False).head(10)
    
    # Origin breakdown
    domestic_count = week_df[week_df["is_domestic"]]["sku_key"].nunique()
    import_count = week_df[~week_df["is_domestic"]]["sku_key"].nunique()
    
    # Top import origins
    import_df = week_df[~week_df["is_domestic"]]
    import_origins = import_df.groupby("origin_code")["sku_key"].nunique().reset_index(name="unique_skus")
    import_origins = import_origins.sort_values("unique_skus", ascending=False).head(10)
    
    # New imported brands
    new_import_brands = [b for b in new_brand_details if not b["is_domestic"]][:15]
    
    # Weekly unique SKUs series (for chart)
    df["sku_key"] = df.apply(
        lambda r: (norm(r["company_name"]), norm(r["brand_name"]), 
                   norm(r["fanciful_name"]), norm(r["class_type_code"])), axis=1
    )
    weekly_unique = df.groupby("week")["sku_key"].nunique().reset_index(name="count")
    weekly_unique = weekly_unique.sort_values("week")
    
    # Rolling averages
    weekly_unique["ma_4"] = weekly_unique["count"].rolling(window=4, min_periods=4).mean()
    weekly_unique["ma_13"] = weekly_unique["count"].rolling(window=13, min_periods=13).mean()
    weekly_unique["ma_52"] = weekly_unique["count"].rolling(window=52, min_periods=52).mean()
    
    # Delta vs 13-week avg
    current_week_monday = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    recent_weeks = weekly_unique[weekly_unique["week"] < current_week_monday].tail(13)
    avg_13w = recent_weeks["count"].mean() if len(recent_weeks) > 0 else 0
    delta_vs_13w = ((unique_skus / avg_13w) - 1) * 100 if avg_13w > 0 else 0
    
    # Direction interpretation
    if len(weekly_unique) >= 13:
        last_ma4 = weekly_unique["ma_4"].iloc[-1] if not pd.isna(weekly_unique["ma_4"].iloc[-1]) else 0
        last_ma13 = weekly_unique["ma_13"].iloc[-1] if not pd.isna(weekly_unique["ma_13"].iloc[-1]) else 0
        if last_ma4 > last_ma13 * 1.05:
            direction = "accelerating"
        elif last_ma4 < last_ma13 * 0.95:
            direction = "cooling"
        else:
            direction = "stable"
    else:
        direction = "insufficient data"
    
    return {
        "week_start": week_start,
        "week_end": week_end,
        "week_end_label": week_end.strftime("%B %d, %Y"),
        "week_range_label": f"{week_start.strftime('%B %d')} — {week_end.strftime('%B %d, %Y')}",
        "total_approvals": total_approvals,
        "unique_skus": unique_skus,
        "new_brands": new_brands,
        "new_skus": new_skus,
        "refiles": refiles,
        "refile_share": refile_share,
        "delta_vs_13w": delta_vs_13w,
        "direction": direction,
        "new_brand_details": new_brand_details,
        "new_sku_details": new_sku_details,
        "subtype_df": subtype_df,
        "brand_activity": brand_activity,
        "brand_sku_details": brand_sku_details,
        "company_activity": company_activity,
        "domestic_count": domestic_count,
        "import_count": import_count,
        "import_origins": import_origins,
        "new_import_brands": new_import_brands,
        "weekly_unique": weekly_unique,
    }


# =============================================================================
# CHART HELPERS
# =============================================================================

def _save_fig(fig, out_path: str, dpi: int = 200):
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight", facecolor="white", edgecolor="none")
    plt.close(fig)


def add_watermark(ax, text: str = "bevalcintel.com"):
    ax.text(0.99, 0.01, text, transform=ax.transAxes, ha="right", va="bottom",
            fontsize=8, color=COLORS["muted"], alpha=0.7)


def chart_whiskey_activity(weekly_df: pd.DataFrame, out_path: str):
    """Line chart of weekly unique SKUs with rolling averages."""
    df = weekly_df.copy().sort_values("week")
    
    # Last ~130 weeks
    cutoff = df["week"].max() - timedelta(weeks=130)
    df = df[df["week"] >= cutoff]
    
    fig, ax = plt.subplots(figsize=(8, 2.8))
    
    ax.plot(df["week"], df["ma_4"], color=COLORS["secondary"], linewidth=2, label="Rolling 4-week avg")
    ax.plot(df["week"], df["ma_13"], color=COLORS["primary"], linewidth=2, label="Rolling 13-week avg")
    ax.plot(df["week"], df["ma_52"], color=COLORS["gold"], linewidth=1.5, linestyle="--", label="Rolling 52-week avg")
    
    ax.set_ylabel("Unique whiskey SKUs per week", fontsize=9)
    ax.set_xlabel("Week", fontsize=9)
    ax.legend(loc="lower left", fontsize=8, frameon=False)
    ax.grid(True, alpha=0.2)
    ax.set_ylim(bottom=0)
    
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b\n%Y"))
    ax.tick_params(axis="both", labelsize=8)
    
    add_watermark(ax)
    fig.tight_layout()
    _save_fig(fig, out_path)


def chart_competitive_activity(brand_activity: pd.DataFrame, out_path: str):
    """Horizontal bar chart of top brands by unique SKUs. BRAND only in labels."""
    df = brand_activity.head(10).copy()  # Cap at 10
    df = df.sort_values("unique_skus", ascending=True)  # Reverse for horizontal bar
    
    # Chart labels: BRAND only (hard truncated to 24 chars)
    df["label"] = df["brand_name"].apply(lambda x: truncate(str(x), 24))
    
    fig, ax = plt.subplots(figsize=(7, 3.2))
    fig.subplots_adjust(left=0.35)  # Wide left margin for labels
    
    y_pos = range(len(df))
    ax.barh(y_pos, df["unique_skus"], color=COLORS["primary"], alpha=0.85, height=0.7)
    
    ax.set_yticks(y_pos)
    ax.set_yticklabels(df["label"], fontsize=8)
    ax.set_xlabel("Unique SKUs", fontsize=9)
    ax.set_title("Top Brands by Unique SKUs (this week)", fontsize=10, fontweight="bold")
    ax.tick_params(axis="both", labelsize=8)
    ax.grid(True, axis="x", alpha=0.2)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    
    # Count annotations - ensure no collision with bars
    max_val = df["unique_skus"].max()
    for idx, count in enumerate(df["unique_skus"]):
        ax.text(count + max_val * 0.02, idx, f"{count}", va="center", fontsize=8)
    
    ax.set_xlim(0, max_val * 1.15)
    add_watermark(ax)
    fig.tight_layout()
    _save_fig(fig, out_path)


def chart_origin_stacked_bar(domestic: int, imports: int, out_path: str):
    """100% stacked horizontal bar showing domestic vs import mix."""
    total = domestic + imports
    if total == 0:
        total = 1  # Avoid division by zero
    
    dom_pct = domestic / total * 100
    imp_pct = imports / total * 100
    
    fig, ax = plt.subplots(figsize=(6.5, 1.5))
    
    # Single stacked bar
    bar_height = 0.4
    ax.barh([0], [domestic], color=COLORS["primary"], height=bar_height)
    ax.barh([0], [imports], left=[domestic], color=COLORS["gold"], height=bar_height)
    
    # Add labels on the bars if there's room
    if domestic > 0:
        ax.text(domestic/2, 0, f"Domestic: {domestic} ({dom_pct:.1f}%)", 
                ha='center', va='center', fontsize=9, color='white', fontweight='bold')
    if imports > 0 and imports > total * 0.15:  # Only if import segment is big enough
        ax.text(domestic + imports/2, 0, f"Import: {imports} ({imp_pct:.1f}%)", 
                ha='center', va='center', fontsize=9, color='white', fontweight='bold')
    elif imports > 0:
        # Small segment - put label outside
        ax.text(total * 1.02, 0, f"Import: {imports} ({imp_pct:.1f}%)", 
                ha='left', va='center', fontsize=8, color=COLORS["gold"])
    
    # Clean up axes
    ax.set_xlim(0, total * 1.15)
    ax.set_ylim(-0.5, 0.5)
    ax.set_yticks([])
    ax.set_xticks([])
    ax.set_title("Domestic vs Import (Unique SKUs this week)", fontsize=10, fontweight="bold", pad=10)
    
    for spine in ax.spines.values():
        spine.set_visible(False)
    
    add_watermark(ax)
    fig.tight_layout()
    _save_fig(fig, out_path)


# =============================================================================
# PDF GENERATION
# =============================================================================

def build_pdf(whiskey_df: pd.DataFrame, metrics: Dict, out_pdf: str):
    """Build the 4-page Whiskey Pack PDF."""
    
    # Create assets directory
    asset_dir = os.path.join(os.path.dirname(out_pdf), "_assets")
    os.makedirs(asset_dir, exist_ok=True)
    
    def asset(name):
        return os.path.join(asset_dir, name)
    
    doc = SimpleDocTemplate(
        out_pdf, pagesize=letter,
        leftMargin=0.6*inch, rightMargin=0.6*inch,
        topMargin=0.8*inch, bottomMargin=0.6*inch
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    styles.add(ParagraphStyle(
        "BI_Title", parent=styles["Heading1"], fontSize=16, textColor=HexColor(COLORS["secondary"]),
        spaceAfter=4, alignment=TA_LEFT
    ))
    styles.add(ParagraphStyle(
        "BI_Subtitle", parent=styles["Normal"], fontSize=10, textColor=HexColor(COLORS["muted"]),
        spaceAfter=10
    ))
    styles.add(ParagraphStyle(
        "BI_Section", parent=styles["Heading2"], fontSize=11, textColor=HexColor(COLORS["primary"]),
        spaceBefore=8, spaceAfter=4
    ))
    styles.add(ParagraphStyle(
        "BI_Body", parent=styles["Normal"], fontSize=9, textColor=HexColor(COLORS["text"]),
        spaceAfter=4, leading=12
    ))
    styles.add(ParagraphStyle(
        "BI_Small", parent=styles["Normal"], fontSize=8, textColor=HexColor(COLORS["muted"]),
        leading=10
    ))
    # Scoreboard styles - strict leading, no inline font tags
    styles.add(ParagraphStyle(
        "BI_ScoreValue", fontSize=18, leading=20, alignment=TA_CENTER,
        textColor=HexColor(COLORS["secondary"]), fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "BI_ScoreLabel", fontSize=9, leading=11, alignment=TA_CENTER,
        textColor=HexColor(COLORS["text"])
    ))
    styles.add(ParagraphStyle(
        "BI_ScoreSubtext", fontSize=8, leading=10, alignment=TA_CENTER,
        textColor=HexColor(COLORS["muted"])
    ))
    styles.add(ParagraphStyle(
        "BI_Footnote", parent=styles["Normal"], fontSize=7, textColor=HexColor(COLORS["muted"]),
        alignment=TA_CENTER, leading=9
    ))
    # Table cell - controlled wrapping
    styles.add(ParagraphStyle(
        "BI_TableCell", fontSize=8, textColor=HexColor(COLORS["text"]),
        leading=10, wordWrap='CJK'
    ))
    styles.add(ParagraphStyle(
        "BI_TableCellRight", fontSize=8, textColor=HexColor(COLORS["text"]),
        leading=10, alignment=TA_RIGHT
    ))
    styles.add(ParagraphStyle(
        "BI_TableCellMuted", fontSize=7, textColor=HexColor(COLORS["muted"]),
        leading=9
    ))
    styles.add(ParagraphStyle(
        "BI_TableHeader", fontSize=8, textColor=white, 
        alignment=TA_LEFT, leading=10
    ))
    
    story = []
    
    # Helper functions for table cells
    def p(text):
        return Paragraph(str(text), styles["BI_TableCell"])
    
    def pr(text):
        return Paragraph(str(text), styles["BI_TableCellRight"])
    
    def ph(text):
        return Paragraph(str(text), styles["BI_TableHeader"])
    
    def p_muted(text):
        return Paragraph(str(text), styles["BI_TableCellMuted"])
    
    # Two-line brand cell: Brand on line 1, Company (muted) on line 2
    def brand_cell(brand_name, company_name):
        brand_trunc = truncate(str(brand_name), 38)
        company_trunc = truncate(str(company_name), 38)
        return [
            Paragraph(brand_trunc, styles["BI_TableCell"]),
            Paragraph(company_trunc, styles["BI_TableCellMuted"]),
        ]
    
    # Header/Footer
    def draw_header_footer(canvas, doc):
        canvas.saveState()
        # Logo
        if os.path.exists(LOGO_PATH):
            canvas.drawImage(LOGO_PATH, letter[0] - 1.2*inch, letter[1] - 0.65*inch,
                           width=0.9*inch, height=0.45*inch, preserveAspectRatio=True, mask='auto')
        # Footer
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(HexColor(COLORS["muted"]))
        canvas.drawString(0.6*inch, 0.4*inch, f"BevAlc Intelligence — Whiskey Pack")
        canvas.drawRightString(letter[0] - 0.6*inch, 0.4*inch, f"Page {doc.page}")
        canvas.restoreState()
    
    # =========================================================================
    # PAGE 1 — HOOK
    # =========================================================================
    story.append(Paragraph("BevAlc Intelligence — Whiskey Pack (Pro)", styles["BI_Title"]))
    story.append(Paragraph(
        f"Week ending {metrics['week_end_label']} ({metrics['week_range_label']})",
        styles["BI_Subtitle"]
    ))
    
    # Scoreboard - use nested table per cell to guarantee no overlap
    def score_cell_table(value, label, subtext=None):
        """Create a mini-table for one score cell - guarantees vertical stacking."""
        cell_data = [
            [Paragraph(str(value), styles["BI_ScoreValue"])],
            [Paragraph(label, styles["BI_ScoreLabel"])],
        ]
        if subtext:
            cell_data.append([Paragraph(subtext, styles["BI_ScoreSubtext"])])
        
        inner_tbl = Table(cell_data, colWidths=[2.0*inch])
        inner_tbl.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        return inner_tbl
    
    delta_text = f"{metrics['delta_vs_13w']:+.0f}% vs 13w"
    import_share = (metrics['import_count'] / metrics['unique_skus'] * 100) if metrics['unique_skus'] > 0 else 0
    
    row1_data = [[
        score_cell_table(f"{metrics['total_approvals']:,}", "Total Approvals"),
        score_cell_table(f"{metrics['unique_skus']:,}", "Unique SKUs", delta_text),
        score_cell_table(f"{import_share:.1f}%", "Import Share"),
    ]]
    
    row2_data = [[
        score_cell_table(f"{metrics['new_brands']:,}", "New Brands"),
        score_cell_table(f"{metrics['new_skus']:,}", "New SKUs"),
        score_cell_table(f"{metrics['refiles']:,}", "Refiles"),
    ]]
    
    row1_tbl = Table(row1_data, colWidths=[2.2*inch]*3)
    row1_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    
    row2_tbl = Table(row2_data, colWidths=[2.2*inch]*3)
    row2_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    
    story.append(row1_tbl)
    story.append(row2_tbl)
    
    # Reconciliation footnote
    story.append(Paragraph(
        f"<i>Unique SKUs = New SKUs + Refiles ({metrics['new_skus']:,} + {metrics['refiles']:,} = {metrics['unique_skus']:,})</i>",
        styles["BI_Footnote"]
    ))
    story.append(Spacer(1, 6))
    
    # Top 10 New Brands table - two-line format (Brand / Company muted)
    story.append(Paragraph("Top 10 New Brands (Whiskey)", styles["BI_Section"]))
    
    brands_data = [[ph("Brand / Company"), ph("Subtype"), ph("Origin")]]
    for b in metrics["new_brand_details"][:10]:
        origin_label = "US" if b["is_domestic"] else b["origin"]
        brands_data.append([brand_cell(b["brand"], b["company"]), p(b["subtype"]), p(origin_label)])
    
    # Pad if needed
    while len(brands_data) < 11:
        brands_data.append([p("—"), p(""), p("")])
    
    # Column widths, row height=24 to fit 2 lines
    brands_tbl = Table(brands_data, colWidths=[4.0*inch, 1.2*inch, 0.8*inch], rowHeights=[18] + [24]*10)
    brands_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(brands_tbl)
    story.append(Spacer(1, 4))
    
    # Subtype breakdown
    story.append(Paragraph("Unique SKUs by Whiskey Subtype (this week)", styles["BI_Section"]))
    
    subtype_data = [[ph("Subtype"), ph("Unique SKUs")]]
    for _, row in metrics["subtype_df"].iterrows():
        subtype_data.append([p(row["subtype"]), pr(f"{int(row['unique_skus']):,}")])
    
    subtype_tbl = Table(subtype_data, colWidths=[2.5*inch, 1.0*inch])
    subtype_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(subtype_tbl)
    story.append(Spacer(1, 10))
    
    # CTA box
    cta_content = [
        Paragraph(
            f'<b>Database access • Watchlists • Full lists • CSV exports • Label image links</b>',
            styles["BI_Body"]
        ),
        Paragraph(
            f'<a href="{make_database_url(category="Whiskey")}" color="blue">View Whiskey database →</a>',
            styles["BI_Small"]
        ),
    ]
    cta_tbl = Table([[cta_content]], colWidths=[6.5*inch])
    cta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 1, HexColor(COLORS["primary"])),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(cta_tbl)
    
    story.append(PageBreak())
    
    # =========================================================================
    # PAGE 2 — MARKET DIRECTION
    # =========================================================================
    story.append(Paragraph("Whiskey Activity Pulse", styles["BI_Section"]))
    story.append(Paragraph(
        f"Rolling averages of unique whiskey SKUs per week. Current activity is <b>{metrics['direction']}</b>.",
        styles["BI_Body"]
    ))
    
    chart_path = asset("whiskey_activity.png")
    chart_whiskey_activity(metrics["weekly_unique"], chart_path)
    story.append(Image(chart_path, width=7.0*inch, height=2.5*inch))
    story.append(Spacer(1, 12))
    
    # Top 15 New SKUs table (moved to page 2 for space)
    story.append(Paragraph("Top 15 New SKUs (Whiskey)", styles["BI_Section"]))
    
    skus_data = [[ph("SKU"), ph("Subtype"), ph("Origin"), ph("Date")]]
    for s in metrics["new_sku_details"][:15]:
        display = s["display"][:40] + "..." if len(s["display"]) > 40 else s["display"]
        origin_label = "US" if s["is_domestic"] else s["origin"]
        date_str = s["approval_date"].strftime("%m/%d") if s["approval_date"] else ""
        skus_data.append([p(display), p(s["subtype"]), p(origin_label), p(date_str)])
    
    while len(skus_data) < 16:
        skus_data.append([p("—"), p(""), p(""), p("")])
    
    skus_tbl = Table(skus_data, colWidths=[3.0*inch, 1.3*inch, 0.8*inch, 0.6*inch])
    skus_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(skus_tbl)
    
    story.append(PageBreak())
    
    # =========================================================================
    # PAGE 3 — COMPETITIVE ACTIVITY
    # =========================================================================
    story.append(Paragraph("Competitive Activity", styles["BI_Section"]))
    story.append(Paragraph("Top brands by unique SKUs this week.", styles["BI_Body"]))
    
    comp_chart_path = asset("competitive_activity.png")
    chart_competitive_activity(metrics["brand_activity"], comp_chart_path)
    story.append(Image(comp_chart_path, width=7.0*inch, height=3.0*inch))
    story.append(Spacer(1, 4))
    
    # Table under chart with two-line Brand/Company format
    story.append(Paragraph("Brand Details", styles["BI_Small"]))
    brand_detail_data = [[ph("Brand / Company"), ph("SKUs"), ph("Subtype"), ph("Origin")]]
    
    for _, row in metrics["brand_activity"].head(10).iterrows():
        brand_skus = metrics.get("brand_sku_details", {}).get((row["brand_name"], row["company_name"]), {})
        subtype = brand_skus.get("subtype", "")
        origin = brand_skus.get("origin", "")
        brand_detail_data.append([brand_cell(row["brand_name"], row["company_name"]), 
                                  pr(f"{int(row['unique_skus'])}"), p(subtype), p(origin)])
    
    brand_detail_tbl = Table(brand_detail_data, colWidths=[3.8*inch, 0.6*inch, 1.0*inch, 0.6*inch], 
                             rowHeights=[16] + [22]*10)
    brand_detail_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("ALIGN", (2, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(brand_detail_tbl)
    story.append(Spacer(1, 8))
    
    # Most active companies table - cap at 8
    story.append(Paragraph("Most Active Companies (this week)", styles["BI_Section"]))
    
    company_data = [[ph("Company"), ph("Unique SKUs")]]
    for _, row in metrics["company_activity"].head(8).iterrows():
        company_name = truncate(str(row["company_name"]), 55)
        company_data.append([p(company_name), pr(f"{int(row['unique_skus']):,}")])
    
    company_tbl = Table(company_data, colWidths=[5.2*inch, 0.8*inch], rowHeights=[16]*len(company_data))
    company_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(company_tbl)
    
    story.append(PageBreak())
    
    # =========================================================================
    # PAGE 4 — ORIGIN & IMPORTS
    # =========================================================================
    story.append(Paragraph("Import Intelligence", styles["BI_Section"]))
    
    # Stacked bar chart for domestic vs import
    origin_bar_path = asset("origin_stacked_bar.png")
    chart_origin_stacked_bar(metrics["domestic_count"], metrics["import_count"], origin_bar_path)
    story.append(Image(origin_bar_path, width=6.5*inch, height=1.4*inch))
    story.append(Spacer(1, 8))
    
    # Top import origins
    story.append(Paragraph("Top Import Origins (this week)", styles["BI_Section"]))
    
    origins_data = [[ph("Origin"), ph("Unique SKUs")]]
    for _, row in metrics["import_origins"].iterrows():
        origins_data.append([p(row["origin_code"]), pr(f"{int(row['unique_skus']):,}")])
    
    origins_tbl = Table(origins_data, colWidths=[2.5*inch, 1.0*inch], rowHeights=[16]*len(origins_data))
    origins_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(origins_tbl)
    story.append(Spacer(1, 8))
    
    # New imported whiskey brands - use two-line format
    if metrics["new_import_brands"]:
        story.append(Paragraph("New Imported Whiskey Brands (this week)", styles["BI_Section"]))
        
        import_brands_data = [[ph("Brand / Company"), ph("Origin"), ph("Subtype")]]
        for b in metrics["new_import_brands"][:10]:  # Cap at 10
            import_brands_data.append([brand_cell(b["brand"], b["company"]), p(b["origin"]), p(b["subtype"])])
        
        import_brands_tbl = Table(import_brands_data, colWidths=[4.0*inch, 0.9*inch, 1.1*inch], rowHeights=[18] + [24]*len(metrics["new_import_brands"][:10]))
        import_brands_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor(COLORS["secondary"])),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.25, HexColor(COLORS["grid"])),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f9fafb")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        story.append(import_brands_tbl)
    
    # Build PDF
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    logger.info(f"Saved PDF: {out_pdf}")


# =============================================================================
# EMAIL GENERATION
# =============================================================================

def generate_email_html(metrics: Dict, pdf_path: str, week_end_date: str) -> str:
    """Generate HTML email body with 5-line summary."""
    
    pdf_filename = os.path.basename(pdf_path)
    db_url = make_database_url(category="Whiskey")
    
    # Direction emoji
    direction_emoji = "📈" if metrics["direction"] == "accelerating" else "📉" if metrics["direction"] == "cooling" else "➡️"
    
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>BevAlc Intelligence — Whiskey Pack</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #0d9488; font-size: 24px; margin-bottom: 8px; }}
        .subtitle {{ color: #64748b; font-size: 14px; margin-bottom: 20px; }}
        .summary {{ background: #f8fafc; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0; }}
        .summary p {{ margin: 8px 0; }}
        .stat {{ font-weight: bold; color: #0d9488; }}
        .cta {{ margin: 24px 0; }}
        .cta a {{ display: inline-block; background: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-right: 12px; }}
        .cta a.secondary {{ background: #0f172a; }}
        .footer {{ color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px; }}
    </style>
</head>
<body>
    <h1>🥃 Whiskey Pack — Week of {metrics['week_end_label']}</h1>
    <p class="subtitle">{metrics['week_range_label']}</p>
    
    <div class="summary">
        <p><strong>What happened this week:</strong></p>
        <p>{direction_emoji} <span class="stat">{metrics['unique_skus']:,}</span> unique whiskey SKUs approved ({metrics['delta_vs_13w']:+.0f}% vs 13-week avg)</p>
        <p>🆕 <span class="stat">{metrics['new_brands']:,}</span> new brands entered the market</p>
        <p>📦 <span class="stat">{metrics['new_skus']:,}</span> new SKUs, <span class="stat">{metrics['refiles']:,}</span> refiles ({metrics['refile_share']:.1f}% refile rate)</p>
        <p>🌍 <span class="stat">{metrics['domestic_count']:,}</span> domestic vs <span class="stat">{metrics['import_count']:,}</span> import SKUs</p>
        <p>📊 Activity is <strong>{metrics['direction']}</strong></p>
    </div>
    
    <div class="cta">
        <a href="{db_url}">View Whiskey Database</a>
        <a href="#" class="secondary">Download PDF Report</a>
    </div>
    
    <p>The full Whiskey Pack PDF includes:</p>
    <ul>
        <li>Top 10 new brands with subtype and origin</li>
        <li>Top 15 new SKUs with approval dates</li>
        <li>Whiskey subtype breakdown</li>
        <li>Competitive activity charts</li>
        <li>Import origin analysis</li>
    </ul>
    
    <div class="footer">
        <p>BevAlc Intelligence — Whiskey Pack (Pro)</p>
        <p>Questions? Reply to this email.</p>
    </div>
</body>
</html>
"""
    return html


def save_email_html(html: str, out_path: str):
    """Save email HTML to file."""
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    logger.info(f"Saved email HTML: {out_path}")


# =============================================================================
# MAIN
# =============================================================================

def generate_report(dry_run: bool = False):
    """Generate the Whiskey Pack report."""
    
    # Fetch all data
    logger.info("Fetching all COLA data...")
    df = fetch_all_data()
    if df.empty:
        raise RuntimeError("No data fetched. Check D1 creds and database contents.")
    
    # Filter to Whiskey
    whiskey_df = filter_whiskey(df)
    if whiskey_df.empty:
        raise RuntimeError("No Whiskey data found.")
    
    # Compute metrics
    logger.info("Computing metrics...")
    metrics = compute_metrics(whiskey_df)
    
    # Output paths
    eow = metrics["week_end"].strftime("%Y-%m-%d")
    report_dir = os.path.join(OUTPUT_DIR, eow)
    os.makedirs(report_dir, exist_ok=True)
    
    out_pdf = os.path.join(report_dir, f"bevalc_whiskey_pack_{eow}.pdf")
    out_email = os.path.join(report_dir, f"bevalc_whiskey_pack_email_{eow}.html")
    
    # Log summary
    logger.info(f"Report week: {metrics['week_range_label']} (EOW {eow})")
    logger.info(f"Total approvals: {metrics['total_approvals']:,}")
    logger.info(f"Unique SKUs: {metrics['unique_skus']:,}")
    logger.info(f"New brands: {metrics['new_brands']:,} | New SKUs: {metrics['new_skus']:,}")
    logger.info(f"Refiles: {metrics['refiles']:,} | Refile share: {metrics['refile_share']:.1f}%")
    logger.info(f"Delta vs 13w: {metrics['delta_vs_13w']:+.1f}% | Direction: {metrics['direction']}")
    logger.info(f"Domestic: {metrics['domestic_count']:,} | Import: {metrics['import_count']:,}")
    
    # Reconciliation check: Unique SKUs = New SKUs + Refiles
    if metrics['new_skus'] + metrics['refiles'] != metrics['unique_skus']:
        logger.error(f"RECONCILIATION MISMATCH: {metrics['new_skus']} + {metrics['refiles']} != {metrics['unique_skus']}")
        raise RuntimeError("Metric reconciliation failed: New SKUs + Refiles != Unique SKUs")
    else:
        logger.info(f"Reconciliation OK: {metrics['new_skus']} + {metrics['refiles']} = {metrics['unique_skus']}")
    
    if dry_run:
        logger.info("[DRY RUN] Not building PDF or email.")
        return
    
    # Build PDF
    logger.info("Building PDF...")
    build_pdf(whiskey_df, metrics, out_pdf)
    
    # Generate email
    logger.info("Generating email HTML...")
    email_html = generate_email_html(metrics, out_pdf, eow)
    save_email_html(email_html, out_email)
    
    # Print plaintext preview
    print("\n" + "="*60)
    print("EMAIL PREVIEW (plaintext)")
    print("="*60)
    print(f"Subject: 🥃 Whiskey Pack — Week of {metrics['week_end_label']}")
    print(f"\nWhat happened this week:")
    print(f"• {metrics['unique_skus']:,} unique whiskey SKUs approved ({metrics['delta_vs_13w']:+.0f}% vs 13-week avg)")
    print(f"• {metrics['new_brands']:,} new brands entered the market")
    print(f"• {metrics['new_skus']:,} new SKUs, {metrics['refiles']:,} refiles ({metrics['refile_share']:.1f}% refile rate)")
    print(f"• {metrics['domestic_count']:,} domestic vs {metrics['import_count']:,} import SKUs")
    print(f"• Activity is {metrics['direction']}")
    print(f"\nView database: {make_database_url(category='Whiskey')}")
    print("="*60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Generate BevAlc Intelligence Whiskey Pack")
    parser.add_argument("--dry-run", action="store_true", help="Compute metrics only, don't generate files")
    args = parser.parse_args()
    generate_report(dry_run=args.dry_run)


if __name__ == "__main__":
    main()