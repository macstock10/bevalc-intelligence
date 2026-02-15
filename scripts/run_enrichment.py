"""
run_enrichment.py — Enrich COLA records using Claude LLM

Queries D1 for COLAs not yet enriched, assembles TTB filing data + OCR text
from label images, sends to Claude for classification and extraction, and
writes results back to D1.

USAGE:
    # Enrich up to 5 COLAs (default)
    python scripts/run_enrichment.py --limit 5

    # Dry run — call Claude but don't write to D1
    python scripts/run_enrichment.py --dry-run --limit 5

SETUP:
    pip install anthropic requests
"""

import os
import re
import sys
import json
import time
import argparse
import logging
from pathlib import Path
from datetime import datetime, timezone

import requests as http_requests
import anthropic


SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"

PROMPT_VERSION = "1.3"
MODEL = "claude-haiku-4-5-20251001"


# =============================================================================
# Logging
# =============================================================================

logger = logging.getLogger("run_enrichment")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter(
    '%(asctime)s | %(levelname)s | %(message)s', datefmt='%H:%M:%S'
))
logger.addHandler(_handler)


# =============================================================================
# Environment
# =============================================================================

def load_env():
    if ENV_FILE.exists():
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())


def require_env(name):
    val = os.environ.get(name)
    if not val:
        logger.error(f"{name} not found in env or .env file")
        sys.exit(1)
    return val


# =============================================================================
# D1 API
# =============================================================================

_d1_config = {}


def init_d1():
    _d1_config['account_id'] = require_env('CLOUDFLARE_ACCOUNT_ID')
    _d1_config['database_id'] = require_env('CLOUDFLARE_D1_DATABASE_ID')
    _d1_config['api_token'] = require_env('CLOUDFLARE_API_TOKEN')
    _d1_config['api_url'] = (
        f"https://api.cloudflare.com/client/v4/accounts/{_d1_config['account_id']}"
        f"/d1/database/{_d1_config['database_id']}/query"
    )


def d1_execute(sql, params=None):
    headers = {
        "Authorization": f"Bearer {_d1_config['api_token']}",
        "Content-Type": "application/json"
    }
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    resp = http_requests.post(_d1_config['api_url'], headers=headers, json=payload)
    if resp.status_code != 200:
        logger.error(f"D1 API error {resp.status_code}: {resp.text[:300]}")
        return {"success": False, "error": resp.text}

    result = resp.json()
    if result.get("errors"):
        logger.error(f"D1 errors: {result['errors']}")
    return result


def d1_query_rows(sql, params=None):
    result = d1_execute(sql, params)
    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def escape_sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    s = s.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
    s = s.replace("'", "''")
    s = ''.join(c if ord(c) >= 32 or c in ' ' else ' ' for c in s)
    return f"'{s}'"


# =============================================================================
# Taxonomy — valid subcategories (from TAXONOMY.md)
# =============================================================================

