"""
send_weekly_report.py - Query D1 metrics and send weekly email via Resend

Runs after weekly_update.py (e.g., Saturday 9am UTC via GitHub Actions):
1. Queries D1 for the PRIOR week's filing metrics (1-week lag for data accuracy)
2. Computes week-over-week trends
3. Sends HTML email via Resend (React Email templates)
   - Free users get the basic WeeklyReport
   - Pro users get the ProWeeklyReport with watchlist matches, spikes, etc.

NOTE: We use a 1-week lag because TTB data typically takes 5-7 days to fully
populate in their public database. By reporting on the prior week, we ensure
maximum data accuracy rather than incomplete "current" data.

USAGE:
    python send_weekly_report.py
    python send_weekly_report.py --dry-run
    python send_weekly_report.py --email you@example.com  # Test single email
    python send_weekly_report.py --pro-only  # Only send Pro reports
"""

import os
import sys
import json
import logging
import subprocess
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
EMAILS_DIR = BASE_DIR / "emails"
LOG_FILE = str(BASE_DIR / "logs" / "send_report.log")
ENV_FILE = str(BASE_DIR / ".env")

# Comprehensive TTB code to category lookup - all 420+ codes explicitly mapped
TTB_CODE_TO_CATEGORY = {
    # Whiskey (70 codes)
    "STRAIGHT BOURBON WHISKY": "Whiskey", "BOURBON WHISKY": "Whiskey", "BOURBON WHISKY BIB": "Whiskey",
    "STRAIGHT BOURBON WHISKY BLENDS": "Whiskey", "BLENDED BOURBON WHISKY": "Whiskey",
    "STRAIGHT RYE WHISKY": "Whiskey", "RYE WHISKY": "Whiskey", "RYE WHISKY BIB": "Whiskey",
    "STRAIGHT RYE WHISKY BLENDS": "Whiskey", "BLENDED RYE WHISKY": "Whiskey",
    "AMERICAN SINGLE MALT WHISKEY": "Whiskey", "AMERICAN SINGLE MALT WHISKEY - BIB": "Whiskey",
    "STRAIGHT AMERICAN SINGLE MALT": "Whiskey", "SCOTCH WHISKY": "Whiskey", "SCOTCH WHISKY FB": "Whiskey",
    "SCOTCH WHISKY USB": "Whiskey", "SINGLE MALT SCOTCH WHISKY": "Whiskey", "UNBLENDED SCOTCH WHISKY USB": "Whiskey",
    "DILUTED SCOTCH WHISKY FB": "Whiskey", "DILUTED SCOTCH WHISKY USB": "Whiskey",
    "IRISH WHISKY": "Whiskey", "IRISH WHISKY FB": "Whiskey", "IRISH WHISKY USB": "Whiskey",
    "DILUTED IRISH WHISKY FB": "Whiskey", "DILUTED IRISH WHISKY USB": "Whiskey",
    "CANADIAN WHISKY": "Whiskey", "CANADIAN WHISKY FB": "Whiskey", "CANADIAN WHISKY USB": "Whiskey",
    "DILUTED CANADIAN WHISKY FB": "Whiskey", "DILUTED CANADIAN WHISKY USB": "Whiskey",
    "STRAIGHT CORN WHISKY": "Whiskey", "CORN WHISKY": "Whiskey", "CORN WHISKY BIB": "Whiskey",
    "STRAIGHT CORN WHISKY BLENDS": "Whiskey", "BLENDED CORN WHISKY": "Whiskey",
    "STRAIGHT MALT WHISKY": "Whiskey", "MALT WHISKY": "Whiskey",
    "STRAIGHT WHISKY": "Whiskey", "STRAIGHT WHISKY BLENDS": "Whiskey", "WHISKY BLENDS": "Whiskey",
    "BLENDED WHISKY": "Whiskey", "BLENDED LIGHT WHISKY": "Whiskey", "LIGHT WHISKY": "Whiskey",
    "DILUTED BLENDED WHISKY": "Whiskey", "OTHER WHISKY BLENDS": "Whiskey", "OTHER STRAIGHT BLENDED WHISKY": "Whiskey",
    "WHISKY": "Whiskey", "WHISKY BOTTLED IN BOND (BIB)": "Whiskey", "OTHER WHISKY BIB": "Whiskey",
    "OTHER STRAIGHT WHISKY": "Whiskey", "OTHER WHISKY (FLAVORED)": "Whiskey",
    "WHISKY ORANGE FLAVORED": "Whiskey", "WHISKY GRAPE FLAVORED": "Whiskey", "WHISKY LIME FLAVORED": "Whiskey",
    "WHISKY LEMON FLAVORED": "Whiskey", "WHISKY CHERRY FLAVORED": "Whiskey", "WHISKY CHOCOLATE FLAVORED": "Whiskey",
    "WHISKY MINT FLAVORED": "Whiskey", "WHISKY PEPPERMINT FLAVORED": "Whiskey", "WHISKY OTHER FLAVORED": "Whiskey",
    "WHISKY PROPRIETARY": "Whiskey", "SPIRIT WHISKY": "Whiskey", "DILUTED WHISKY": "Whiskey",
    "OTHER IMPORTED WHISKY": "Whiskey", "OTHER IMPORTED WHISKY FB": "Whiskey", "OTHER IMPORTED WHISKY USB": "Whiskey",
    "DILUTED OTHER IMPORTED WHISKY FB": "Whiskey", "DILUTED OTHER IMPORTED WHISKY USB": "Whiskey",
    "WHISKY SPECIALTIES": "Whiskey", "LIQUEURS (WHISKY)": "Whiskey",
    # Vodka (26 codes)
    "VODKA": "Vodka", "VODKA 80-89 PROOF": "Vodka", "VODKA 90-99 PROOF": "Vodka", "VODKA 100 PROOF UP": "Vodka",
    "VODKA 80-89 PROOF FB": "Vodka", "VODKA 80-89 PROOF USB": "Vodka", "VODKA 90-99 PROOF FB": "Vodka",
    "VODKA 90-99 PROOF USB": "Vodka", "VODKA 100 PROOF UP FB": "Vodka", "VODKA 100 PROOF UP USB": "Vodka",
    "OTHER VODKA": "Vodka", "DILUTED VODKA": "Vodka", "DILUTED VODKA FB": "Vodka", "DILUTED VODKA USB": "Vodka",
    "VODKA - FLAVORED": "Vodka", "VODKA - ORANGE FLAVORED": "Vodka", "VODKA - GRAPE FLAVORED": "Vodka",
    "VODKA - LIME FLAVORED": "Vodka", "VODKA - LEMON FLAVORED": "Vodka", "VODKA - CHERRY FLAVORED": "Vodka",
    "VODKA - CHOCOLATE FLAVORED": "Vodka", "VODKA - MINT FLAVORED": "Vodka", "VODKA - PEPPERMINT FLAVORED": "Vodka",
    "VODKA - OTHER FLAVORED": "Vodka", "VODKA SPECIALTIES": "Vodka", "LIQUEURS (VODKA)": "Vodka",
    # Tequila (12 codes)
    "TEQUILA FB": "Tequila", "TEQUILA USB": "Tequila", "DILUTED TEQUILA FB": "Tequila", "DILUTED TEQUILA USB": "Tequila",
    "MEZCAL": "Tequila", "MEZCAL FB": "Tequila", "MEZCAL US": "Tequila", "DILUTED MEZCAL": "Tequila",
    "FLAVORED MEZCAL": "Tequila", "AGAVE SPIRITS": "Tequila", "FLAVORED AGAVE SPIRIT": "Tequila", "FLAVORED TEQUILA": "Tequila",
    # Gin (30 codes)
    "LONDON DRY GIN": "Gin", "LONDON DRY DISTILLED GIN": "Gin", "LONDON DRY DISTILLED GIN FB": "Gin",
    "LONDON DRY DISTILLED GIN USB": "Gin", "LONDON DRY GIN FB": "Gin", "LONDON DRY GIN USB": "Gin",
    "DISTILLED GIN": "Gin", "OTHER DISTILLED GIN": "Gin", "OTHER DISTILLED GIN FB": "Gin", "OTHER DISTILLED GIN USB": "Gin",
    "GIN - FLAVORED": "Gin", "GIN - MINT FLAVORED": "Gin", "GIN - ORANGE FLAVORED": "Gin", "GIN - LEMON FLAVORED": "Gin",
    "GIN - CHERRY FLAVORED": "Gin", "GIN - APPLE FLAVORED": "Gin", "GIN - BLACKBERRY FLAVORED": "Gin",
    "GIN - PEACH FLAVORED": "Gin", "GIN - GRAPE FLAVORED": "Gin", "OTHER GIN - FLAVORED": "Gin",
    "GIN": "Gin", "OTHER GIN": "Gin", "OTHER GIN FB": "Gin", "OTHER GIN USB": "Gin",
    "DILUTED GIN": "Gin", "DILUTED GIN FB": "Gin", "DILUTED GIN USB": "Gin",
    "GIN SPECIALTIES": "Gin", "LIQUEURS (GIN)": "Gin", "SLOE GIN": "Gin",
    # Rum (60 codes)
    "U.S. RUM (WHITE)": "Rum", "UR.S. RUM (WHITE)": "Rum", "PUERTO RICAN RUM (WHITE)": "Rum",
    "VIRGIN ISLANDS RUM (WHITE)": "Rum", "HAWAIIAN RUM (WHITE)": "Rum", "FLORIDA RUM (WHITE)": "Rum",
    "OTHER RUM (WHITE)": "Rum", "OTHER WHITE RUM": "Rum", "CUBAN RUM WHITE FB": "Rum",
    "JAMAICAN RUM WHITE FB": "Rum", "JAMAICAN RUM WHITE USB": "Rum", "GUIANAN RUM WHITE FB": "Rum",
    "GUIANAN RUM WHITE USB": "Rum", "MARTINICAN RUM WHITE FB": "Rum", "MARTINICAN RUM WHITE USB": "Rum",
    "OTHER RUM WHITE FB": "Rum", "OTHER RUM WHITE USB": "Rum", "DILUTED RUM (WHITE)": "Rum",
    "DILUTED RUM WHITE FB": "Rum", "DILUTED RUM WHITE USB": "Rum", "U.S. RUM (GOLD)": "Rum",
    "PUERTO RICAN RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM": "Rum",
    "HAWAIIAN RUM (GOLD)": "Rum", "FLORIDA RUM (GOLD)": "Rum", "OTHER RUM (GOLD)": "Rum",
    "CUBAN RUM GOLD FB": "Rum", "JAMAICAN RUM GOLD FB": "Rum", "JAMICAN RUM GOLD USB": "Rum",
    "DUTCH GUIANAN RUM GOLD FB": "Rum", "DUTCH GUIANAN RUM GOLD USB": "Rum", "MARTINICAN RUM GOLD FB": "Rum",
    "MARTINICAN RUM GOLD USB": "Rum", "OTHER RUM GOLD FB": "Rum", "OTHER RUM GOLD USB": "Rum",
    "DILUTED RUM (GOLD)": "Rum", "DILUTED RUM GOLD FB": "Rum", "DILUTED RUM GOLD USB": "Rum",
    "RUM FLAVORED (BOLD)": "Rum", "FLAVORED RUM (BOLD)": "Rum", "RUM ORANGE GLAVORED": "Rum",
    "RUM ORANGE FLAVORED": "Rum", "RUM GRAPE FLAVORED": "Rum", "RUM LIME FLAVORED": "Rum",
    "RUM LEMON FLAVORED": "Rum", "RUM CHERRY FLAVORED": "Rum", "RUM CHOCOLATE FLAVORED": "Rum",
    "RUM MINT FLAVORED": "Rum", "RUM PEPPERMINT FLAVORED": "Rum", "RUM OTHER FLAVORED": "Rum",
    "DOMESTIC FLAVORED RUM": "Rum", "IMPORTED FLAVORED RUM": "Rum", "FOREIGN RUM": "Rum",
    "OTHER FOREIGN RUM": "Rum", "OTHER FORIEGN RUM": "Rum", "FRENCH GUIANAN RUM FB": "Rum",
    "RUM SPECIALTIES": "Rum", "LIQUEURS (RUM)": "Rum", "CACHACA": "Rum",
    # Brandy (70 codes)
    "COGNAC (BRANDY) FB": "Brandy", "COGNAC (BRANDY) USB": "Brandy", "ARMAGNAC (BRANDY) FB": "Brandy",
    "ARMAGNAC (BRANDY) USB": "Brandy", "BRANDY": "Brandy", "CALIFORNIA BRANDY": "Brandy",
    "CALIFORNIA GRAPE BRANDY": "Brandy", "CALIFORNIA DRIED BRANDY": "Brandy", "CALIFORNIA LEES BRANDY": "Brandy",
    "CALIFORNIA POMACE OR MARC BRANDY": "Brandy", "CALIFORNIA RESIDUE BRANDY": "Brandy",
    "CALIFORNIA NEUTRAL BRANDY": "Brandy", "OTHER CALIFORNIA BRANDY": "Brandy", "NEW YORK BRANDY": "Brandy",
    "NEW YORK GRAPE BRANDY": "Brandy", "NEW YORK DRIED BRANDY": "Brandy", "NEW YORK LEES BRANDY": "Brandy",
    "NEW YORK POMACE OR MARC BRANDY": "Brandy", "NEW YORK RESIDUE BRANDY": "Brandy",
    "NEW YORK NEUTRAL BRANDY": "Brandy", "OTHER NEW YORK BRANDY": "Brandy", "OTHER DOMESTIC GRAPE BRANDY": "Brandy",
    "DRIED BRANDY": "Brandy", "LEES BRANDY": "Brandy", "POMACE OR MARC BRANDY": "Brandy",
    "RESIDUE BRANDY": "Brandy", "NEUTRAL BRANDY": "Brandy", "IMMATURE BRANDY": "Brandy", "OTHER BRANDY": "Brandy",
    "FRUIT BRANDY": "Brandy", "APPLE BRANDY": "Brandy", "APPLE BRANDY (CALVADOS)": "Brandy",
    "CHERRY BRANDY": "Brandy", "PLUM BRANDY": "Brandy", "PLUM BRANDY (SLIVOVITZ)": "Brandy",
    "BLACKBERRY BRANDY": "Brandy", "BLENDED APPLE JACK BRANDY": "Brandy", "PEAR BRANDY": "Brandy",
    "APRICOT BRANDY": "Brandy", "OTHER FRUIT BRANDY": "Brandy", "FOREIGN FRUIT BRANDY": "Brandy",
    "OTHER GRAPE BRANDY (PISCO, GRAPPA) FB": "Brandy", "OTHER GRAPE BRANDY (GRAPPA) USB": "Brandy",
    "BRANDY - FLAVORED": "Brandy", "BRANDY - APRICOT FLAVORED": "Brandy", "BRANDY - BLACKBERRY FLAVORED": "Brandy",
    "BRANDY - PEACH FLAVORED": "Brandy", "BRANDY - CHERRY FLAVORED": "Brandy", "BRANDY - GINGER FLAVORED": "Brandy",
    "BRANDY - COFFEE FLAVORED": "Brandy", "BRANDY APPLE FLAVORED": "Brandy", "BRANDY APRICOT FLAVORED": "Brandy",
    "BRANDY BLACKBERRY FLAVORED": "Brandy", "BRANDY CHERRY FLAVORED": "Brandy", "BRANDY COFFEE FLAVORED": "Brandy",
    "BRANDY GINGER FLAVORED": "Brandy", "BRANDY PEACH FLAVORED": "Brandy", "OTHER BRANDY - FLAVORED": "Brandy",
    "OTHER FLAVORED BRANDY": "Brandy", "BLACKBERRY FLAVORED BRANDY": "Brandy", "CHERRY FLAVORED BRANDY": "Brandy",
    "APRICOT FLAVORED BRANDY": "Brandy", "PEACH FLAVORED BRANDY": "Brandy", "GINGER FLAVORED BRANDY": "Brandy",
    "FRENCH BRANDY": "Brandy", "OTHER FRENCH BRANDY FB": "Brandy", "OTHER FRENCH BRANDY USB": "Brandy",
    "ITALIAN GRAPE BRANDY FB": "Brandy", "ITALIAN GRAPE BRANDY USB": "Brandy", "SPANISH GRAPE BRANDY FB": "Brandy",
    "SPANISH GRAPE BRANDY USB": "Brandy", "PORTUGUESE GRAPE BRANDY FB": "Brandy", "PORTUGUESE GRAPE BRANDY USB": "Brandy",
    "GREEK GRAPE BRANDY FB": "Brandy", "GREEK GRAPE BRANDY USB": "Brandy", "GERMAN GRAPE BRANDY FB": "Brandy",
    "GERMAN GRAPE BRANDY USB": "Brandy", "AUSTRALIAN GRAPE BRANDY FB": "Brandy", "AUSTRALIAN GRAPE BRANDY USB": "Brandy",
    "SOUTH AFRICAN GRAPE BRANDY FB": "Brandy", "SOUTH AFRICAN GRAPE BRANDY USB": "Brandy",
    "OTHER FOREIGN BRANDY": "Brandy", "OTHER FOREIGN BRANDY (CONT.)": "Brandy",
    "DILUTED BRANDY FB": "Brandy", "DILUTED BRANDY USB": "Brandy", "LIQUEUR & BRANDY": "Brandy",
    # Wine (28 codes)
    "TABLE RED WINE": "Wine", "TABLE WHITE WINE": "Wine", "ROSE WINE": "Wine",
    "SPARKLING WINE/CHAMPAGNE": "Wine", "SPARKLING WINE/ CIDER": "Wine", "SPARKLING WINE/MEAD": "Wine",
    "CARBONATED WINE": "Wine", "CARBONATED WINE/CIDER": "Wine", "CARBONATED WINE/MEAD": "Wine",
    "DESSERT /PORT/SHERRY/(COOKING) WINE": "Wine", "DESSERT FLAVORED WINE": "Wine", "DESSERT FRUIT WINE": "Wine",
    "HONEY BASED DESSERT WINE": "Wine", "APPLE BASED DESSERT FLAVORED WINE": "Wine", "APPLE DESSERT WINE/CIDER": "Wine",
    "TABLE FLAVORED WINE": "Wine", "APPLE BASED FLAVORED WINE": "Wine", "HONEY BASED TABLE WINE": "Wine",
    "TABLE FRUIT WINE": "Wine", "APPLE TABLE WINE/CIDER": "Wine", "VERMOUTH/MIXED TYPES": "Wine",
    "SAKE": "Wine", "SAKE - IMPORTED": "Wine", "SAKE - DOMESTIC FLAVORED": "Wine", "SAKE - IMPORTED FLAVORED": "Wine",
    # Beer (14 codes)
    "BEER": "Beer", "IRC BEER": "Beer", "IRC BEER-IMPORTED": "Beer",
    "OTHER MALT BEVERAGES (BEER)": "Beer", "OTHER MALT BEVERAGES": "Beer", "ALE": "Beer", "STOUT": "Beer",
    "PORTER": "Beer", "MALT LIQUOR": "Beer", "MALT BEVERAGES": "Beer",
    "MALT BEVERAGES SPECIALITIES - FLAVORED": "Beer", "MALT BEVERAGES SPECIALITIES": "Beer",
    "CEREAL BEVERAGES - NEAR BEER (NON ALCOHOLIC)": "Beer",
    # Liqueur (35 codes)
    "CORDIALS (FRUIT & PEELS)": "Liqueur", "FRUIT FLAVORED LIQUEURS": "Liqueur", "CURACAO": "Liqueur",
    "TRIPLE SEC": "Liqueur", "OTHER FRUITS & PEELS LIQUEURS": "Liqueur", "OTHER FRUIT & PEELS LIQUEURS": "Liqueur",
    "FRUITS & PEELS SCHNAPPS LIQUEUR": "Liqueur", "CORDIALS (CREMES OR CREAMS)": "Liqueur",
    "CREME DE CACAO WHITE": "Liqueur", "CREME DE CACAO BROWN": "Liqueur", "CREME DE MENTHE WHITE": "Liqueur",
    "CREME DE MENTHE GREEN": "Liqueur", "CREME DE ALMOND (NOYAUX)": "Liqueur", "DAIRY CREAM LIQUEUR/CORDIAL": "Liqueur",
    "NON DAIRY CREME LIQUEUR/CORDIAL": "Liqueur", "OTHER LIQUEUR (CREME OR CREAMS)": "Liqueur",
    "OTHER LIQUEUR (CREMES OR CREAMS)": "Liqueur", "CORDIALS (HERBS & SEEDS)": "Liqueur",
    "ANISETTE, OUZO, OJEN": "Liqueur", "KUMMEL": "Liqueur", "ARACK/RAKI": "Liqueur", "SAMBUCA": "Liqueur",
    "OTHER (HERBS & SEEDS)": "Liqueur", "OTHER HERB & SEED CORDIALS/LIQUEURS": "Liqueur",
    "HERBS AND SEEDS SCHNAPPS LIQUEUR": "Liqueur", "HERBS & SEEDS SCHNAPPS LIQUEUR": "Liqueur",
    "COFFEE (CAFE) LIQUEUR": "Liqueur", "AMARETTO": "Liqueur", "PEPPERMINT SCHNAPPS": "Liqueur",
    "ROCK & RYE, RUM & BRANDY (ETC.)": "Liqueur", "SPECIALTIES & PROPRIETARIES": "Liqueur",
    "SPECIALITIES & PROPRIETARIES": "Liqueur", "OTHER SPECIALTIES & PROPRIETARIES": "Liqueur",
    "BITTERS - BEVERAGE": "Liqueur", "BITTERS - BEVERAGE*": "Liqueur",
    # RTD/Cocktails (45 codes)
    "WHISKY MANHATTAN (48 PROOF UP)": "RTD", "WHISKY MANHATTAN (UNDER 48 PROOF)": "RTD",
    "WHISKY MANHATTAN UNDER 48 PROOF": "RTD", "WHISKY OLD FASHIONED (48 PROOF UP)": "RTD",
    "WHISKY OLD FASHIONED (UNDER 48 PROOF)": "RTD", "WHISKY OLD FASHIONED UNDER 48 PROOF": "RTD",
    "WHISKY SOUR (48 PROOF UP )": "RTD", "WHISKY SOUR (UNDER 48 PROOF)": "RTD", "WHISKY SOUR UNDER 48 PROOF": "RTD",
    "VODKA MARTINI (48 PROOF UP)": "RTD", "VODKA MARTINI (UNDER 48 PROOF)": "RTD",
    "VODKA MARTINI  UNDER 48 PROOF": "RTD", "VODKA MARTINI 48 PROOF UP": "RTD",
    "SCREW DRIVER": "RTD", "BLOODY MARY": "RTD",
    "GIN MARTINI (48 PROOF UP)": "RTD", "GIN MARTINI (UNDER 48 PROOF)": "RTD",
    "GIN MARTINI 48 PROOF UP": "RTD", "GIN MARTINI UNDER 48 PROOF": "RTD",
    "GIN SOUR (UNDER 48 PROOF)": "RTD", "GIN SOUR UNDER 48 PROOF": "RTD", "COLLINS": "RTD",
    "DAIQUIRI (48 PROOF UP)": "RTD", "DAIQUIRI (UNDER 48 PROOF)": "RTD",
    "DAIQUIRI 48 PROOF UP": "RTD", "DAIQUIRI UNDER 48 PROOF": "RTD",
    "COLADA (48PROOF UP)": "RTD", "COLADA (48 PROOF UP )": "RTD",
    "COLADA (UNDER 48 PROOF)": "RTD", "COLADA (UNDER 48 PROOF )": "RTD",
    "MARGARITA (48 PROOF UP)": "RTD", "MARGARITA (UNDER 48 PROOF)": "RTD",
    "MARGARITA 48 PROOF UP": "RTD", "MARGARITA UNDER 48 PROOF": "RTD",
    "OTHER TEQUILA-BASED COCKTAILS (UNDER 48 PROOF)": "RTD",
    "BRANDY STINGER (48 PROOF UP)": "RTD", "BRANDY STINGER (UNDER 48 PROOF)": "RTD",
    "BRANDY STINGER UNDER 48 PROOF": "RTD", "BRANDY SIDE CAR (48 PROOF UP)": "RTD",
    "BRANDY SIDE CAR (UNDER 48 PROOF)": "RTD", "BRANDY SIDE CAR UNDER 48 PROOF": "RTD",
    "COCKTAILS 48 PROOF UP": "RTD", "COCKTAILS 48 PROOF UP (CONT)": "RTD",
    "COCKTAILS UNDER 48 PROOF": "RTD", "COCKTAILS UNDER 48 PROOF (CONT)": "RTD",
    "COCKTAILS UNDER 48 PR(CONT)": "RTD", "MIXED DRINKS-HI BALLS COCKTAILS": "RTD",
    "OTHER COCKTAILS (48 PROOF UP)": "RTD", "OTHER COCTAILS (48PROOF UP)": "RTD",
    "OTHER COCKTAILS (UNDER 48 PROOF)": "RTD", "OTHER MIXED DRINKS HI-BALLS COCKTAILS": "RTD", "EGG NOG": "RTD",
    # Other (10 codes)
    "NEUTRAL SPIRITS - GRAIN": "Other", "NEUTRAL SPIRITS - FRUIT": "Other", "NEUTRAL SPIRITS - CANE": "Other",
    "NEUTRAL SPIRITS - VEGETABLE": "Other", "NEUTRAL SPIRITS - PETROLEUM": "Other",
    "GRAIN SPIRITS": "Other", "OTHER SPIRITS": "Other",
    "NON ALCOHOLIC MIXES": "Other", "NON ALCOHOL MIXES": "Other", "ADMINISTRATIVE WITHDRAWAL": "Other",
}

