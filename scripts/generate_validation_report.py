"""
generate_validation_report.py — Build a visual validation report for enriched COLAs

Queries D1 for all enriched COLAs and their label images, generates presigned
R2 URLs for the images, and outputs a self-contained static HTML file at
data/validation_report.html.

Open the HTML in any browser to visually scan label images alongside the
enriched fields to confirm extraction accuracy.

USAGE:
    python scripts/generate_validation_report.py
    python scripts/generate_validation_report.py --limit 20
    python scripts/generate_validation_report.py --output data/my_report.html

REQUIREMENTS:
    - boto3 (R2 presigned URLs)
    - CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN in .env
    - CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY in .env
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime

import requests as http_requests
import boto3
from botocore.config import Config

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
DEFAULT_OUTPUT = DATA_DIR / "validation_report.html"

PRESIGNED_URL_EXPIRY = 7 * 24 * 3600  # 7 days

logger = logging.getLogger("validation_report")
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


def d1_query_rows(sql, params=None):
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
        return []

    result = resp.json()
    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


# =============================================================================
# R2 presigned URLs
# =============================================================================

_r2 = {}


def init_r2():
    account_id = require_env('CLOUDFLARE_ACCOUNT_ID')
    access_key = require_env('CLOUDFLARE_R2_ACCESS_KEY_ID')
    secret_key = require_env('CLOUDFLARE_R2_SECRET_ACCESS_KEY')
    bucket = os.environ.get('CLOUDFLARE_R2_BUCKET_NAME', 'bevalc-reports')

    s3 = boto3.client(
        's3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version='s3v4', retries={'max_attempts': 3}),
        region_name='auto'
    )

    _r2['client'] = s3
    _r2['bucket'] = bucket


def presign(r2_key):
    """Generate a presigned GET URL for an R2 object."""
    return _r2['client'].generate_presigned_url(
        'get_object',
        Params={'Bucket': _r2['bucket'], 'Key': r2_key},
        ExpiresIn=PRESIGNED_URL_EXPIRY
    )


# =============================================================================
# Data queries
# =============================================================================

ENRICHMENT_COLS = [
    'super_category', 'commercial_category', 'subcategory',
    'product_description', 'flavor_profile', 'production_method',
    'barrel_type', 'finishing_process', 'age_years',
    'is_cask_strength', 'is_single_barrel', 'is_limited_release',
    'is_organic', 'is_gluten_free',
    'estimated_price_tier', 'target_market', 'packaging_format', 'parent_company',
    'label_website', 'label_email', 'label_phone', 'label_social_media', 'label_tagline',
    'distilled_in', 'bottled_by', 'bottled_in', 'imported_by', 'year_established',
    'tasting_notes_raw',
    'enrichment_confidence', 'taxonomy_feedback', 'prompt_version',
    'processing_status', 'enriched_at',
]

FILING_COLS = [
    'ttb_id', 'brand_name', 'fanciful_name', 'company_name', 'state',
    'class_type_code', 'origin_code', 'alcohol_content', 'total_bottle_capacity',
    'grape_varietal', 'wine_vintage', 'appellation', 'approval_date', 'signal',
]


def get_enriched_colas(limit):
    """Fetch enriched COLAs with filing + enrichment fields."""
    cols = ', '.join(FILING_COLS + ENRICHMENT_COLS)
    rows = d1_query_rows(
        f"SELECT {cols} FROM colas "
        f"WHERE enriched_at IS NOT NULL "
        f"ORDER BY enriched_at DESC "
        f"LIMIT {limit}"
    )
    logger.info(f"Fetched {len(rows)} enriched COLAs")
    return rows


def get_images_for_ttb_ids(ttb_ids):
    """Fetch all cola_images rows for a set of ttb_ids, keyed by ttb_id."""
    if not ttb_ids:
        return {}

    # Batch into chunks of 50 to avoid huge IN clauses
    images_by_ttb = {}
    for i in range(0, len(ttb_ids), 50):
        chunk = ttb_ids[i:i+50]
        placeholders = ', '.join(f"'{t}'" for t in chunk)
        rows = d1_query_rows(
            f"SELECT image_id, ttb_id, label_type, r2_key, width, height, "
            f"file_size, download_status, ocr_text, ocr_quality_score, "
            f"ocr_abv, ocr_volume_ml, ocr_proof, ocr_age_years "
            f"FROM cola_images "
            f"WHERE ttb_id IN ({placeholders}) "
            f"ORDER BY image_id ASC"
        )
        for row in rows:
            ttb_id = row['ttb_id']
            if ttb_id not in images_by_ttb:
                images_by_ttb[ttb_id] = []
            images_by_ttb[ttb_id].append(row)

    total_images = sum(len(v) for v in images_by_ttb.values())
    logger.info(f"Fetched {total_images} images for {len(images_by_ttb)} COLAs")
    return images_by_ttb


# =============================================================================
# HTML generation
# =============================================================================

def esc(text):
    """HTML-escape a string."""
    if text is None:
        return '<span class="null">null</span>'
    s = str(text)
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    return s


def format_value(key, value):
    """Format a field value for display."""
    if value is None:
        return '<span class="null">null</span>'

    # JSON arrays
    if key in ('flavor_profile', 'label_social_media', 'field_sources'):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return ', '.join(esc(str(v)) for v in parsed)
                if isinstance(parsed, dict):
                    items = [f'<span class="source-key">{esc(k)}</span>: {esc(v)}'
                             for k, v in parsed.items()]
                    return '<br>'.join(items)
            except (json.JSONDecodeError, TypeError):
                pass
        return esc(value)

    # Booleans (stored as 0/1 integers)
    if key.startswith('is_'):
        if value == 1 or value is True:
            return '<span class="bool-true">Yes</span>'
        if value == 0 or value is False:
            return '<span class="bool-false">No</span>'
        return '<span class="null">null</span>'

    # Confidence badges
    if key == 'enrichment_confidence':
        cls = {'high': 'conf-high', 'medium': 'conf-medium', 'low': 'conf-low'}.get(value, '')
        return f'<span class="conf-badge {cls}">{esc(value)}</span>'

    # Price tier badges
    if key == 'estimated_price_tier' and value:
        return f'<span class="tier-badge">{esc(value)}</span>'

    # Long text
    if key in ('product_description', 'tasting_notes_raw', 'taxonomy_feedback'):
        return f'<span class="long-text">{esc(value)}</span>'

    return esc(value)


def field_label(key):
    """Convert a snake_case field name to a human-readable label."""
    return key.replace('_', ' ').title()


def build_html(colas, images_by_ttb):
    """Build the full HTML report string."""
    generated_at = datetime.now().strftime('%Y-%m-%d %H:%M')
    total = len(colas)

    # Count stats
    confidence_counts = {}
    category_counts = {}
    for c in colas:
        conf = c.get('enrichment_confidence') or 'unknown'
        confidence_counts[conf] = confidence_counts.get(conf, 0) + 1
        cat = c.get('super_category') or 'unknown'
        category_counts[cat] = category_counts.get(cat, 0) + 1

    # Build COLA cards
    cards_html = []
    for idx, cola in enumerate(colas):
        ttb_id = cola['ttb_id']
        images = images_by_ttb.get(ttb_id, [])

        # Image panel
        img_panels = []
        for img in images:
            r2_key = img.get('r2_key')
            label_type = img.get('label_type', 'unknown')
            status = img.get('download_status', 'unknown')
            dims = f"{img.get('width', '?')}x{img.get('height', '?')}"
            size_kb = f"{(img.get('file_size') or 0) / 1024:.0f} KB"

            if r2_key and status == 'success':
                try:
                    url = presign(r2_key)
                except Exception:
                    url = None
            else:
                url = None

            if url:
                img_panels.append(
                    f'<div class="image-card">'
                    f'<div class="image-label">{esc(label_type)} &middot; {dims} &middot; {size_kb}</div>'
                    f'<img src="{esc(url)}" alt="{esc(label_type)} label" loading="lazy">'
                    f'</div>'
                )
            else:
                img_panels.append(
                    f'<div class="image-card image-missing">'
                    f'<div class="image-label">{esc(label_type)} &middot; {esc(status)}</div>'
                    f'<div class="no-image">No image available</div>'
                    f'</div>'
                )

        images_html = '\n'.join(img_panels) if img_panels else '<div class="no-image">No images</div>'

        # Filing fields
        filing_rows = []
        for key in FILING_COLS:
            if key == 'ttb_id':
                continue  # shown in header
            val = cola.get(key)
            if val is not None:
                filing_rows.append(
                    f'<tr><td class="field-name">{field_label(key)}</td>'
                    f'<td>{esc(val)}</td></tr>'
                )
        filing_html = '<table class="fields-table">' + '\n'.join(filing_rows) + '</table>'

        # Classification section
        classification_html = ''
        class_fields = ['super_category', 'commercial_category', 'subcategory']
        class_vals = [cola.get(f) for f in class_fields]
        if any(v for v in class_vals):
            parts = [esc(v) for v in class_vals if v]
            classification_html = (
                f'<div class="classification">'
                f'{" &rarr; ".join(parts)}'
                f'</div>'
            )

        # Alcohol & Volume section (OCR fields from images + TTB filing)
        abv_rows = []
        ttb_abv = cola.get('alcohol_content')
        if ttb_abv:
            abv_rows.append(
                f'<tr><td class="field-name">TTB Alcohol Content</td>'
                f'<td>{esc(ttb_abv)}</td></tr>'
            )
        # Aggregate best OCR values across all images for this COLA
        ocr_fields = {
            'ocr_abv': ('OCR ABV', lambda v: f'{v}%' if v else None),
            'ocr_volume_ml': ('OCR Volume', lambda v: f'{v} mL' if v else None),
            'ocr_proof': ('OCR Proof', lambda v: str(v) if v else None),
            'ocr_age_years': ('OCR Age', lambda v: f'{v} years' if v else None),
        }
        for ocr_key, (label_text, fmt) in ocr_fields.items():
            best = None
            for img in images:
                val = img.get(ocr_key)
                if val is not None:
                    best = val
                    break
            if best is not None:
                abv_rows.append(
                    f'<tr><td class="field-name">{label_text}</td>'
                    f'<td>{esc(fmt(best))}</td></tr>'
                )
        if abv_rows:
            abv_html = (
                f'<div class="field-group">'
                f'<div class="group-heading">Alcohol &amp; Volume</div>'
                f'<table class="fields-table">{"".join(abv_rows)}</table>'
                f'</div>'
            )
        else:
            abv_html = ''

        # Enrichment fields (grouped)
        enrichment_groups = [
            ('Product Details', [
                'product_description', 'flavor_profile', 'production_method',
                'barrel_type', 'finishing_process', 'age_years',
            ]),
            ('Flags', [
                'is_cask_strength', 'is_single_barrel', 'is_limited_release',
                'is_organic', 'is_gluten_free',
            ]),
            ('Market & Packaging', [
                'estimated_price_tier', 'target_market', 'packaging_format', 'parent_company',
            ]),
            ('Label Contact Info', [
                'label_website', 'label_email', 'label_phone',
                'label_social_media', 'label_tagline',
            ]),
            ('Production & Sourcing', [
                'distilled_in', 'bottled_by', 'bottled_in', 'imported_by', 'year_established',
            ]),
            ('Tasting Notes', [
                'tasting_notes_raw',
            ]),
            ('Metadata', [
                'enrichment_confidence', 'taxonomy_feedback',
                'prompt_version', 'enriched_at',
            ]),
        ]

        enrichment_sections = []
        for group_name, fields in enrichment_groups:
            rows = []
            has_values = False
            for key in fields:
                val = cola.get(key)
                formatted = format_value(key, val)
                if val is not None:
                    has_values = True
                rows.append(
                    f'<tr><td class="field-name">{field_label(key)}</td>'
                    f'<td>{formatted}</td></tr>'
                )
            if has_values:
                enrichment_sections.append(
                    f'<div class="field-group">'
                    f'<div class="group-heading">{esc(group_name)}</div>'
                    f'<table class="fields-table">{"".join(rows)}</table>'
                    f'</div>'
                )

        enrichment_html = '\n'.join(enrichment_sections)

        # Confidence class for card border
        conf = cola.get('enrichment_confidence', 'unknown')
        conf_class = f'conf-border-{conf}'

        comm_cat = cola.get('commercial_category', '') or ''
        cards_html.append(f'''
<div class="cola-card {conf_class}" id="cola-{esc(ttb_id)}" data-category="{esc(comm_cat)}">
  <div class="card-header">
    <div class="card-title">
      <span class="card-num">#{idx+1}</span>
      <strong>{esc(cola.get('brand_name', ''))}</strong>
      {(' &mdash; ' + esc(cola.get('fanciful_name'))) if cola.get('fanciful_name') else ''}
    </div>
    <div class="card-meta">
      <code>{esc(ttb_id)}</code>
      {format_value('enrichment_confidence', conf)}
    </div>
  </div>
  {classification_html}
  <div class="card-body">
    <div class="image-panel">
      {images_html}
    </div>
    <div class="data-panel">
      <div class="field-group">
        <div class="group-heading">TTB Filing Data</div>
        {filing_html}
      </div>
      {abv_html}
      {enrichment_html}
    </div>
  </div>
</div>
''')

    all_cards = '\n'.join(cards_html)

    # Stats bar
    conf_parts = []
    for c in ['high', 'medium', 'low']:
        count = confidence_counts.get(c, 0)
        if count:
            conf_parts.append(f'<span class="stat-badge conf-{c}">{count} {c}</span>')

    cat_parts = []
    for c in sorted(category_counts.keys()):
        cat_parts.append(f'<span class="stat-badge">{category_counts[c]} {c}</span>')

    # Category dropdown options
    cat_options = ['<option value="all">All Categories</option>']
    for c in sorted(category_counts.keys()):
        cat_options.append(f'<option value="{esc(c)}">{esc(c)} ({category_counts[c]})</option>')

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BevAlc Enrichment Validation Report</title>
<style>
:root {{
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #222633;
  --border: #2d3148;
  --text: #e4e6f0;
  --text-dim: #8b8fa8;
  --accent: #6366f1;
  --green: #22c55e;
  --amber: #f59e0b;
  --red: #ef4444;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  padding: 24px;
}}
.header {{
  max-width: 1400px;
  margin: 0 auto 24px;
}}
.header h1 {{
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}}
.header .subtitle {{
  color: var(--text-dim);
  font-size: 14px;
}}
.stats-bar {{
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border-radius: 8px;
  border: 1px solid var(--border);
  align-items: center;
}}
.stats-bar .label {{
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  margin-right: 4px;
}}
.stat-badge {{
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  background: var(--surface2);
  border: 1px solid var(--border);
}}
.filter-bar {{
  max-width: 1400px;
  margin: 0 auto 20px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}}
.filter-bar input {{
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  width: 300px;
}}
.filter-bar input::placeholder {{ color: var(--text-dim); }}
.filter-bar select {{
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}}
.filter-bar button {{
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}}
.filter-bar button:hover {{ background: var(--surface2); }}
.filter-bar button.active {{
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}}
.cola-card {{
  max-width: 1400px;
  margin: 0 auto 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}}
.cola-card.conf-border-high {{ border-left: 3px solid var(--green); }}
.cola-card.conf-border-medium {{ border-left: 3px solid var(--amber); }}
.cola-card.conf-border-low {{ border-left: 3px solid var(--red); }}
.card-header {{
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}}
.card-title {{
  font-size: 16px;
}}
.card-num {{
  color: var(--text-dim);
  font-size: 13px;
  margin-right: 6px;
}}
.card-meta {{
  display: flex;
  align-items: center;
  gap: 10px;
}}
.card-meta code {{
  font-size: 12px;
  color: var(--text-dim);
  background: var(--surface2);
  padding: 2px 8px;
  border-radius: 4px;
}}
.classification {{
  padding: 8px 20px;
  background: var(--surface2);
  font-size: 14px;
  font-weight: 500;
  color: var(--accent);
  border-bottom: 1px solid var(--border);
}}
.card-body {{
  display: grid;
  grid-template-columns: minmax(300px, 1fr) 2fr;
  gap: 0;
}}
@media (max-width: 900px) {{
  .card-body {{ grid-template-columns: 1fr; }}
}}
.image-panel {{
  padding: 16px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}}
.image-card {{
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}}
.image-label {{
  padding: 6px 10px;
  background: var(--surface2);
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}}
.image-card img {{
  width: 100%;
  height: auto;
  display: block;
  background: #fff;
}}
.image-missing {{
  border-style: dashed;
}}
.no-image {{
  padding: 40px 16px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}}
.data-panel {{
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}}
.field-group {{
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}}
.group-heading {{
  padding: 8px 12px;
  background: var(--surface2);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}}
.fields-table {{
  width: 100%;
  border-collapse: collapse;
}}
.fields-table tr {{
  border-bottom: 1px solid var(--border);
}}
.fields-table tr:last-child {{
  border-bottom: none;
}}
.fields-table td {{
  padding: 6px 12px;
  font-size: 13px;
  vertical-align: top;
}}
.field-name {{
  color: var(--text-dim);
  font-weight: 500;
  white-space: nowrap;
  width: 160px;
}}
.null {{ color: #555; font-style: italic; }}
.bool-true {{ color: var(--green); font-weight: 600; }}
.bool-false {{ color: var(--text-dim); }}
.conf-badge {{
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}}
.conf-high {{ background: rgba(34,197,94,0.15); color: var(--green); }}
.conf-medium {{ background: rgba(245,158,11,0.15); color: var(--amber); }}
.conf-low {{ background: rgba(239,68,68,0.15); color: var(--red); }}
.tier-badge {{
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  background: rgba(99,102,241,0.15);
  color: var(--accent);
}}
.long-text {{
  display: block;
  max-width: 500px;
}}
.source-key {{
  color: var(--text-dim);
  font-size: 11px;
}}
.jump-top {{
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}}
.hidden {{ display: none !important; }}
</style>
</head>
<body>

<div class="header">
  <h1>Enrichment Validation Report</h1>
  <div class="subtitle">
    {total} enriched COLAs &middot; Generated {generated_at}
    &middot; Presigned URLs expire in 7 days
  </div>
  <div class="stats-bar">
    <span class="label">Confidence:</span>
    {' '.join(conf_parts)}
    <span style="margin-left:12px" class="label">Categories:</span>
    {' '.join(cat_parts)}
  </div>
</div>

<div class="filter-bar">
  <input type="text" id="search" placeholder="Filter by brand, company, category, ttb_id..." oninput="filterCards()">
  <select id="category-filter" onchange="filterCards()">
    {''.join(cat_options)}
  </select>
  <button onclick="filterConf('all')" class="conf-btn active" data-conf="all">All</button>
  <button onclick="filterConf('high')" class="conf-btn" data-conf="high">High</button>
  <button onclick="filterConf('medium')" class="conf-btn" data-conf="medium">Medium</button>
  <button onclick="filterConf('low')" class="conf-btn" data-conf="low">Low</button>
</div>

{all_cards}

<button class="jump-top" onclick="window.scrollTo({{top:0,behavior:'smooth'}})" title="Back to top">&uarr;</button>

<script>
let activeConf = 'all';

function filterCards() {{
  const q = document.getElementById('search').value.toLowerCase();
  const cat = document.getElementById('category-filter').value;
  let visible = 0;
  document.querySelectorAll('.cola-card').forEach(card => {{
    const text = card.textContent.toLowerCase();
    const matchesSearch = !q || text.includes(q);
    const matchesConf = activeConf === 'all' || card.classList.contains('conf-border-' + activeConf);
    const matchesCat = cat === 'all' || card.dataset.category === cat;
    const show = matchesSearch && matchesConf && matchesCat;
    card.classList.toggle('hidden', !show);
    if (show) visible++;
  }});
}}

function filterConf(conf) {{
  activeConf = conf;
  document.querySelectorAll('.conf-btn').forEach(b => {{
    b.classList.toggle('active', b.dataset.conf === conf);
  }});
  filterCards();
}}
</script>

</body>
</html>'''

    return html


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Generate visual validation report for enriched COLAs'
    )
    parser.add_argument('--limit', type=int, default=500,
                        help='Max enriched COLAs to include (default: 500)')
    parser.add_argument('--output', type=str, default=str(DEFAULT_OUTPUT),
                        help=f'Output HTML path (default: {DEFAULT_OUTPUT})')
    args = parser.parse_args()

    load_env()
    init_d1()
    init_r2()

    # Fetch data
    colas = get_enriched_colas(args.limit)
    if not colas:
        logger.info("No enriched COLAs found")
        return

    ttb_ids = [c['ttb_id'] for c in colas]
    images_by_ttb = get_images_for_ttb_ids(ttb_ids)

    # Generate presigned URLs count
    total_images = sum(
        1 for imgs in images_by_ttb.values()
        for img in imgs if img.get('r2_key') and img.get('download_status') == 'success'
    )
    logger.info(f"Generating presigned URLs for {total_images} images...")

    # Build HTML
    html = build_html(colas, images_by_ttb)

    # Write
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size_kb = output_path.stat().st_size / 1024
    logger.info(f"Report written to {output_path} ({size_kb:.0f} KB)")
    logger.info(f"Open in browser: file:///{output_path.resolve().as_posix()}")


if __name__ == '__main__':
    main()