VALID_SUBCATEGORIES = """Straight Bourbon, Small Batch Bourbon, Single Barrel Bourbon, Cask Strength Bourbon, Wheated Bourbon, Bottled in Bond Bourbon, Flavored Bourbon, Kentucky Bourbon (NAS), Non-Kentucky Bourbon, Blended Straight Bourbon, Bourbon (Other), Straight Rye, Single Barrel Rye, Cask Strength Rye, Bottled in Bond Rye, Flavored Rye, Blended Straight Rye, Rye Whiskey (Other), Tennessee Whiskey, American Single Malt, Corn Whiskey, Wheat Whiskey, American Blended Whiskey, Spirit Whiskey, White/Unaged Whiskey, Flavored American Whiskey, American Whiskey (Other), Single Malt Scotch, Blended Scotch, Blended Malt Scotch, Single Grain Scotch, Scotch Whisky (Other), Single Malt Irish, Single Pot Still Irish, Blended Irish, Single Grain Irish, Irish Whiskey (Other), Japanese Single Malt, Japanese Blended, Japanese Whisky (Other), Canadian Blended, Canadian Single Malt, Canadian Rye, Canadian Whisky (Other), Indian Whisky, Taiwanese Whisky, Australian Whisky, World Whisky (Other), Blanco / Silver, Reposado, Añejo, Extra Añejo, Cristalino, Flavored Tequila, Tequila (Other), Joven Mezcal, Reposado Mezcal, Añejo Mezcal, Mezcal (Other), Sotol, Raicilla, Bacanora, Agave Spirit (Other), Unflavored Vodka, Flavored Vodka, Vodka (Other), London Dry Gin, American Gin, Old Tom Gin, Navy Strength Gin, Flavored / Contemporary Gin, Genever, Gin (Other), White / Silver Rum, Gold Rum, Dark Rum, Aged Rum, Spiced Rum, Flavored Rum, Rhum Agricole, Cachaça, Rum (Other), Cognac VS, Cognac VSOP, Cognac XO, Armagnac, American Brandy, Pisco, Grappa, Fruit Brandy, Brandy (Other), Cream Liqueur, Coffee Liqueur, Herbal / Bitter Liqueur, Fruit Liqueur, Nut Liqueur, Whiskey-Based Liqueur, Agave-Based Liqueur, Schnapps, Amaretto, Triple Sec / Orange Liqueur, Liqueur (Other), Italian Amaro, Fernet, Aperitivo / Aperol Type, Cocktail Bitters, Amaro (Other), Absinthe, Pastis, Ouzo, Sambuca, Anise Spirit (Other), Sake (Junmai), Sake (Ginjo), Sake (Daiginjo), Sake (Other), Soju, Shochu, Baijiu, Asian Spirit (Other), Whiskey-Based RTD, Tequila-Based RTD, Vodka-Based RTD, Rum-Based RTD, Gin-Based RTD, Multi-Spirit RTD, RTD Cocktail (Other), Moonshine / White Lightning, Aquavit, Mezcal-Adjacent Spirits, Specialty Spirit (Other), Cabernet Sauvignon, Pinot Noir, Merlot, Zinfandel, Syrah / Shiraz, Malbec, Tempranillo, Sangiovese, Nebbiolo, Barbera, Grenache / Garnacha, Cabernet Franc, Petite Sirah, Mourvèdre, Red Blend, Red Wine (Other Varietal), Chardonnay, Sauvignon Blanc, Pinot Grigio / Pinot Gris, Riesling, Moscato / Muscat, Viognier, Chenin Blanc, Gewürztraminer, Albariño, Grüner Veltliner, White Blend, White Wine (Other Varietal), Provence Rosé, Domestic Rosé, Rosé Blend, Rosé (Other), Champagne, Prosecco, Cava, Crémant, Domestic Sparkling, Sparkling Rosé, Sparkling Wine (Other), Port, Sherry, Madeira, Marsala, Late Harvest / Ice Wine, Sauternes, Dessert Wine (Other), Dry Vermouth, Sweet Vermouth, Aromatized Wine (Other), Natural Wine, Orange Wine, Pét-Nat, Natural Wine (Other), Canned Wine, Bag-in-Box Wine, Tetra Pak Wine, Alternative Format Wine (Other), Apple Wine / Cider Wine, Mead, Fruit Wine, Rice Wine (Non-Sake), Non-Grape Wine (Other), American Lager, Light Lager, Mexican Lager, German Lager / Pilsner, Czech Pilsner, Vienna Lager, Helles, Märzen / Oktoberfest, Bock / Doppelbock, Dunkel, Schwarzbier, Lager (Other), Pale Ale, American Pale Ale (APA), India Pale Ale (IPA), New England / Hazy IPA, Double / Imperial IPA, West Coast IPA, Session IPA, Blonde Ale, Amber Ale, Brown Ale, Scottish Ale, Cream Ale, Kölsch, Ale (Other), Dry Stout, Imperial Stout, Milk Stout, Oatmeal Stout, Pastry Stout, Coffee Stout, Porter, Baltic Porter, Stout & Porter (Other), American Wheat, Hefeweizen, Witbier, Berliner Weisse, Wheat Beer (Other), Belgian Blonde, Belgian Dubbel, Belgian Tripel, Belgian Quad, Saison / Farmhouse, Belgian Strong, Belgian Style (Other), Gose, Berliner Weisse (Sour), Fruited Sour, American Wild Ale, Lambic / Gueuze, Flanders Red, Sour (Other), Unflavored Hard Seltzer, Flavored Hard Seltzer, Hard Seltzer (Other), Dry Cider, Sweet Cider, Flavored Cider, Perry, Hard Cider (Other), Hard Kombucha, Spirit-Flavored FMB, Fruit-Flavored FMB, Tea/Lemonade FMB, Energy FMB, FMB (Other), Non-Alcoholic Beer, Low-ABV Beer (Under 3.2%), NA / Low-ABV (Other), Barrel-Aged Beer, Smoked Beer, Pumpkin / Seasonal Beer, Gluten-Free Beer, Specialty Beer (Other)"""


