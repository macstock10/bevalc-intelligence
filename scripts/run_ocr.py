"""
run_ocr.py — OCR label images from R2 using Google Cloud Vision API

Downloads images from R2, sends to Vision API (DOCUMENT_TEXT_DETECTION),
extracts structured fields via regex, and updates D1 with results.

USAGE:
    # OCR up to 50 images
    python scripts/run_ocr.py --limit 50

    # Dry run — OCR but don't update D1
    python scripts/run_ocr.py --dry-run --limit 20

    # Re-OCR images that previously failed
    python scripts/run_ocr.py --retry-failed --limit 50

SETUP:
    pip install google-cloud-vision boto3 requests

    # .env must contain:
    #   GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account.json
    #   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
    #   CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY
"""

import os
import re
import sys
import io
import argparse
import logging
from pathlib import Path

import requests as http_requests
import boto3
from botocore.config import Config
from PIL import Image
from google.cloud import vision


SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"


# =============================================================================
# Logging
# =============================================================================

logger = logging.getLogger("run_ocr")
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
# R2 client (read-only — downloading images)
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
    logger.info(f"R2 bucket: {bucket}")


def download_from_r2(r2_key):
    """Download image bytes from R2. Returns bytes or None."""
    try:
        resp = _r2['client'].get_object(Bucket=_r2['bucket'], Key=r2_key)
        return resp['Body'].read()
    except Exception as e:
        logger.error(f"  R2 download failed for {r2_key}: {e}")
        return None


# =============================================================================
# Google Cloud Vision OCR
# =============================================================================

_vision_client = None


def init_vision():
    global _vision_client

    # Support GOOGLE_APPLICATION_CREDENTIALS_JSON env var (GitHub Actions):
    # write the JSON string to a temp file and point the SDK at it.
    json_creds = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON', '')
    if json_creds and not os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        import tempfile
        tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
        tmp.write(json_creds)
        tmp.close()
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = tmp.name
        logger.info(f"Wrote GCP credentials to temp file: {tmp.name}")

    creds_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '')

    # Resolve relative path against project root
    if creds_path and not os.path.isabs(creds_path):
        creds_path = str(BASE_DIR / creds_path)
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = creds_path

    if not creds_path or not os.path.exists(creds_path):
        logger.error(
            f"GOOGLE_APPLICATION_CREDENTIALS not found at: {creds_path}\n"
            f"  Download your service account JSON from Google Cloud Console:\n"
            f"  https://console.cloud.google.com/iam-admin/serviceaccounts\n"
            f"  Place it in the project root and set the path in .env"
        )
        sys.exit(1)

    _vision_client = vision.ImageAnnotatorClient()
    logger.info(f"Vision API initialized (credentials: {os.path.basename(creds_path)})")


MAX_VISION_DIMENSION = 4096  # Vision API max recommended dimension


