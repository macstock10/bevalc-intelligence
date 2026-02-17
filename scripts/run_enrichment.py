"""
run_enrichment.py — Enrich COLA records using Claude LLM

Queries D1 for COLAs not yet enriched, assembles TTB filing data + OCR text
from label images, sends to Claude for classification and extraction, and
writes results back to D1.

USAGE:
    # Enrich up to 5 COLAs (default, 5 parallel workers)
    python scripts/run_enrichment.py --limit 5

    # Dry run — call Claude but don't write to D1
    python scripts/run_enrichment.py --dry-run --limit 10

    # Sequential mode (1 worker)
    python scripts/run_enrichment.py --limit 5 --workers 1

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
import threading
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
import anthropic


SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"

PROMPT_FILE = BASE_DIR / "enhancements" / "prompts" / "ENRICHMENT_PROMPT.md"
TAXONOMY_FILE = BASE_DIR / "enhancements" / "taxonomy" / "TAXONOMY.md"


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
# Prompt loader — reads from ENRICHMENT_PROMPT.md (single source of truth)
# =============================================================================

PROMPT_VERSION = None  # Set by load_prompt()
MODEL = None           # Set by load_prompt()
SYSTEM_PROMPT = None   # Set by load_prompt()
USER_MSG_TEMPLATE = None  # Set by load_prompt()
VALID_SUBCATEGORIES = None  # Set by load_prompt()


def load_prompt():
    """Parse ENRICHMENT_PROMPT.md to extract system prompt, user template, version, and model."""
    global PROMPT_VERSION, MODEL, SYSTEM_PROMPT, USER_MSG_TEMPLATE, VALID_SUBCATEGORIES

    if not PROMPT_FILE.exists():
        logger.error(f"Prompt file not found: {PROMPT_FILE}")
        sys.exit(1)

    text = PROMPT_FILE.read_text(encoding='utf-8')

    # Extract version and model from header
    ver_match = re.search(r'## Version:\s*(.+)', text)
    model_match = re.search(r'## Model:\s*(.+)', text)
    if not ver_match or not model_match:
        logger.error("Could not parse Version/Model from prompt file header")
        sys.exit(1)
    PROMPT_VERSION = ver_match.group(1).strip()
    MODEL = model_match.group(1).strip()

    # Extract code blocks (``` delimited) in order:
    #   1st = system prompt, 2nd = user message template
    code_blocks = re.findall(r'```(?:\w*)\n(.*?)```', text, re.DOTALL)
    if len(code_blocks) < 2:
        logger.error(f"Expected at least 2 code blocks in prompt file, found {len(code_blocks)}")
        sys.exit(1)

    SYSTEM_PROMPT = code_blocks[0].strip()

    # Make user message template compatible with str.format():
    # Escape all literal braces, then restore known placeholders.
    raw_template = code_blocks[1].strip()
    TEMPLATE_PLACEHOLDERS = [
        'brand_name', 'fanciful_name', 'class_type_code', 'origin_code',
        'alcohol_content', 'total_bottle_capacity', 'grape_varietal',
        'wine_vintage', 'appellation', 'company_name', 'state', 'formula',
        'front_label_ocr', 'back_label_ocr',
        'ocr_abv', 'ocr_volume_ml', 'ocr_proof', 'ocr_age_years', 'ocr_website',
        'valid_subcategories',
    ]
    raw_template = raw_template.replace('{', '{{').replace('}', '}}')
    for name in TEMPLATE_PLACEHOLDERS:
        raw_template = raw_template.replace('{{' + name + '}}', '{' + name + '}')
    USER_MSG_TEMPLATE = raw_template

    # Load valid subcategories from TAXONOMY.md if available
    if TAXONOMY_FILE.exists():
        tax_text = TAXONOMY_FILE.read_text(encoding='utf-8')
        subcats = []
        for line in tax_text.split('\n'):
            # Stop at guidance/notes sections — subcategories are only in
            # SPIRITS, WINE, and BEER & FMB sections
            if line.startswith('## CLASSIFICATION') or line.startswith('## REVISION'):
                break
            # Subcategory lines: "- Name" but NOT bold items "- **...**"
            m = re.match(r'^-\s+([^*].+)$', line.strip())
            if m:
                name = m.group(1).strip()
                if name:
                    subcats.append(name)
        if subcats:
            VALID_SUBCATEGORIES = ', '.join(subcats)
            logger.info(f"Loaded {len(subcats)} subcategories from TAXONOMY.md")

    # Fallback: extract from the user message template's VALID SUBCATEGORIES placeholder
    if not VALID_SUBCATEGORIES:
        subcat_match = re.search(
            r'## VALID SUBCATEGORIES\s*\n\[.*?\]',
            USER_MSG_TEMPLATE
        )
        if subcat_match:
            logger.warning("Using placeholder subcategories from prompt file — "
                          "TAXONOMY.md not found or empty")

    logger.info(f"Loaded prompt v{PROMPT_VERSION}, model {MODEL} from {PROMPT_FILE.name}")


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
        f"ORDER BY c.year DESC, c.month DESC, c.day DESC "
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
            f"WHERE ttb_id = {escape_sql_value(ttb_id)} AND download_status = 'success' "
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
    """Build prompt and call Claude for one COLA.

    Returns (parsed_json, input_tokens, output_tokens) on success,
    or (None, 0, 0) on failure. Does not mutate any shared state.
    """
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
        usage = response.usage
        return result, usage.input_tokens, usage.output_tokens

    except json.JSONDecodeError as e:
        logger.error(f"  JSON parse error: {e}")
        logger.error(f"  Raw response: {raw_text[:500]}")
        return None, 0, 0
    except Exception as e:
        logger.error(f"  Claude API error: {e}")
        return None, 0, 0


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

def run_enrichment(colas, dry_run=False, max_workers=5):
    """Enrich COLAs concurrently using a thread pool."""
    total = len(colas)

    # Shared state protected by lock
    lock = threading.Lock()
    counters = {
        'enriched': 0, 'failed': 0,
        'inferred_nulled': 0, 'unverifiable_nulled': 0,
        'total_input_tokens': 0, 'total_output_tokens': 0,
        'progress': 0,
    }
    category_counts = {}
    confidence_counts = {'high': 0, 'medium': 0, 'low': 0}
    printed_spirits = [False]  # list so nested fn can mutate
    printed_wine = [False]

    ALLOWED_INFERRED = {'super_category', 'commercial_category', 'subcategory',
                        'confidence', 'taxonomy_feedback', 'field_sources'}
    BOOLEAN_EVIDENCE = {
        'is_cask_strength': ['cask strength', 'barrel proof', 'barrel strength', 'full proof'],
        'is_single_barrel': ['single barrel', 'single cask'],
        'is_limited_release': ['limited release', 'limited edition', 'special release',
                               'small batch', 'reserve', 'allocated'],
        'is_organic': ['organic', 'usda organic', 'certified organic'],
        'is_gluten_free': ['gluten free', 'gluten-free'],
    }

    def worker(cola):
        """Process one COLA: call Claude → post-process → write D1."""
        ttb_id = cola['ttb_id']
        brand = cola.get('brand_name') or '(unknown)'
        fanciful = cola.get('fanciful_name') or ''
        img_count = cola.get('_image_count', 0)
        label = f"{brand}"
        if fanciful:
            label += f" \u2014 {fanciful}"

        with lock:
            counters['progress'] += 1
            idx = counters['progress']

        logger.info(f"[{idx}/{total}] {ttb_id}: {label} ({img_count} images)")

        # Call Claude
        result, in_tokens, out_tokens = call_claude(cola)

        if result is None:
            with lock:
                counters['failed'] += 1
                counters['total_input_tokens'] += in_tokens
                counters['total_output_tokens'] += out_tokens
            logger.error(f"  FAILED — no valid response for {ttb_id}")
            return

        # Extract only known fields
        enrichment = {}
        for field in ENRICHMENT_FIELDS:
            if field in result:
                enrichment[field] = result[field]

        # Post-processing layer 1: null inferred fields
        local_inferred = 0
        sources = enrichment.get('field_sources') or {}
        if isinstance(sources, dict):
            for field_name, source in sources.items():
                if source == 'inferred' and field_name not in ALLOWED_INFERRED:
                    if enrichment.get(field_name) is not None:
                        logger.warning(f"  NULLED inferred field: {field_name}={enrichment[field_name]!r}")
                        enrichment[field_name] = None
                        local_inferred += 1

        # Post-processing layer 2: source verification
        local_unverifiable = 0
        corpus = build_source_corpus(cola)
        for field_name in VERIFIABLE_FIELDS:
            val = enrichment.get(field_name)
            if val is not None and not value_in_corpus(val, corpus):
                logger.warning(f"  NULLED unverifiable field: {field_name}={val!r}")
                enrichment[field_name] = None
                local_unverifiable += 1

        # Post-processing layer 3: boolean evidence checks
        for field_name, evidence_terms in BOOLEAN_EVIDENCE.items():
            val = enrichment.get(field_name)
            if val is True:
                if not any(term in corpus for term in evidence_terms):
                    logger.warning(f"  NULLED unverifiable boolean: {field_name}=True")
                    enrichment[field_name] = None
                    local_unverifiable += 1
            elif val is False:
                if not any(term in corpus for term in evidence_terms):
                    enrichment[field_name] = None

        # Validate required fields
        sc = enrichment.get('super_category')
        cc = enrichment.get('commercial_category')
        sub = enrichment.get('subcategory')
        conf = enrichment.get('confidence', 'unknown')

        if not sc or not cc or not sub:
            with lock:
                counters['failed'] += 1
                counters['inferred_nulled'] += local_inferred
                counters['unverifiable_nulled'] += local_unverifiable
                counters['total_input_tokens'] += in_tokens
                counters['total_output_tokens'] += out_tokens
            logger.error(f"  FAILED — missing required category fields for {ttb_id}")
            logger.error(f"  Got: super={sc}, cat={cc}, sub={sub}")
            return

        # Verbose output for first spirits/wine example
        divider = '\u2500' * 60
        with lock:
            if not printed_spirits[0] and sc == 'Spirits':
                print(f"\n{divider}")
                print(f"FULL RESPONSE \u2014 {ttb_id}: {label}")
                print(divider)
                print(json.dumps(result, indent=2, ensure_ascii=False))
                print(divider)
                printed_spirits[0] = True
            elif not printed_wine[0] and sc == 'Wine':
                print(f"\n{divider}")
                print(f"FULL RESPONSE \u2014 {ttb_id}: {label}")
                print(divider)
                print(json.dumps(result, indent=2, ensure_ascii=False))
                print(divider)
                printed_wine[0] = True

        logger.info(f"  {sc} > {cc} > {sub} [{conf}]")

        # Write to D1
        if not dry_run:
            update_result = update_cola_enrichment(ttb_id, enrichment)
            if not update_result.get('success'):
                logger.error(f"  D1 update failed for {ttb_id}")
                with lock:
                    counters['failed'] += 1
                    counters['total_input_tokens'] += in_tokens
                    counters['total_output_tokens'] += out_tokens
                return

        # Aggregate counters
        with lock:
            counters['enriched'] += 1
            counters['inferred_nulled'] += local_inferred
            counters['unverifiable_nulled'] += local_unverifiable
            counters['total_input_tokens'] += in_tokens
            counters['total_output_tokens'] += out_tokens
            category_counts[cc] = category_counts.get(cc, 0) + 1
            if conf in confidence_counts:
                confidence_counts[conf] += 1

    # --- Run the thread pool ---
    logger.info(f"Starting enrichment: {total} COLAs, {max_workers} workers")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(worker, cola): cola for cola in colas}
        for future in as_completed(futures):
            exc = future.exception()
            if exc:
                cola = futures[future]
                logger.error(f"  Unexpected error for {cola['ttb_id']}: {exc}")
                with lock:
                    counters['failed'] += 1

    # --- Summary ---
    enriched = counters['enriched']
    failed = counters['failed']
    inferred_nulled = counters['inferred_nulled']
    unverifiable_nulled = counters['unverifiable_nulled']
    input_t = counters['total_input_tokens']
    output_t = counters['total_output_tokens']

    print(f"\n{'='*60}")
    print(f"ENRICHMENT SUMMARY")
    print(f"{'='*60}")
    print(f"COLAs processed:    {enriched + failed}")
    print(f"Enriched:           {enriched}")
    print(f"Failed:             {failed}")
    if inferred_nulled:
        print(f"Inferred\u2192null:      {inferred_nulled}")
    if unverifiable_nulled:
        print(f"Unverifiable\u2192null:  {unverifiable_nulled}")
    if confidence_counts['high'] or confidence_counts['medium'] or confidence_counts['low']:
        print(f"\nConfidence:")
        for level in ['high', 'medium', 'low']:
            if confidence_counts[level]:
                print(f"  {level:8s}: {confidence_counts[level]}")
    if category_counts:
        print(f"\nCategories:")
        for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
            print(f"  {cat:30s}: {count}")
    if input_t:
        # Haiku 4.5 pricing: $0.80/MTok input, $4/MTok output
        cost = (input_t * 0.80 + output_t * 4) / 1_000_000
        print(f"\nToken usage:")
        print(f"  Input:  {input_t:,}")
        print(f"  Output: {output_t:,}")
        print(f"  Est. cost: ${cost:.4f}")
    if dry_run:
        print(f"\n[DRY RUN \u2014 nothing written to D1]")
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
  python scripts/run_enrichment.py --limit 50
  python scripts/run_enrichment.py --limit 50 --workers 10
  python scripts/run_enrichment.py --dry-run --limit 10
        """
    )
    parser.add_argument('--limit', type=int, default=5,
                        help='Max COLAs to enrich (default: 5)')
    parser.add_argument('--workers', type=int, default=5,
                        help='Parallel Claude API workers (default: 5)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Call Claude but don\'t write to D1')
    args = parser.parse_args()

    # Fix Windows Unicode issues
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    load_env()
    load_prompt()
    init_d1()
    init_claude()

    colas = get_colas_needing_enrichment(args.limit)
    if not colas:
        logger.info("No COLAs to enrich")
        return

    run_enrichment(colas, dry_run=args.dry_run, max_workers=args.workers)


if __name__ == '__main__':
    main()