# =============================================================================
# System prompt (from ENRICHMENT_PROMPT.md v1.1)
# =============================================================================

SYSTEM_PROMPT = """You are a beverage alcohol product classification expert. Your job is to analyze TTB COLA filings and label text to extract detailed commercial product information.

You will receive structured data from a TTB filing plus OCR text extracted from the product's label images. Using all available information, extract the fields listed below.

CRITICAL RULES:
1. For categorical fields (super_category, commercial_category, subcategory, estimated_price_tier), you MUST choose from the provided valid values. Do not invent new categories.
2. Return null for any field that cannot be determined with reasonable confidence from the available data. Do not guess or hallucinate.
3. Your response must be valid JSON and nothing else. No preamble, no markdown, no explanation.
4. The confidence field reflects your overall confidence in the classification. "high" = clearly identifiable product. "medium" = reasonable inference but some ambiguity. "low" = significant uncertainty, best guess.
5. If the product does not fit cleanly into any subcategory, choose the closest match and explain in taxonomy_feedback. If the classification is straightforward and the product fits cleanly, taxonomy_feedback MUST be null. Do not write explanatory notes when the product maps obviously to a category.
6. Only populate fields where the value is explicitly stated in the TTB filing data or label OCR text provided. If information cannot be directly sourced from the input data, return null. Never infer parent_company, production_method, barrel_type, flavor_profile, estimated_price_tier, or target_market from general knowledge. The only exception is super_category/commercial_category/subcategory which may require reasonable inference from class_type_code.
7. Include a "field_sources" object that maps every non-null field name to its source: "ttb_filing", "label", or "inferred". This enables provenance tracking."""


# =============================================================================
# User message template
# =============================================================================