# Fallback patterns for unknown codes (used only when exact match fails)
FALLBACK_PATTERNS = [
    # Beer first to catch MALT BEVERAGE before MALT WHISKY
    ('MALT BEVER', 'Beer'), ('MALT LIQ', 'Beer'), ('BEER', 'Beer'), ('ALE', 'Beer'),
    ('STOUT', 'Beer'), ('LAGER', 'Beer'), ('PORTER', 'Beer'),
    # Whiskey - WHISK catches both WHISKY and WHISKEY
    ('WHISK', 'Whiskey'), ('BOURBON', 'Whiskey'), ('SCOTCH', 'Whiskey'), ('TENNESSEE', 'Whiskey'),
    ('VODKA', 'Vodka'),
    ('TEQUILA', 'Tequila'), ('MEZCAL', 'Tequila'), ('AGAVE', 'Tequila'),
    ('GIN', 'Gin'),
    ('RUM', 'Rum'), ('CACHACA', 'Rum'),
    ('BRANDY', 'Brandy'), ('COGNAC', 'Brandy'), ('ARMAGNAC', 'Brandy'), ('GRAPPA', 'Brandy'), ('PISCO', 'Brandy'),
    ('WINE', 'Wine'), ('CHAMPAGNE', 'Wine'), ('SHERRY', 'Wine'), ('VERMOUTH', 'Wine'), ('SAKE', 'Wine'),
    ('LIQUEUR', 'Liqueur'), ('CORDIAL', 'Liqueur'), ('SCHNAPPS', 'Liqueur'), ('AMARETTO', 'Liqueur'),
    ('COCKTAIL', 'RTD'), ('MARGARITA', 'RTD'), ('DAIQUIRI', 'RTD'), ('MARTINI', 'RTD'), ('COLADA', 'RTD'),
]