def resize_for_vision(image_bytes):
    """Resize image if either dimension exceeds MAX_VISION_DIMENSION.

    Returns (possibly resized) image bytes as PNG. Returns original bytes
    if already within limits or if Pillow can't open the image.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception:
        return image_bytes

    w, h = img.size
    if w <= MAX_VISION_DIMENSION and h <= MAX_VISION_DIMENSION:
        return image_bytes

    scale = min(MAX_VISION_DIMENSION / w, MAX_VISION_DIMENSION / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    logger.info(f"  Resizing {w}x{h} -> {new_w}x{new_h} for Vision API")

    img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def ocr_image(image_bytes):
    """Run DOCUMENT_TEXT_DETECTION on image bytes. Returns full text or None."""
    image_bytes = resize_for_vision(image_bytes)
    image = vision.Image(content=image_bytes)

    response = _vision_client.document_text_detection(image=image)

    if response.error.message:
        logger.warning(f"  Vision API error: {response.error.message}")
        return None

    annotation = response.full_text_annotation
    if not annotation or not annotation.text:
        return None

    return annotation.text.strip()


# =============================================================================
# Regex extraction from OCR text
# =============================================================================

def extract_abv(text):
    """Extract ABV percentage from OCR text."""
    # Match patterns like "40% ALC/VOL", "40% ABV", "40% ALC BY VOL",
    # "ALC 40% BY VOL", "ALCOHOL 40% BY VOLUME", "40.5% alc./vol."
    patterns = [
        r'(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:alc(?:ohol)?[\s./]*(?:by\s*)?vol(?:ume)?|abv)',
        r'(?:alc(?:ohol)?[\s./]*)\s*(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:by\s*vol(?:ume)?)?',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            val = float(match.group(1))
            if 0.5 <= val <= 100:
                return val
    return None


def extract_volume_ml(text):
    """Extract volume in mL from OCR text."""
    # Direct mL: "750ML", "750 ML", "750ml"
    match = re.search(r'(\d{2,4})\s*ml\b', text, re.IGNORECASE)
    if match:
        val = int(match.group(1))
        if 50 <= val <= 5000:
            return val

    # Liters: "1.75L", "750L" (actually mL when small), "1 LITER"
    match = re.search(r'(\d{1,2}(?:\.\d{1,3})?)\s*(?:liter|litre|l)\b', text, re.IGNORECASE)
    if match:
        val = float(match.group(1))
        if val < 20:  # Likely liters, convert to mL
            return int(val * 1000)

    # Fluid ounces: "12 FL OZ", "25.4 FL. OZ."
    match = re.search(r'(\d{1,3}(?:\.\d{1,2})?)\s*fl\.?\s*oz', text, re.IGNORECASE)
    if match:
        val = float(match.group(1))
        return int(val * 29.5735)

    return None


def extract_proof(text):
    """Extract proof from OCR text."""
    match = re.search(r'(\d{2,3})\s*proof\b', text, re.IGNORECASE)
    if match:
        val = int(match.group(1))
        if 1 <= val <= 200:
            return val
    return None


def extract_age_years(text):
    """Extract age statement in years from OCR text."""
    # "AGED 12 YEARS", "12 YEAR OLD", "12 YEARS OLD", "12 YR"
    patterns = [
        r'aged?\s+(\d{1,3})\s*(?:year|yr)',
        r'(\d{1,3})\s*(?:year|yr)s?\s*old',
        r'(\d{1,3})\s*(?:year|yr)s?\s*(?:aged|matured)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            val = int(match.group(1))
            if 1 <= val <= 100:
                return val
    return None


def extract_website(text):
    """Extract website URL from OCR text.

    Uses broad domain matching (any TLD) instead of a TLD whitelist.
    False positives are filtered by minimum domain length (4 chars) and
    a small skip set of beverage-label abbreviations.

    Also handles OCR artifacts where spaces are inserted into CamelCase
    domains, e.g. "Rams Gate Winery.com" → "ramsgatewinery.com"
    """
    # Beverage-label abbreviations that look like domains but aren't.
    # Kept intentionally small — the 4-char minimum domain length
    # already filters most FPs (alc.vol, fl.oz, co.uk, atl.ga, etc.)
    SKIP = {'vol.com', 'vol.net', 'net.cont', 'inc.com'}
    # Suffixes that appear on labels but aren't real TLDs
    SKIP_SUFFIXES = {'oz', 'vol', 'cont', 'agr', 'del'}

    # Broad match: 4+ char domain, 2+ char TLD — catches every real TLD
    # without maintaining a whitelist. The 4-char minimum eliminates
    # initials (l.lt, c.pannell) and short abbreviations (fl.oz, alc.vol).
    match = re.search(
        r'(?:https?://)?(?:www\.)?'
        r'([a-zA-Z0-9][-a-zA-Z0-9]{3,}\.[a-zA-Z]{2,})'
        r'(?:/[^\s,;)]*)?',
        text, re.IGNORECASE
    )
    if match:
        url = match.group(0).lower().rstrip('.')
        domain = match.group(1).lower()

        if domain in SKIP:
            return None
        tld = domain.rsplit('.', 1)[1]
        if tld in SKIP_SUFFIXES:
            return None

        # Check for OCR-split CamelCase: look for capitalized words
        # immediately before the match that are part of the domain name.
        # e.g. "Rams Gate Winery.com" → the regex matched "Winery.com"
        #       but "Rams Gate" are CamelCase fragments of the domain.
        start = match.start()
        prefix = text[:start]
        # Walk backwards through capitalized words (no punctuation between them)
        parts = []
        while prefix:
            prefix = prefix.rstrip()
            m = re.search(r'([A-Z][a-z0-9]*)$', prefix)
            if not m:
                break
            parts.append(m.group(1))
            prefix = prefix[:m.start()]
        if parts:
            parts.reverse()
            domain_prefix = ''.join(parts).lower()
            url_body = re.sub(r'^https?://', '', url)
            url = 'https://' + domain_prefix + url_body
        elif not url.startswith('http'):
            url = 'https://' + url

        return url

    return None


def extract_email(text):
    """Extract email address from OCR text."""
    match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
    if match:
        return match.group(0).lower()
    return None


def extract_phone(text):
    """Extract US phone number from OCR text."""
    # (555) 123-4567, 555-123-4567, 555.123.4567, 1-800-123-4567
    match = re.search(
        r'(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
        text
    )
    if match:
        digits = re.sub(r'\D', '', match.group(0))
        if len(digits) == 11 and digits[0] == '1':
            digits = digits[1:]
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return None


def extract_all_fields(text):
    """Run all regex extractors on OCR text. Returns dict of field values."""
    return {
        'ocr_abv': extract_abv(text),
        'ocr_volume_ml': extract_volume_ml(text),
        'ocr_proof': extract_proof(text),
        'ocr_age_years': extract_age_years(text),
        'ocr_website': extract_website(text),
        'ocr_email': extract_email(text),
        'ocr_phone': extract_phone(text),
    }


def compute_quality_score(ocr_text, fields):
    """Determine OCR quality score based on text length and field extraction."""
    if ocr_text is None:
        return 'failed'

    text_len = len(ocr_text)
    has_field = any(v is not None for v in fields.values())

    if text_len > 50 and has_field:
        return 'good'
    elif text_len > 20:
        return 'partial'
    else:
        return 'poor'


# =============================================================================
# D1 queries
# =============================================================================

def get_images_needing_ocr(limit, retry_failed=False):
    """Get cola_images rows that need OCR.

    Limit is applied to distinct COLAs (not individual images),
    so all images for a given COLA are processed together.
    Uses two simple queries to avoid D1 subquery complexity limits.
    """
    if retry_failed:
        where = "ci.download_status = 'success' AND ci.ocr_quality_score = 'failed'"
        desc = "previously failed"
    else:
        where = "ci.download_status = 'success' AND ci.ocr_text IS NULL AND ci.ocr_quality_score IS NULL"
        desc = "pending"

    logger.info(f"Querying D1 for up to {limit} {desc} COLAs...")

    # Step 1: Get the ttb_ids we need (simple query, 2026+ only)
    ttb_rows = d1_query_rows(
        f"SELECT ci.ttb_id FROM cola_images ci "
        f"JOIN colas c ON ci.ttb_id = c.ttb_id "
        f"WHERE {where} AND c.year >= 2026 "
        f"GROUP BY ci.ttb_id "
        f"ORDER BY c.year DESC, c.month DESC, c.day DESC "
        f"LIMIT {limit}"
    )
    ttb_ids = [r['ttb_id'] for r in ttb_rows]

    if not ttb_ids:
        logger.info("Found 0 images across 0 COLAs to OCR")
        return []

    # Step 2: Get all images for those COLAs (batch in chunks to stay under D1 limits)
    all_rows = []
    chunk_size = 50
    for i in range(0, len(ttb_ids), chunk_size):
        chunk = ttb_ids[i:i + chunk_size]
        id_list = ', '.join(f"'{t}'" for t in chunk)
        rows = d1_query_rows(
            f"SELECT ci.image_id, ci.ttb_id, ci.r2_key "
            f"FROM cola_images ci "
            f"WHERE {where} "
            f"AND ci.ttb_id IN ({id_list}) "
            f"ORDER BY ci.ttb_id, ci.image_id"
        )
        all_rows.extend(rows)

    distinct_colas = len(set(r['ttb_id'] for r in all_rows))
    logger.info(f"Found {len(all_rows)} images across {distinct_colas} COLAs to OCR")
    return all_rows


def update_ocr_result(image_id, ocr_text, fields, quality_score):
    """Update a cola_images row with OCR results."""
    sql = (
        f"UPDATE cola_images SET "
        f"ocr_text = {escape_sql_value(ocr_text)}, "
        f"ocr_abv = {escape_sql_value(fields['ocr_abv'])}, "
        f"ocr_volume_ml = {escape_sql_value(fields['ocr_volume_ml'])}, "
        f"ocr_proof = {escape_sql_value(fields['ocr_proof'])}, "
        f"ocr_age_years = {escape_sql_value(fields['ocr_age_years'])}, "
        f"ocr_website = {escape_sql_value(fields['ocr_website'])}, "
        f"ocr_email = {escape_sql_value(fields['ocr_email'])}, "
        f"ocr_phone = {escape_sql_value(fields['ocr_phone'])}, "
        f"ocr_quality_score = {escape_sql_value(quality_score)} "
        f"WHERE image_id = {escape_sql_value(image_id)};"
    )
    return d1_execute(sql)


# =============================================================================
# Main pipeline
# =============================================================================

def run_ocr(images, dry_run=False):
    """OCR each image: download from R2, send to Vision, extract fields, update D1."""
    good = 0
    partial = 0
    poor = 0
    failed = 0
    r2_errors = 0

    # Track extracted field counts
    field_counts = {
        'ocr_abv': 0, 'ocr_volume_ml': 0, 'ocr_proof': 0,
        'ocr_age_years': 0, 'ocr_website': 0, 'ocr_email': 0, 'ocr_phone': 0,
    }

    for idx, img in enumerate(images):
        image_id = img['image_id']
        ttb_id = img['ttb_id']
        r2_key = img['r2_key']

        logger.info(f"[{idx+1}/{len(images)}] {image_id} ({r2_key})")

        # Download from R2
        image_bytes = download_from_r2(r2_key)
        if image_bytes is None:
            r2_errors += 1
            failed += 1
            if not dry_run:
                update_ocr_result(image_id, None, extract_all_fields(''), 'failed')
            continue

        # OCR via Vision API
        try:
            ocr_text = ocr_image(image_bytes)
        except Exception as e:
            logger.warning(f"  Vision API exception: {e}")
            ocr_text = None

        # Extract fields
        fields = extract_all_fields(ocr_text or '')
        quality = compute_quality_score(ocr_text, fields)

        # Log result
        text_preview = (ocr_text[:80] + '...') if ocr_text and len(ocr_text) > 80 else (ocr_text or '(none)')
        text_preview = text_preview.replace('\n', ' ')
        logger.info(f"  [{quality}] {len(ocr_text or '')} chars: {text_preview}")

        extracted = [k.replace('ocr_', '') for k, v in fields.items() if v is not None]
        if extracted:
            logger.info(f"  Extracted: {', '.join(extracted)}")

        # Update stats
        if quality == 'good':
            good += 1
        elif quality == 'partial':
            partial += 1
        elif quality == 'poor':
            poor += 1
        else:
            failed += 1

        for k, v in fields.items():
            if v is not None:
                field_counts[k] += 1

        # Update D1
        if not dry_run:
            update_ocr_result(image_id, ocr_text, fields, quality)

        # Progress every 25 images
        if (idx + 1) % 25 == 0:
            logger.info(f"  --- Progress: {idx+1}/{len(images)} | "
                       f"good:{good} partial:{partial} poor:{poor} failed:{failed} ---")

    # Summary
    total = good + partial + poor + failed
    print(f"\n{'='*60}")
    print(f"OCR SUMMARY")
    print(f"{'='*60}")
    print(f"Images processed:     {total}")
    print(f"  good (>50 chars + fields):  {good}")
    print(f"  partial (>20 chars, no fields): {partial}")
    print(f"  poor (<20 chars):           {poor}")
    print(f"  failed (no text / error):   {failed}")
    if r2_errors:
        print(f"  R2 download errors:         {r2_errors}")
    print(f"\nField extraction:")
    for field, count in field_counts.items():
        name = field.replace('ocr_', '')
        pct = (count / total * 100) if total else 0
        print(f"  {name:12s}: {count:4d} ({pct:.0f}%)")
    if dry_run:
        print(f"\n[DRY RUN — nothing updated in D1]")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='OCR label images from R2 using Google Cloud Vision API',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/run_ocr.py --limit 50
  python scripts/run_ocr.py --dry-run --limit 10
  python scripts/run_ocr.py --retry-failed --limit 20
        """
    )
    parser.add_argument('--limit', type=int, default=50,
                        help='Max COLAs to OCR (default: 50)')
    parser.add_argument('--dry-run', action='store_true',
                        help='OCR images but don\'t update D1')
    parser.add_argument('--retry-failed', action='store_true',
                        help='Re-OCR images with quality_score = failed')
    args = parser.parse_args()

    load_env()
    init_d1()
    init_r2()
    init_vision()

    images = get_images_needing_ocr(args.limit, retry_failed=args.retry_failed)
    if not images:
        logger.info("No images to OCR")
        return

    run_ocr(images, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