USER_MSG_TEMPLATE = """Classify the following beverage alcohol product.

## TTB FILING DATA
- Brand Name: {brand_name}
- Fanciful Name: {fanciful_name}
- Class/Type Code: {class_type_code}
- Origin: {origin_code}
- Alcohol Content: {alcohol_content}
- Total Bottle Capacity: {total_bottle_capacity}
- Grape Varietal: {grape_varietal}
- Wine Vintage: {wine_vintage}
- Appellation: {appellation}
- Company Name: {company_name}
- State: {state}
- Formula: {formula}

## LABEL TEXT (Front)
{front_label_ocr}

## LABEL TEXT (Back)
{back_label_ocr}

## PRE-PARSED LABEL DATA
- OCR ABV: {ocr_abv}
- OCR Volume (mL): {ocr_volume_ml}
- OCR Proof: {ocr_proof}
- OCR Age (years): {ocr_age_years}
- OCR Website: {ocr_website}

## VALID SUPER CATEGORIES
Spirits, Wine, Beer & FMB

## VALID CATEGORIES
Bourbon, Rye Whiskey, American Whiskey (Other), Scotch Whisky, Irish Whiskey, Japanese Whisky, Canadian Whisky, World Whisky, Tequila, Mezcal, Other Agave Spirits, Vodka, Gin, Rum, Brandy & Cognac, Liqueur & Cordial, Amaro & Bitters, Absinthe & Anise Spirits, Sake & Asian Spirits, Ready-to-Drink Spirits (RTD), Specialty & Other Spirits, Red Wine, White Wine, Rosé Wine, Sparkling Wine, Dessert & Fortified Wine, Vermouth & Aromatized Wine, Natural & Low-Intervention Wine, Canned & Alternative Format Wine, Fruit & Non-Grape Wine, Lager, Ale, Stout & Porter, Wheat Beer, Belgian Style, Sour & Wild Ale, Hard Seltzer, Hard Cider, Hard Kombucha, Flavored Malt Beverage (FMB), Non-Alcoholic & Low-ABV Beer, Specialty Beer

## VALID SUBCATEGORIES
{valid_subcategories}

## VALID PRICE TIERS
value, standard, premium, super-premium, ultra-premium

## EDGE CASE RULES
- Whiskey-based cream liqueurs (e.g., Irish Cream) → Liqueur & Cordial → Cream Liqueur
- Flavored spirits ABV above 30% with clear base spirit → spirit's flavored subcategory
- Flavored spirits ABV 30% or below, or flavor-forward identity → Liqueur & Cordial
- Products at exactly 30% ABV with prominent fruit/flavor branding → Liqueur & Cordial (flavor-forward)
- Blends of straight bourbons from multiple states → Bourbon → Blended Straight Bourbon
- Blends of straight rye whiskeys → Rye Whiskey → Blended Straight Rye
- Flavored whiskeys (not bourbon-specific) at 30%+ ABV → American Whiskey (Other) → Flavored American Whiskey
- French Burgundy whites (Chablis, Meursault, Puligny-Montrachet, Chassagne-Montrachet, Pouilly-Fuissé) → Chardonnay (mandated by AOC law, not inference)
- French Burgundy reds (Gevrey-Chambertin, Vosne-Romanée, Nuits-Saint-Georges, Pommard, Volnay, Beaune) → Pinot Noir (mandated by AOC law)
- Sancerre white / Pouilly-Fumé → Sauvignon Blanc (mandated by AOC law)
- Barbera d'Asti / Barbera d'Alba → Barbera (mandated by DOC/DOCG law)
- Barolo / Barbaresco → Nebbiolo (mandated by DOCG law)
- Spirits-based RTD → Ready-to-Drink Spirits (RTD)
- Malt-based cocktail-flavored → FMB → Spirit-Flavored FMB
- Hard seltzer → Hard Seltzer regardless of base
- Sake filed as wine → Sake & Asian Spirits
- Cider filed as wine → Hard Cider
- Vermouth → Vermouth & Aromatized Wine
- Mead → Fruit & Non-Grape Wine → Mead
- Non-alcoholic → appropriate NA category

## OUTPUT FORMAT
Return a single JSON object with these exact fields:
{{
  "super_category": "string (from valid list)",
  "commercial_category": "string (from valid list)",
  "subcategory": "string (from valid list)",
  "product_description": "string (1-2 sentence commercial description) or null",
  "flavor_profile": ["array", "of", "descriptors"] or null,
  "production_method": "string or null",
  "barrel_type": "string or null",
  "finishing_process": "string or null",
  "age_years": number or null,
  "is_cask_strength": true/false,
  "is_single_barrel": true/false,
  "is_limited_release": true/false,
  "is_organic": true/false,
  "is_gluten_free": true/false,
  "estimated_price_tier": "string (from valid list)",
  "target_market": "string or null",
  "packaging_format": "string or null",
  "parent_company": "string or null",
  "label_website": "string or null",
  "label_email": "string or null",
  "label_phone": "string or null",
  "label_social_media": ["array"] or null,
  "label_tagline": "string or null",
  "distilled_in": "string or null",
  "bottled_by": "string or null",
  "bottled_in": "string or null",
  "imported_by": "string or null",
  "year_established": number or null,
  "tasting_notes_raw": "string (exact text from label) or null",
  "confidence": "high/medium/low",
  "taxonomy_feedback": "string or null",
  "field_sources": {{"field_name": "ttb_filing|label|inferred", ...}}
}}"""


# =============================================================================
# D1 queries
# =============================================================================