def get_category(class_type_code: str) -> str:
    """Map TTB class/type code to category using exact lookup first, then fallback patterns."""
    if not class_type_code:
        return 'Other'
    code = class_type_code.strip().upper()

    # Try exact lookup first
    if code in TTB_CODE_TO_CATEGORY:
        return TTB_CODE_TO_CATEGORY[code]

    # Fallback: pattern matching for unknown codes
    for pattern, category in FALLBACK_PATTERNS:
        if pattern in code:
            return category

    return 'Other'


def get_codes_for_category(category: str) -> List[str]:
    """Get all TTB codes that belong to a category."""
    codes = []
    for code, cat in TTB_CODE_TO_CATEGORY.items():
        if cat == category:
            codes.append(code)
    return codes

def make_slug(name: str) -> str:
    """Convert name to URL slug."""
    if not name:
        return ""
    import re
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug

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
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")

load_env()

# Cloudflare config
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_D1_DATABASE_ID = os.environ.get("CLOUDFLARE_D1_DATABASE_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")

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
# D1 QUERIES
# ============================================================================

def d1_query(sql: str) -> List[Dict]:
    """Execute a SQL query against D1 and return results."""
    if not D1_API_URL:
        logger.error("D1 API URL not configured")
        return []

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    response = requests.post(D1_API_URL, headers=headers, json={"sql": sql})

    if response.status_code != 200:
        logger.error(f"D1 API error: {response.status_code} - {response.text}")
        return []

    data = response.json()
    if data.get("success") and data.get("result"):
        return data["result"][0].get("results", [])
    return []