def get_colas_needing_enrichment(limit):
    """Get colas not yet enriched, with aggregated OCR from cola_images."""
    logger.info(f"Querying D1 for up to {limit} COLAs not yet enriched...")

    # Only select COLAs that have at least one image with OCR text
    colas = d1_query_rows(
        f"SELECT c.ttb_id, c.brand_name, c.fanciful_name, c.class_type_code, "
        f"c.origin_code, c.alcohol_content, c.total_bottle_capacity, "
        f"c.grape_varietal, c.wine_vintage, c.appellation, c.company_name, "
        f"c.state, c.formula "
        f"FROM colas c "
        f"WHERE c.enriched_at IS NULL "
        f"AND EXISTS (SELECT 1 FROM cola_images ci "
        f"  WHERE ci.ttb_id = c.ttb_id AND ci.ocr_text IS NOT NULL) "
        f"ORDER BY c.approval_date DESC "
        f"LIMIT {limit}"
    )

    if not colas:
        return []

    logger.info(f"Found {len(colas)} COLAs to enrich")

    # For each COLA, get its images' OCR text
    for cola in colas:
        ttb_id = cola['ttb_id']
        images = d1_query_rows(
            f"SELECT image_id, label_type, ocr_text, ocr_abv, ocr_volume_ml, "
            f"ocr_proof, ocr_age_years, ocr_website "
            f"FROM cola_images "
            f"WHERE ttb_id = '{ttb_id}' AND download_status = 'success' "
            f"ORDER BY image_id"
        )

        # Separate front/back OCR, aggregate pre-parsed fields
        front_ocr_parts = []
        back_ocr_parts = []
        best_abv = None
        best_volume = None
        best_proof = None
        best_age = None
        best_website = None

        for img in images:
            ocr = img.get('ocr_text') or ''
            label_type = img.get('label_type') or 'unknown'
            img_id = img.get('image_id', '')

            if ocr.strip():
                header = f"[Image: {img_id}, Type: {label_type}]"
                if label_type == 'back':
                    back_ocr_parts.append(f"{header}\n{ocr}")
                else:
                    front_ocr_parts.append(f"{header}\n{ocr}")

            # Take first non-null value for each pre-parsed field
            if best_abv is None and img.get('ocr_abv'):
                best_abv = img['ocr_abv']
            if best_volume is None and img.get('ocr_volume_ml'):
                best_volume = img['ocr_volume_ml']
            if best_proof is None and img.get('ocr_proof'):
                best_proof = img['ocr_proof']
            if best_age is None and img.get('ocr_age_years'):
                best_age = img['ocr_age_years']
            if best_website is None and img.get('ocr_website'):
                best_website = img['ocr_website']

        cola['_front_ocr'] = '\n\n'.join(front_ocr_parts) if front_ocr_parts else '(no front label text available)'
        cola['_back_ocr'] = '\n\n'.join(back_ocr_parts) if back_ocr_parts else '(no back label text available)'
        cola['_ocr_abv'] = best_abv
        cola['_ocr_volume_ml'] = best_volume
        cola['_ocr_proof'] = best_proof
        cola['_ocr_age_years'] = best_age
        cola['_ocr_website'] = best_website
        cola['_image_count'] = len(images)

    return colas


def update_cola_enrichment(ttb_id, enrichment):
    """Update a colas row with enrichment results."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # Map JSON booleans → SQLite integers (None stays NULL)
    bool_fields = ['is_cask_strength', 'is_single_barrel', 'is_limited_release',
                   'is_organic', 'is_gluten_free']

    # Map JSON arrays/objects → JSON strings
    json_fields = ['flavor_profile', 'label_social_media', 'field_sources']

    # Build SET clauses
    sets = []
    for key, value in enrichment.items():
        if key in bool_fields:
            if value is None:
                sets.append(f"{key} = NULL")
            else:
                sets.append(f"{key} = {1 if value else 0}")
        elif key in json_fields:
            if value is not None:
                sets.append(f"{key} = {escape_sql_value(json.dumps(value))}")
            else:
                sets.append(f"{key} = NULL")
        elif key == 'confidence':
            # Maps to enrichment_confidence column
            sets.append(f"enrichment_confidence = {escape_sql_value(value)}")
        else:
            sets.append(f"{key} = {escape_sql_value(value)}")

    # Add system fields
    sets.append(f"enriched_at = {escape_sql_value(now)}")
    sets.append(f"prompt_version = {escape_sql_value(PROMPT_VERSION)}")
    sets.append(f"processing_status = 'enriched'")

    sql = f"UPDATE colas SET {', '.join(sets)} WHERE ttb_id = {escape_sql_value(ttb_id)}"
    return d1_execute(sql)


# =============================================================================
# Claude API
# =============================================================================

_claude = {}


def init_claude():
    api_key = require_env('ANTHROPIC_API_KEY')
    _claude['client'] = anthropic.Anthropic(api_key=api_key)
    logger.info(f"Claude model: {MODEL}")


def call_claude(cola):
    """Build prompt and call Claude for one COLA. Returns parsed JSON or None."""
    user_msg = USER_MSG_TEMPLATE.format(
        brand_name=cola.get('brand_name') or '(not provided)',
        fanciful_name=cola.get('fanciful_name') or '(not provided)',
        class_type_code=cola.get('class_type_code') or '(not provided)',
        origin_code=cola.get('origin_code') or '(not provided)',
        alcohol_content=cola.get('alcohol_content') or '(not provided)',
        total_bottle_capacity=cola.get('total_bottle_capacity') or '(not provided)',
        grape_varietal=cola.get('grape_varietal') or '(not provided)',
        wine_vintage=cola.get('wine_vintage') or '(not provided)',
        appellation=cola.get('appellation') or '(not provided)',
        company_name=cola.get('company_name') or '(not provided)',
        state=cola.get('state') or '(not provided)',
        formula=cola.get('formula') or '(not provided)',
        front_label_ocr=cola['_front_ocr'],
        back_label_ocr=cola['_back_ocr'],
        ocr_abv=cola['_ocr_abv'] or '(not extracted)',
        ocr_volume_ml=cola['_ocr_volume_ml'] or '(not extracted)',
        ocr_proof=cola['_ocr_proof'] or '(not extracted)',
        ocr_age_years=cola['_ocr_age_years'] or '(not extracted)',
        ocr_website=cola['_ocr_website'] or '(not extracted)',
        valid_subcategories=VALID_SUBCATEGORIES,
    )

    try:
        response = _claude['client'].messages.create(
            model=MODEL,
            max_tokens=2048,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )

        raw_text = response.content[0].text.strip()

        # Strip markdown code fences if present
        if raw_text.startswith('```'):
            lines = raw_text.split('\n')
            # Remove first line (```json) and last line (```)
            lines = [l for l in lines if not l.strip().startswith('```')]
            raw_text = '\n'.join(lines).strip()

        result = json.loads(raw_text)

        # Track token usage
        usage = response.usage
        _claude.setdefault('total_input_tokens', 0)
        _claude.setdefault('total_output_tokens', 0)
        _claude['total_input_tokens'] += usage.input_tokens
        _claude['total_output_tokens'] += usage.output_tokens

        return result

    except json.JSONDecodeError as e:
        logger.error(f"  JSON parse error: {e}")
        logger.error(f"  Raw response: {raw_text[:500]}")
        return None
    except Exception as e:
        logger.error(f"  Claude API error: {e}")
        return None


# =============================================================================
# Enrichment fields — what we write to D1
# =============================================================================

ENRICHMENT_FIELDS = [
    'super_category', 'commercial_category', 'subcategory',
    'product_description', 'flavor_profile', 'production_method',
    'barrel_type', 'finishing_process', 'age_years',
    'is_cask_strength', 'is_single_barrel', 'is_limited_release',
    'is_organic', 'is_gluten_free',
    'estimated_price_tier', 'target_market', 'packaging_format',
    'parent_company',
    'label_website', 'label_email', 'label_phone',
    'label_social_media', 'label_tagline',
    'distilled_in', 'bottled_by', 'bottled_in', 'imported_by',
    'year_established', 'tasting_notes_raw',
    'confidence', 'taxonomy_feedback', 'field_sources',
]


# =============================================================================
# Source verification — check extracted values against actual input data
# =============================================================================

VERIFIABLE_FIELDS = [
    'label_website', 'label_email', 'label_phone',
    'bottled_by', 'bottled_in', 'imported_by', 'distilled_in',
    'tasting_notes_raw', 'year_established', 'label_tagline',
]


def normalize_text(text):
    """Lowercase, collapse whitespace, strip punctuation for fuzzy matching."""
    if text is None:
        return ''
    s = str(text).lower()
    s = re.sub(r'https?://(www\.)?', '', s)
    s = re.sub(r'[,.:;!?()\[\]{}"\']+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def build_source_corpus(cola):
    """Concatenate all source data (TTB filing + OCR text) into one searchable string."""
    parts = []
    for key in ['brand_name', 'fanciful_name', 'class_type_code', 'origin_code',
                'alcohol_content', 'total_bottle_capacity', 'grape_varietal',
                'wine_vintage', 'appellation', 'company_name', 'state', 'formula']:
        val = cola.get(key)
        if val:
            parts.append(str(val))
    for key in ['_front_ocr', '_back_ocr']:
        val = cola.get(key, '')
        if val and not val.startswith('(no '):
            parts.append(val)
    return normalize_text(' '.join(parts))


def value_in_corpus(value, corpus):
    """Check if value or a meaningful fragment appears in the source corpus."""
    if value is None:
        return True

    # Numbers: check if the string representation appears
    if isinstance(value, (int, float)):
        return str(int(value)) in corpus

    normalized = normalize_text(value)
    if not normalized or len(normalized) < 3:
        return True

    # Direct match
    if normalized in corpus:
        return True

    # For short values (1-2 words), require exact match (already checked above)
    words = normalized.split()
    if len(words) <= 2:
        return False

    # For longer values, check if any 3-word window matches
    for i in range(len(words) - 2):
        fragment = ' '.join(words[i:i + 3])
        if fragment in corpus:
            return True

    return False


# =============================================================================
# Main pipeline
# =============================================================================

def run_enrichment(colas, dry_run=False):
    """Enrich each COLA: build prompt, call Claude, update D1."""
    enriched = 0
    failed = 0
    skipped = 0

    # Track category distribution
    category_counts = {}
    confidence_counts = {'high': 0, 'medium': 0, 'low': 0}

    inferred_nulled = 0
    unverifiable_nulled = 0

    # For verbose output: print full JSON for first spirits + first wine
    printed_spirits = False
    printed_wine = False

    for idx, cola in enumerate(colas):
        ttb_id = cola['ttb_id']
        brand = cola.get('brand_name') or '(unknown)'
        fanciful = cola.get('fanciful_name') or ''
        img_count = cola.get('_image_count', 0)

        label = f"{brand}"
        if fanciful:
            label += f" — {fanciful}"

        logger.info(f"[{idx+1}/{len(colas)}] {ttb_id}: {label} ({img_count} images)")

        # Call Claude
        result = call_claude(cola)

        if result is None:
            failed += 1
            logger.error(f"  FAILED — no valid response")
            continue

        # Extract only known fields
        enrichment = {}
        for field in ENRICHMENT_FIELDS:
            if field in result:
                enrichment[field] = result[field]

        # Post-processing: null out any field where field_sources says "inferred"
        # Exception: category fields (super_category, commercial_category, subcategory)
        # are allowed to be inferred from class_type_code per prompt rules.
        ALLOWED_INFERRED = {'super_category', 'commercial_category', 'subcategory',
                            'confidence', 'taxonomy_feedback', 'field_sources'}
        sources = enrichment.get('field_sources') or {}
        if isinstance(sources, dict):
            for field_name, source in sources.items():
                if source == 'inferred' and field_name not in ALLOWED_INFERRED:
                    if enrichment.get(field_name) is not None:
                        logger.warning(f"  NULLED inferred field: {field_name}={enrichment[field_name]!r}")
                        enrichment[field_name] = None
                        inferred_nulled += 1

        # Post-processing: verify factual fields against source data
        corpus = build_source_corpus(cola)
        for field_name in VERIFIABLE_FIELDS:
            val = enrichment.get(field_name)
            if val is not None and not value_in_corpus(val, corpus):
                logger.warning(f"  NULLED unverifiable field: {field_name}={val!r}")
                enrichment[field_name] = None
                unverifiable_nulled += 1

        # Post-processing: null boolean false where label has no evidence
        # Absence of "cask strength" on a label means unknown, not false.
        BOOLEAN_EVIDENCE = {
            'is_cask_strength': ['cask strength', 'barrel proof', 'barrel strength', 'full proof'],
            'is_single_barrel': ['single barrel', 'single cask'],
            'is_limited_release': ['limited release', 'limited edition', 'special release',
                                   'small batch', 'reserve', 'allocated'],
            'is_organic': ['organic', 'usda organic', 'certified organic'],
            'is_gluten_free': ['gluten free', 'gluten-free'],
        }
        for field_name, evidence_terms in BOOLEAN_EVIDENCE.items():
            val = enrichment.get(field_name)
            if val is True:
                # True claims must have evidence on label
                if not any(term in corpus for term in evidence_terms):
                    logger.warning(f"  NULLED unverifiable boolean: {field_name}=True")
                    enrichment[field_name] = None
                    unverifiable_nulled += 1
            elif val is False:
                # False without evidence = unknown, not confirmed false
                if not any(term in corpus for term in evidence_terms):
                    enrichment[field_name] = None

        # Validate required fields
        sc = enrichment.get('super_category')
        cc = enrichment.get('commercial_category')
        sub = enrichment.get('subcategory')
        conf = enrichment.get('confidence', 'unknown')

        if not sc or not cc or not sub:
            failed += 1
            logger.error(f"  FAILED — missing required category fields")
            logger.error(f"  Got: super={sc}, cat={cc}, sub={sub}")
            continue

        enriched += 1
        category_counts[cc] = category_counts.get(cc, 0) + 1

        # Print full JSON for first spirits and first wine
        if not printed_spirits and sc == 'Spirits':
            print(f"\n{'─'*60}")
            print(f"FULL RESPONSE — {ttb_id}: {label}")
            print(f"{'─'*60}")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            print(f"{'─'*60}")
            printed_spirits = True
        elif not printed_wine and sc == 'Wine':
            print(f"\n{'─'*60}")
            print(f"FULL RESPONSE — {ttb_id}: {label}")
            print(f"{'─'*60}")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            print(f"{'─'*60}")
            printed_wine = True
        if conf in confidence_counts:
            confidence_counts[conf] += 1

        logger.info(f"  {sc} > {cc} > {sub} [{conf}]")

        # Write to D1
        if not dry_run:
            update_result = update_cola_enrichment(ttb_id, enrichment)
            if not update_result.get('success'):
                logger.error(f"  D1 update failed for {ttb_id}")

        # Rate limit: ~1 req/sec to be safe
        if idx < len(colas) - 1:
            time.sleep(1)

    # Summary
    print(f"\n{'='*60}")
    print(f"ENRICHMENT SUMMARY")
    print(f"{'='*60}")
    print(f"COLAs processed:    {enriched + failed + skipped}")
    print(f"Enriched:           {enriched}")
    print(f"Failed:             {failed}")
    if inferred_nulled:
        print(f"Inferred→null:      {inferred_nulled}")
    if unverifiable_nulled:
        print(f"Unverifiable→null:  {unverifiable_nulled}")
    if confidence_counts['high'] or confidence_counts['medium'] or confidence_counts['low']:
        print(f"\nConfidence:")
        for level in ['high', 'medium', 'low']:
            if confidence_counts[level]:
                print(f"  {level:8s}: {confidence_counts[level]}")
    if category_counts:
        print(f"\nCategories:")
        for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
            print(f"  {cat:30s}: {count}")
    if _claude.get('total_input_tokens'):
        input_t = _claude['total_input_tokens']
        output_t = _claude['total_output_tokens']
        # Haiku 4.5 pricing: $0.80/MTok input, $4/MTok output
        cost = (input_t * 0.80 + output_t * 4) / 1_000_000
        print(f"\nToken usage:")
        print(f"  Input:  {input_t:,}")
        print(f"  Output: {output_t:,}")
        print(f"  Est. cost: ${cost:.4f}")
    if dry_run:
        print(f"\n[DRY RUN — nothing written to D1]")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Enrich COLA records using Claude LLM',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/run_enrichment.py --limit 5
  python scripts/run_enrichment.py --dry-run --limit 10
        """
    )
    parser.add_argument('--limit', type=int, default=5,
                        help='Max COLAs to enrich (default: 5)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Call Claude but don\'t write to D1')
    args = parser.parse_args()

    # Fix Windows Unicode issues
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    load_env()
    init_d1()
    init_claude()

    colas = get_colas_needing_enrichment(args.limit)
    if not colas:
        logger.info("No COLAs to enrich")
        return

    run_enrichment(colas, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