def get_week_dates() -> Tuple[datetime, datetime, datetime, datetime]:
    """Get date ranges for the PRIOR week and week before that (Monday-Sunday).

    We use a 1-week lag because TTB data typically takes 5-7 days to fully
    populate. By reporting on the prior week (not the most recent week),
    we ensure maximum data accuracy.

    Example: If today is Saturday Jan 11, 2026
    - Most recent complete week: Jan 5 (Mon) - Jan 11 (Sun)
    - We SKIP that and report on: Dec 29 (Mon) - Jan 4 (Sun)
    - For comparison, we use: Dec 22 (Mon) - Dec 28 (Sun)
    """
    today = datetime.now()

    # Find last Sunday (end of most recent complete week)
    days_since_sunday = (today.weekday() + 1) % 7
    if days_since_sunday == 0:
        days_since_sunday = 7  # If today is Sunday, go back a week

    most_recent_sunday = today - timedelta(days=days_since_sunday)

    # Apply 1-week lag: go back one more week for data accuracy
    this_week_end = most_recent_sunday - timedelta(days=7)
    this_week_start = this_week_end - timedelta(days=6)

    # "Last week" is now 2 weeks ago (for comparison)
    last_week_end = this_week_start - timedelta(days=1)
    last_week_start = last_week_end - timedelta(days=6)

    return (this_week_start, this_week_end, last_week_start, last_week_end)


def date_range_sql(start: datetime, end: datetime) -> str:
    """Generate SQL WHERE clause for date range using year/month/day columns."""
    conditions = []

    if start.year == end.year:
        if start.month == end.month:
            # Same year, same month
            conditions.append(f"(year = {start.year} AND month = {start.month} AND day >= {start.day} AND day <= {end.day})")
        else:
            # Same year, different months
            conditions.append(f"(year = {start.year} AND ((month = {start.month} AND day >= {start.day}) OR (month > {start.month} AND month < {end.month}) OR (month = {end.month} AND day <= {end.day})))")
    else:
        # Different years (e.g., Dec 29 2025 to Jan 4 2026)
        conditions.append(f"(year = {start.year} AND month = {start.month} AND day >= {start.day})")
        conditions.append(f"(year = {end.year} AND month = {end.month} AND day <= {end.day})")

    return "(" + " OR ".join(conditions) + ")"


def get_four_week_range() -> str:
    """Get date range SQL for the past 4 weeks (for calculating averages)."""
    today = datetime.now()
    four_weeks_ago = today - timedelta(days=28)
    return date_range_sql(four_weeks_ago, today)


# ============================================================================
# FREE USER METRICS
# ============================================================================

def fetch_email_metrics() -> Dict:
    """Fetch all metrics needed for the FREE weekly email from D1."""
    this_week_start, this_week_end, last_week_start, last_week_end = get_week_dates()

    this_week_sql = date_range_sql(this_week_start, this_week_end)
    last_week_sql = date_range_sql(last_week_start, last_week_end)

    logger.info(f"Fetching metrics for week: {this_week_start.strftime('%m/%d/%Y')} - {this_week_end.strftime('%m/%d/%Y')}")

    # 1. Total filings this week
    total_this_week = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
    """)
    total_filings = total_this_week[0]["count"] if total_this_week else 0

    # 2. Total filings last week (for trend)
    total_last_week = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
    """)
    last_week_count = total_last_week[0]["count"] if total_last_week else 0

    # 3. New brands this week
    new_brands_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
    """)
    new_brands = new_brands_result[0]["count"] if new_brands_result else 0

    # 4. New SKUs this week
    new_skus_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_SKU'
    """)
    new_skus = new_skus_result[0]["count"] if new_skus_result else 0

    # 5. New companies this week
    new_companies_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_COMPANY'
    """)
    new_companies = new_companies_result[0]["count"] if new_companies_result else 0

    # 6. Top filing companies this week
    top_companies = d1_query(f"""
        SELECT company_name, class_type_code, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        GROUP BY company_name
        ORDER BY filings DESC
        LIMIT 5
    """)

    # Format top companies with category
    top_companies_list = []
    for row in top_companies:
        top_companies_list.append({
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "filings": row["filings"]
        })

    # Get top filer
    top_filer = top_companies_list[0]["company"] if top_companies_list else "N/A"
    top_filer_count = top_companies_list[0]["filings"] if top_companies_list else 0

    # 7. Top brand extensions (brands with most NEW_SKU filings)
    top_extensions = d1_query(f"""
        SELECT brand_name, company_name, class_type_code, COUNT(*) as new_skus
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_SKU'
        GROUP BY brand_name, company_name
        ORDER BY new_skus DESC
        LIMIT 5
    """)

    top_extensions_list = []
    for row in top_extensions:
        top_extensions_list.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "newSkus": row["new_skus"]
        })

    # 8. Category breakdown
    category_data = d1_query(f"""
        SELECT class_type_code, COUNT(*) as count
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        GROUP BY class_type_code
    """)

    # Aggregate by category
    category_totals = {}
    for row in category_data:
        cat = get_category(row.get("class_type_code", ""))
        category_totals[cat] = category_totals.get(cat, 0) + row["count"]

    # Sort by count and take top 6
    sorted_categories = sorted(category_totals.items(), key=lambda x: x[1], reverse=True)[:6]
    category_list = [{"label": cat, "value": count} for cat, count in sorted_categories]

    # 9. Category trends for summary (compare to last week)
    last_week_categories = d1_query(f"""
        SELECT class_type_code, COUNT(*) as count
        FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
        GROUP BY class_type_code
    """)

    last_week_totals = {}
    for row in last_week_categories:
        cat = get_category(row.get("class_type_code", ""))
        last_week_totals[cat] = last_week_totals.get(cat, 0) + row["count"]

    # Find biggest mover
    biggest_change = None
    biggest_pct = 0
    for cat, this_count in category_totals.items():
        last_count = last_week_totals.get(cat, 0)
        if last_count > 10:  # Only consider categories with meaningful volume
            pct_change = ((this_count - last_count) / last_count) * 100
            if abs(pct_change) > abs(biggest_pct):
                biggest_pct = pct_change
                biggest_change = cat

    # Calculate week-over-week change for total filings
    total_last = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql} AND status = 'APPROVED'
    """)
    last_week_count = total_last[0]["count"] if total_last else 0
    wow_change = int(((total_filings - last_week_count) / last_week_count) * 100) if last_week_count > 0 else 0

    # Build summary bullets array
    summary_bullets = [
        f"{total_filings:,} total filings ({'+' if wow_change >= 0 else ''}{wow_change}% vs last week)",
        f"{new_brands} new brands, {new_skus} new SKUs",
    ]

    # Add biggest category mover if significant
    if biggest_change and abs(biggest_pct) > 10:
        direction = "up" if biggest_pct > 0 else "down"
        summary_bullets.append(f"{biggest_change} {direction} {abs(int(biggest_pct))}% week-over-week")

    # Add top filer
    if top_companies_list:
        summary_bullets.append(f"Top filer: {top_filer} ({top_filer_count} filings)")

    # 10. Pro preview - get one NEW_BRAND filing
    pro_preview = d1_query(f"""
        SELECT ttb_id, brand_name, company_name, signal
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
        LIMIT 1
    """)

    if pro_preview:
        row = pro_preview[0]
        pro_preview_label = {
            "brand": row["brand_name"],
            "company": row["company_name"],
            "signal": row["signal"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        }
    else:
        pro_preview_label = {
            "brand": "Sample Brand",
            "company": "Sample Company",
            "signal": "NEW_BRAND",
            "ttbId": "00000000000000",
            "ttbLink": "https://www.ttbonline.gov"
        }

    # Format week ending date
    week_ending = this_week_end.strftime("%B %d, %Y")

    return {
        "weekEnding": week_ending,
        "summaryBullets": summary_bullets,
        "totalFilings": str(total_filings),
        "newBrands": str(new_brands),
        "newSkus": str(new_skus),
        "newCompanies": str(new_companies),
        "topFiler": top_filer,
        "topFilerCount": str(top_filer_count),
        "categoryData": category_list,
        "topCompaniesList": top_companies_list,
        "topExtensionsList": top_extensions_list,
        "proPreviewLabel": pro_preview_label,
        "databaseUrl": "https://bevalcintel.com/database",
    }


# ============================================================================
# PRO USER METRICS
# ============================================================================

def get_category_sql_filter(category: str) -> str:
    """Generate SQL filter to match a category using exact TTB codes."""
    codes = get_codes_for_category(category)
    if not codes:
        # Fallback to pattern matching if no exact codes found
        return f"(class_type_code LIKE '%{category}%')"
    # Use IN clause with exact matches for better performance
    escaped_codes = [f"'{code.replace(chr(39), chr(39)+chr(39))}'" for code in codes]
    return f"(class_type_code IN ({', '.join(escaped_codes)}))"


def fetch_category_report(category: str, this_week_sql: str, last_week_sql: str) -> Dict:
    """Fetch category-specific report data (new brands, new SKUs, top companies)."""
    category_filter = get_category_sql_filter(category)

    # Total filings in this category this week
    total_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
    """)
    total_filings = total_result[0]["count"] if total_result else 0

    # Total filings last week for change calculation
    last_week_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
    """)
    last_week_count = last_week_result[0]["count"] if last_week_result else 0

    # Calculate change
    if last_week_count > 0:
        pct_change = int(((total_filings - last_week_count) / last_week_count) * 100)
        change = f"+{pct_change}%" if pct_change >= 0 else f"{pct_change}%"
    else:
        change = ""

    # New Brands in this category
    new_brands_result = d1_query(f"""
        SELECT ttb_id, brand_name, company_name
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND signal = 'NEW_BRAND'
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    new_brands = []
    for row in new_brands_result:
        new_brands.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # New SKUs in this category
    new_skus_result = d1_query(f"""
        SELECT ttb_id, brand_name, fanciful_name, company_name
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND signal = 'NEW_SKU'
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    new_skus = []
    for row in new_skus_result:
        new_skus.append({
            "brand": row["brand_name"],
            "fancifulName": row.get("fanciful_name") or row["brand_name"],
            "company": row["company_name"],
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # Top companies filing in this category
    top_companies_result = d1_query(f"""
        SELECT company_name, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND {category_filter}
        AND status = 'APPROVED'
        GROUP BY company_name
        ORDER BY filings DESC
        LIMIT 3
    """)

    top_companies = []
    for row in top_companies_result:
        top_companies.append({
            "company": row["company_name"],
            "filings": row["filings"]
        })

    return {
        "category": category,
        "totalFilings": total_filings,
        "change": change,
        "newBrands": new_brands,
        "newSkus": new_skus,
        "topCompanies": top_companies,
    }


def fetch_pro_metrics(user_email: str, watchlist: List[Dict], subscribed_categories: List[str] = None, tier: str = None) -> Dict:
    """Fetch metrics for a PRO user including watchlist matches, spikes, and category reports.

    For category_pro users, watchlist matches are filtered to only include filings within their tier_category.
    """
    this_week_start, this_week_end, last_week_start, last_week_end = get_week_dates()
    this_week_sql = date_range_sql(this_week_start, this_week_end)
    last_week_sql = date_range_sql(last_week_start, last_week_end)
    four_week_sql = get_four_week_range()

    # Get base metrics first
    base_metrics = fetch_email_metrics()

    # Build category filter SQL early so it can be used in all queries
    category_filter_sql = ""
    if subscribed_categories:
        category_conditions = [get_category_sql_filter(cat) for cat in subscribed_categories]
        category_filter_sql = f"AND ({' OR '.join(category_conditions)})"
        tier_label = f" ({tier})" if tier else ""
        logger.info(f"Filtering by categories{tier_label}: {', '.join(subscribed_categories)}")

    # Fetch category-specific reports for user's subscribed categories
    category_reports = []
    if subscribed_categories:
        for category in subscribed_categories:
            try:
                report = fetch_category_report(category, this_week_sql, last_week_sql)
                # Only include if there's meaningful data
                if report["totalFilings"] > 0 or report["newBrands"] or report["newSkus"]:
                    category_reports.append(report)
            except Exception as e:
                logger.warning(f"Failed to fetch category report for {category}: {e}")

    # Extract watched brands and companies
    watched_brands = [w["value"] for w in watchlist if w.get("type") == "brand"]
    watched_companies = [w["value"] for w in watchlist if w.get("type") == "company"]

    # For category_pro users, watchlist matches must be filtered by their category
    watchlist_category_filter = ""
    if tier == "category_pro" and subscribed_categories:
        watchlist_category_filter = category_filter_sql

    # 1. Watchlist matches - filings from watched brands/companies
    watchlist_matches = []

    if watched_companies:
        # Escape single quotes in company names for SQL
        company_list = ", ".join([f"'{c.replace(chr(39), chr(39)+chr(39))}'" for c in watched_companies])
        company_matches = d1_query(f"""
            SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
            FROM colas
            WHERE {this_week_sql}
            AND company_name IN ({company_list})
            AND signal IN ('NEW_BRAND', 'NEW_SKU', 'NEW_COMPANY')
            {watchlist_category_filter}
            ORDER BY approval_date DESC
            LIMIT 15
        """)
        for row in company_matches:
            watchlist_matches.append({
                "brand": row["brand_name"],
                "fancifulName": row.get("fanciful_name") or row["brand_name"],
                "company": row["company_name"],
                "signal": row["signal"],
                "category": get_category(row.get("class_type_code", "")),
                "ttbId": row["ttb_id"],
                "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}",
                "matchType": "company"
            })

    if watched_brands:
        # Escape single quotes in brand names for SQL
        brand_list = ", ".join([f"'{b.replace(chr(39), chr(39)+chr(39))}'" for b in watched_brands])
        brand_matches = d1_query(f"""
            SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
            FROM colas
            WHERE {this_week_sql}
            AND brand_name IN ({brand_list})
            AND signal IN ('NEW_BRAND', 'NEW_SKU')
            {watchlist_category_filter}
            ORDER BY approval_date DESC
            LIMIT 10
        """)
        for row in brand_matches:
            # Avoid duplicates if company was already matched
            if not any(m["ttbId"] == row["ttb_id"] for m in watchlist_matches):
                watchlist_matches.append({
                    "brand": row["brand_name"],
                    "fancifulName": row.get("fanciful_name") or row["brand_name"],
                    "company": row["company_name"],
                    "signal": row["signal"],
                    "category": get_category(row.get("class_type_code", "")),
                    "ttbId": row["ttb_id"],
                    "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}",
                    "matchType": "brand"
                })

    # Limit to top 10 watchlist matches
    watchlist_matches = watchlist_matches[:10]

    # 2. Calculate week-over-week change
    total_this = int(base_metrics["totalFilings"])
    total_last_result = d1_query(f"""
        SELECT COUNT(*) as count FROM colas
        WHERE {last_week_sql}
        AND status = 'APPROVED'
    """)
    total_last = total_last_result[0]["count"] if total_last_result else 0
    if total_last > 0:
        pct_change = int(((total_this - total_last) / total_last) * 100)
        week_over_week_change = f"+{pct_change}%" if pct_change >= 0 else f"{pct_change}%"
    else:
        week_over_week_change = "+0%"

    # 3. Top companies with vs avg comparison (filtered by user's categories)
    # First get 4-week averages per company
    avg_per_company = d1_query(f"""
        SELECT company_name, ROUND(COUNT(*) / 4.0) as avg_filings
        FROM colas
        WHERE {four_week_sql}
        AND status = 'APPROVED'
        {category_filter_sql}
        GROUP BY company_name
        HAVING COUNT(*) >= 4
    """)
    avg_lookup = {r["company_name"]: r["avg_filings"] for r in avg_per_company}

    # Top companies this week (filtered by user's categories)
    top_companies_filtered = d1_query(f"""
        SELECT company_name, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        {category_filter_sql}
        GROUP BY company_name
        ORDER BY filings DESC
        LIMIT 5
    """)

    # Build top companies with change vs avg
    top_companies_with_change = []
    for comp in top_companies_filtered:
        avg = avg_lookup.get(comp["company_name"], 0)
        change = comp["filings"] - avg if avg > 0 else comp["filings"]
        top_companies_with_change.append({
            "company": comp["company_name"],
            "filings": comp["filings"],
            "change": f"+{int(change)}" if change >= 0 else str(int(change))
        })

    # 4. Filing spikes (M&A signals) - companies with unusual activity (filtered by categories)
    filing_spikes = []
    this_week_by_company = d1_query(f"""
        SELECT company_name, COUNT(*) as filings
        FROM colas
        WHERE {this_week_sql}
        AND status = 'APPROVED'
        {category_filter_sql}
        GROUP BY company_name
        HAVING COUNT(*) >= 10
        ORDER BY filings DESC
    """)

    for row in this_week_by_company:
        company = row["company_name"]
        this_week_count = row["filings"]
        avg = avg_lookup.get(company, 0)

        if avg > 0 and this_week_count >= avg * 2:  # 2x or more than average
            pct_increase = int(((this_week_count - avg) / avg) * 100)
            if pct_increase >= 100:  # Only show 100%+ spikes
                filing_spikes.append({
                    "company": company,
                    "thisWeek": this_week_count,
                    "avgWeek": int(avg),
                    "percentIncrease": pct_increase
                })

    # Sort by percent increase and take top 3
    filing_spikes = sorted(filing_spikes, key=lambda x: x["percentIncrease"], reverse=True)[:3]

    # 5. Notable new brands (NEW_BRAND filings from this week, filtered by categories)
    notable_brands = d1_query(f"""
        SELECT ttb_id, brand_name, company_name, class_type_code
        FROM colas
        WHERE {this_week_sql}
        AND signal = 'NEW_BRAND'
        {category_filter_sql}
        ORDER BY approval_date DESC
        LIMIT 5
    """)

    notable_new_brands = []
    for row in notable_brands:
        notable_new_brands.append({
            "brand": row["brand_name"],
            "company": row["company_name"],
            "category": get_category(row.get("class_type_code", "")),
            "ttbId": row["ttb_id"],
            "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
        })

    # 6. Full new filings list - fetch more, then limit to 7 per category with mixed signals
    new_filings_raw = d1_query(f"""
        SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
        FROM colas
        WHERE {this_week_sql} AND signal IN ('NEW_BRAND', 'NEW_SKU') {category_filter_sql}
        ORDER BY approval_date DESC
        LIMIT 500
    """)

    # Group by category and limit to 7 per category (mix of brands and SKUs)
    category_filings = {}
    for row in new_filings_raw:
        category = get_category(row.get("class_type_code", ""))
        if category not in category_filings:
            category_filings[category] = {"NEW_BRAND": [], "NEW_SKU": []}
        if len(category_filings[category][row["signal"]]) < 4:
            category_filings[category][row["signal"]].append(row)

    # Build final list: up to 7 per category (alternating brands and SKUs)
    new_filings_list = []
    for category, signals in category_filings.items():
        brands = signals.get("NEW_BRAND", [])
        skus = signals.get("NEW_SKU", [])
        count = 0
        bi, si = 0, 0
        # Alternate between brands and SKUs
        while count < 7 and (bi < len(brands) or si < len(skus)):
            if bi < len(brands) and (count % 2 == 0 or si >= len(skus)):
                row = brands[bi]
                bi += 1
                new_filings_list.append({
                    "brand": row["brand_name"],
                    "fancifulName": row.get("fanciful_name") or row["brand_name"],
                    "company": row["company_name"],
                    "signal": row["signal"],
                    "category": category,
                    "ttbId": row["ttb_id"],
                    "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
                })
                count += 1
            elif si < len(skus):
                row = skus[si]
                si += 1
                new_filings_list.append({
                    "brand": row["brand_name"],
                    "fancifulName": row.get("fanciful_name") or row["brand_name"],
                    "company": row["company_name"],
                    "signal": row["signal"],
                    "category": category,
                    "ttbId": row["ttb_id"],
                    "ttbLink": f"https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid={row['ttb_id']}"
                })
                count += 1

    # 7. Filter category data to only show user's subscribed categories
    filtered_category_data = base_metrics.get("categoryData", [])
    if subscribed_categories:
        filtered_category_data = [
            cat for cat in filtered_category_data
            if cat["label"] in subscribed_categories
        ]

    # 8. Get filtered top filer from category-filtered results
    filtered_top_filer = base_metrics["topFiler"]
    filtered_top_filer_count = base_metrics["topFilerCount"]
    if top_companies_with_change:
        filtered_top_filer = top_companies_with_change[0]["company"]
        filtered_top_filer_count = str(top_companies_with_change[0]["filings"])

    # 9. Rebuild summary bullets with filtered top filer
    filtered_summary_bullets = [
        base_metrics["summaryBullets"][0],  # Total filings + WoW change
        base_metrics["summaryBullets"][1],  # New brands and SKUs
    ]
    # Add biggest category mover if present and in user's categories
    if len(base_metrics["summaryBullets"]) > 2:
        original_third_bullet = base_metrics["summaryBullets"][2]
        if not subscribed_categories or any(cat in original_third_bullet for cat in subscribed_categories):
            filtered_summary_bullets.append(original_third_bullet)
    # Add filtered top filer
    if top_companies_with_change:
        filtered_summary_bullets.append(f"Top filer: {filtered_top_filer} ({filtered_top_filer_count} filings)")

    return {
        "weekEnding": base_metrics["weekEnding"],
        "summaryBullets": filtered_summary_bullets,
        "totalFilings": base_metrics["totalFilings"],
        "newBrands": base_metrics["newBrands"],
        "newSkus": base_metrics["newSkus"],
        "newCompanies": base_metrics["newCompanies"],
        "topFiler": filtered_top_filer,
        "topFilerCount": filtered_top_filer_count,
        "weekOverWeekChange": week_over_week_change,
        "watchlistMatches": watchlist_matches,
        "categoryData": filtered_category_data,
        "topCompaniesList": top_companies_with_change,
        "notableNewBrands": notable_new_brands,
        "filingSpikes": filing_spikes,
        "newFilingsList": new_filings_list,
        "categoryReports": category_reports,  # Category-specific data for subscribed categories
        "weekStartDate": this_week_start.strftime("%Y-%m-%d"),
        "weekEndDate": this_week_end.strftime("%Y-%m-%d"),
        "databaseUrl": "https://bevalcintel.com/database",
        "accountUrl": "https://bevalcintel.com/account.html",
        "preferencesUrl": "https://bevalcintel.com/preferences.html",
    }


# ============================================================================
# SUBSCRIBERS
# ============================================================================

def get_free_subscribers() -> List[str]:
    """Get email addresses of free report subscribers (non-Pro)."""
    results = d1_query("""
        SELECT email FROM user_preferences
        WHERE (subscribed_free_report = 1 OR subscribed_free_report IS NULL)
        AND (is_pro = 0 OR is_pro IS NULL)
    """)
    return [row["email"] for row in results if row.get("email")]


def get_pro_subscribers() -> List[Dict]:
    """Get Pro subscribers with their watchlist and subscribed categories."""
    # Get Pro users with their category subscriptions and tier info
    pro_users = d1_query("""
        SELECT email, stripe_customer_id, categories, tier, tier_category FROM user_preferences
        WHERE is_pro = 1
    """)

    pro_subscribers = []
    for user in pro_users:
        email = user.get("email")
        if not email:
            continue

        tier = user.get("tier")
        tier_category = user.get("tier_category")

        # Determine subscribed categories based on tier
        if tier == "category_pro" and tier_category:
            # Category Pro users get their single tier_category
            subscribed_categories = [tier_category]
        else:
            # Premier users use the categories array
            categories_json = user.get("categories") or "[]"
            try:
                subscribed_categories = json.loads(categories_json) if isinstance(categories_json, str) else categories_json
            except json.JSONDecodeError:
                subscribed_categories = []

        # Get their watchlist
        watchlist = d1_query(f"""
            SELECT type, value FROM watchlist
            WHERE email = '{email.replace(chr(39), chr(39)+chr(39))}'
        """)

        pro_subscribers.append({
            "email": email,
            "tier": tier,
            "tier_category": tier_category,
            "watchlist": watchlist,
            "watchedCompaniesCount": len([w for w in watchlist if w.get("type") == "company"]),
            "watchedBrandsCount": len([w for w in watchlist if w.get("type") == "brand"]),
            "subscribedCategories": subscribed_categories,
        })

    return pro_subscribers


# ============================================================================
# SEND VIA RESEND (Node.js)
# ============================================================================

def send_email_via_node(to: str, metrics: Dict, template: str = "weekly-report") -> bool:
    """Send email by calling the Node.js email sender."""
    props = json.dumps(metrics)

    send_script = f'''
import {{ sendWeeklyReport, sendProWeeklyReport }} from './send.js';

const metrics = {props};

let result;
if ("{template}" === "pro-weekly-report") {{
    result = await sendProWeeklyReport({{
        to: "{to}",
        ...metrics
    }});
}} else {{
    result = await sendWeeklyReport({{
        to: "{to}",
        ...metrics
    }});
}}

if (result.error) {{
    console.error("Error:", result.error.message);
    process.exit(1);
}} else {{
    console.log("Success:", result.data?.id);
}}
'''

    # Write temp script
    temp_script = EMAILS_DIR / "_send_temp.js"
    with open(temp_script, 'w') as f:
        f.write(send_script)

    try:
        result = subprocess.run(
            f"npx tsx {temp_script.name}",
            cwd=str(EMAILS_DIR),
            capture_output=True,
            text=True,
            timeout=30,
            shell=True  # Required on Windows to find npx
        )

        if result.returncode == 0:
            logger.info(f"  Sent ({template}) to {to}: {result.stdout.strip()}")
            return True
        else:
            logger.error(f"  Failed for {to}: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"  Timeout sending to {to}")
        return False
    except Exception as e:
        logger.error(f"  Exception sending to {to}: {e}")
        return False
    finally:
        # Clean up temp script
        if temp_script.exists():
            temp_script.unlink()


# ============================================================================
# MAIN
# ============================================================================

def run_send_report(dry_run: bool = False, single_email: str = None, pro_only: bool = False):
    """Main function to query metrics and send emails."""
    logger.info("=" * 60)
    logger.info("WEEKLY REPORT EMAIL")
    logger.info(f"Started: {datetime.now()}")
    if dry_run:
        logger.info("[DRY RUN MODE]")
    if pro_only:
        logger.info("[PRO ONLY MODE]")
    logger.info("=" * 60)

    # Step 1: Fetch base metrics from D1
    logger.info("\n[STEP 1] Fetching base metrics from D1...")
    try:
        base_metrics = fetch_email_metrics()
        logger.info(f"Week ending: {base_metrics['weekEnding']}")
        logger.info(f"Total filings: {base_metrics['totalFilings']}")
        logger.info(f"New brands: {base_metrics['newBrands']}")
        logger.info(f"New SKUs: {base_metrics['newSkus']}")
        logger.info(f"Summary bullets: {base_metrics['summaryBullets']}")
    except Exception as e:
        logger.error(f"Failed to fetch metrics: {e}")
        return

    # Step 2: Get subscribers
    logger.info("\n[STEP 2] Loading subscribers...")

    free_subscribers = []
    pro_subscribers = []

    if single_email:
        # Check if single email is a Pro user
        pro_check = d1_query(f"""
            SELECT is_pro, categories, tier, tier_category FROM user_preferences
            WHERE email = '{single_email.replace(chr(39), chr(39)+chr(39))}'
        """)
        is_pro = pro_check[0].get("is_pro", 0) if pro_check else 0

        if is_pro:
            tier = pro_check[0].get("tier") if pro_check else None
            tier_category = pro_check[0].get("tier_category") if pro_check else None

            # Determine subscribed categories based on tier
            if tier == "category_pro" and tier_category:
                subscribed_categories = [tier_category]
            else:
                categories_json = pro_check[0].get("categories") or "[]" if pro_check else "[]"
                try:
                    subscribed_categories = json.loads(categories_json) if isinstance(categories_json, str) else categories_json
                except json.JSONDecodeError:
                    subscribed_categories = []

            watchlist = d1_query(f"""
                SELECT type, value FROM watchlist
                WHERE email = '{single_email.replace(chr(39), chr(39)+chr(39))}'
            """)
            pro_subscribers = [{
                "email": single_email,
                "tier": tier,
                "tier_category": tier_category,
                "watchlist": watchlist,
                "watchedCompaniesCount": len([w for w in watchlist if w.get("type") == "company"]),
                "watchedBrandsCount": len([w for w in watchlist if w.get("type") == "brand"]),
                "subscribedCategories": subscribed_categories,
            }]
            logger.info(f"Sending Pro report to: {single_email} (tier: {tier or 'premier'})")
            if subscribed_categories:
                logger.info(f"  Subscribed categories: {', '.join(subscribed_categories)}")
        else:
            free_subscribers = [single_email]
            logger.info(f"Sending free report to: {single_email}")
    else:
        if not pro_only:
            free_subscribers = get_free_subscribers()
            logger.info(f"Found {len(free_subscribers)} free subscribers")

        pro_subscribers = get_pro_subscribers()
        logger.info(f"Found {len(pro_subscribers)} Pro subscribers")

    total_subscribers = len(free_subscribers) + len(pro_subscribers)
    if total_subscribers == 0:
        logger.info("No subscribers found.")
        return

    # Step 3: Send emails
    sent = 0
    failed = 0

    # Send to free subscribers
    if free_subscribers and not pro_only:
        logger.info(f"\n[STEP 3a] Sending FREE reports to {len(free_subscribers)} recipients...")

        for email in free_subscribers:
            if dry_run:
                logger.info(f"  [DRY RUN] Would send free report to: {email}")
                sent += 1
            else:
                if send_email_via_node(email, base_metrics, "weekly-report"):
                    sent += 1
                else:
                    failed += 1

    # Send to Pro subscribers
    if pro_subscribers:
        logger.info(f"\n[STEP 3b] Sending PRO reports to {len(pro_subscribers)} recipients...")

        for subscriber in pro_subscribers:
            email = subscriber["email"]
            watchlist = subscriber.get("watchlist", [])
            subscribed_categories = subscriber.get("subscribedCategories", [])
            tier = subscriber.get("tier")

            try:
                # Fetch Pro-specific metrics for this user
                pro_metrics = fetch_pro_metrics(email, watchlist, subscribed_categories, tier)
                pro_metrics["firstName"] = ""  # Could extract from email or store in DB
                pro_metrics["watchedCompaniesCount"] = subscriber["watchedCompaniesCount"]
                pro_metrics["watchedBrandsCount"] = subscriber["watchedBrandsCount"]
                pro_metrics["tier"] = tier or "premier"
                pro_metrics["tierCategory"] = subscriber.get("tier_category")

                if dry_run:
                    tier_label = tier or "premier"
                    logger.info(f"  [DRY RUN] Would send Pro report to: {email} (tier: {tier_label})")
                    logger.info(f"    - Watchlist matches: {len(pro_metrics.get('watchlistMatches', []))}")
                    logger.info(f"    - Filing spikes: {len(pro_metrics.get('filingSpikes', []))}")
                    logger.info(f"    - Category reports: {len(pro_metrics.get('categoryReports', []))} ({', '.join(subscribed_categories) or 'none'})")
                    sent += 1
                else:
                    if send_email_via_node(email, pro_metrics, "pro-weekly-report"):
                        sent += 1
                    else:
                        failed += 1
            except Exception as e:
                logger.error(f"  Error preparing Pro report for {email}: {e}")
                failed += 1

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("COMPLETE")
    logger.info(f"Sent: {sent}, Failed: {failed}")
    logger.info(f"Finished: {datetime.now()}")
    logger.info("=" * 60)


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Send weekly report emails via Resend')
    parser.add_argument('--dry-run', action='store_true',
                        help='Test without sending emails')
    parser.add_argument('--email', type=str,
                        help='Send to a single email address (for testing)')
    parser.add_argument('--pro-only', action='store_true',
                        help='Only send Pro reports (skip free subscribers)')

    args = parser.parse_args()

    # Validate config
    if not CLOUDFLARE_API_TOKEN:
        logger.error("CLOUDFLARE_API_TOKEN not configured")
        if not args.dry_run:
            return

    run_send_report(dry_run=args.dry_run, single_email=args.email, pro_only=args.pro_only)


if __name__ == '__main__':
    main()
