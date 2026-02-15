"""
backfill_images.py — Discover label image URLs and download to R2

Uses plain HTTP requests with session cookies (no Selenium needed).
Visits each COLA's TTB printable page, extracts image URLs via
BeautifulSoup, downloads image bytes using session cookies, and
uploads to Cloudflare R2.

USAGE:
    # Process 50 COLAs (discover URLs + download images)
    python scripts/backfill_images.py --limit 50

    # Dry run — fetch pages, show what would happen, don't write
    python scripts/backfill_images.py --dry-run --limit 20

    # Discover URLs only (no download/upload)
    python scripts/backfill_images.py --discover-only --limit 100

    # Re-download COLAs with failed images
    python scripts/backfill_images.py --retry-failed --limit 50

    # Specific ttb_ids
    python scripts/backfill_images.py --ttb-ids 26021001000664 24031001000777

    # Save images locally for inspection
    python scripts/backfill_images.py --save-to-disk --limit 10

REQUIREMENTS:
    - boto3 (R2 S3-compatible upload)
    - Pillow (image dimensions)
    - beautifulsoup4 (HTML parsing)
    - requests
    - CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN in .env
    - CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY in .env
"""

import os
import re
import sys
import io
import ssl
import base64
import time
import argparse
import logging
import tempfile
from pathlib import Path
from urllib.request import urlopen

import certifi
import requests as http_requests
import boto3
from botocore.config import Config
from PIL import Image
from bs4 import BeautifulSoup


# =============================================================================
# Paths and constants
# =============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
CHECKPOINT_FILE = DATA_DIR / "backfill_images_checkpoint.txt"

# Legacy checkpoint files from the old two-script workflow
LEGACY_CHECKPOINT_FILES = [
    DATA_DIR / "download_images_checkpoint.txt",
]

TTB_BASE = "https://ttbonline.gov/colasonline"
TTB_PRINTABLE_URL = f"{TTB_BASE}/viewColaDetails.do?action=publicFormDisplay&ttbid="

CORRUPT_THRESHOLD = 5 * 1024  # 5KB — images smaller than this are marked corrupt
MAX_RETRIES = 3
REQUEST_DELAY = 0.3   # seconds between image downloads within a COLA
COLA_DELAY = 1.0      # seconds between COLA page fetches

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

CONTENT_TYPE_MAP = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
    'webp': 'image/webp',
}

CAPTCHA_INDICATORS = ['captcha', 'what code is in the image', 'g-recaptcha']


# =============================================================================
# Logging
# =============================================================================

logger = logging.getLogger("backfill_images")
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
    """Execute SQL and return list of row dicts."""
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
# R2 client
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


def upload_to_r2(key, image_bytes, content_type):
    _r2['client'].put_object(
        Bucket=_r2['bucket'],
        Key=key,
        Body=image_bytes,
        ContentType=content_type,
        CacheControl='public, max-age=31536000'  # 1 year — images are immutable
    )


# =============================================================================
# Checkpoint (reads legacy files from old two-script workflow)
# =============================================================================

def load_checkpoint():
    """Load set of ttb_ids already processed from current + legacy checkpoint files."""
    completed = set()

    # Current checkpoint
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE, 'r') as f:
            completed.update(line.strip() for line in f if line.strip())

    # Legacy checkpoint files
    for legacy_file in LEGACY_CHECKPOINT_FILES:
        if legacy_file.exists():
            with open(legacy_file, 'r') as f:
                completed.update(line.strip() for line in f if line.strip())

    return completed


def save_checkpoint_entry(ttb_id):
    """Append a single ttb_id to the checkpoint file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, 'a') as f:
        f.write(ttb_id + '\n')


# =============================================================================
# SSL certificate handling
# =============================================================================

# TTB's server doesn't send the full certificate chain — the intermediate
# "Entrust OV TLS Issuing RSA CA 1" is missing. certifi has the root but
# not the intermediate. We fetch it at startup and create a combined bundle.
TTB_INTERMEDIATE_CERT_URL = 'http://cert.ssl.com/Entrust-OVTLS-I-R1.cer'

_ca_bundle_path = None  # Set by build_ca_bundle()


def build_ca_bundle():
    """Create a CA bundle with certifi certs + TTB's missing intermediate.

    Downloads the intermediate cert (DER), converts to PEM, and writes
    a combined bundle to a temp file. Returns the path.
    """
    global _ca_bundle_path

    try:
        # Download intermediate cert (DER format, ~1.6KB)
        resp = urlopen(TTB_INTERMEDIATE_CERT_URL, timeout=10)
        der_bytes = resp.read()

        # DER → PEM
        b64 = base64.b64encode(der_bytes).decode('ascii')
        pem_lines = ['-----BEGIN CERTIFICATE-----']
        for i in range(0, len(b64), 64):
            pem_lines.append(b64[i:i + 64])
        pem_lines.append('-----END CERTIFICATE-----')
        intermediate_pem = '\n'.join(pem_lines)

        # Combine certifi bundle + intermediate
        combined = tempfile.NamedTemporaryFile(
            mode='w', suffix='.pem', delete=False, prefix='bevalc_ca_'
        )
        with open(certifi.where(), 'r') as f:
            combined.write(f.read())
        combined.write('\n')
        combined.write(intermediate_pem)
        combined.write('\n')
        combined.close()

        _ca_bundle_path = combined.name
        logger.info(f"CA bundle: certifi + TTB intermediate cert ({len(der_bytes)} bytes)")
        return _ca_bundle_path

    except Exception as e:
        logger.warning(f"Could not fetch TTB intermediate cert: {e}")
        logger.warning("Falling back to certifi only (may cause SSL errors with TTB)")
        _ca_bundle_path = certifi.where()
        return _ca_bundle_path


# =============================================================================
# HTTP session + page/image fetching
# =============================================================================

def create_session():
    """Create an HTTP session with browser-like headers."""
    session = http_requests.Session()
    if _ca_bundle_path:
        session.verify = _ca_bundle_path
    session.headers.update({
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    })
    return session


def detect_captcha_in_html(html):
    """Check if HTML contains CAPTCHA indicators."""
    lower = html.lower()
    return any(ind in lower for ind in CAPTCHA_INDICATORS)


def fetch_cola_page(session, ttb_id):
    """Fetch a COLA's printable page via HTTP.

    Returns (html, status) where status is 'ok', 'captcha', or 'error'.
    html is None on failure.
    """
    url = TTB_PRINTABLE_URL + ttb_id
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code != 200:
                logger.warning(f"  HTTP {resp.status_code} (attempt {attempt + 1}/{MAX_RETRIES})")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                continue

            html = resp.text

            if detect_captcha_in_html(html):
                logger.warning(f"  CAPTCHA detected (attempt {attempt + 1}/{MAX_RETRIES})")
                if attempt < MAX_RETRIES - 1:
                    # Back off and create fresh session to get new cookies
                    time.sleep(10 * (attempt + 1))
                    session.cookies.clear()
                    continue
                return None, 'captcha'

            if 'Error Messages' in html and 'Unable to process request' in html:
                logger.warning(f"  TTB error page")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                    continue
                return None, 'error'

            return html, 'ok'

        except Exception as e:
            logger.warning(f"  Request error: {e.__class__.__name__} (attempt {attempt + 1}/{MAX_RETRIES})")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)

    return None, 'error'


def download_image_http(session, url):
    """Download image bytes via HTTP using session cookies.

    Returns (image_bytes, status) where status is one of:
        'success', 'failed', 'timeout', 'captcha'
    """
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, timeout=30)

            if resp.status_code != 200:
                if attempt < MAX_RETRIES - 1:
                    logger.info(f"    HTTP {resp.status_code} (attempt {attempt + 1}/{MAX_RETRIES})")
                    time.sleep(2 ** attempt)
                    continue
                return None, 'failed'

            content_type = resp.headers.get('Content-Type', '')

            # TTB returns HTML error page instead of image when session is invalid
            if 'html' in content_type.lower():
                if detect_captcha_in_html(resp.text):
                    return None, 'captcha'
                return None, 'failed'

            return resp.content, 'success'

        except http_requests.Timeout:
            if attempt < MAX_RETRIES - 1:
                logger.info(f"    Timeout (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(2 ** attempt)
                continue
            return None, 'timeout'
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                logger.info(f"    Error: {e} (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(2 ** attempt)
                continue
            return None, 'failed'

    return None, 'failed'


# =============================================================================
# Image URL extraction (from TTB printable page HTML)
# =============================================================================

IMAGE_TYPE_MAP = {
    'brand (front) or keg collar': 'front',
    'brand': 'front',
    'front': 'front',
    'back': 'back',
    'neck band or neck strip': 'neck',
    'neck': 'neck',
    'strip': 'strip',
}


def parse_label_type(text):
    text = text.strip().lower()
    if text in IMAGE_TYPE_MAP:
        return IMAGE_TYPE_MAP[text]
    for key, val in IMAGE_TYPE_MAP.items():
        if key in text:
            return val
    return 'other'


def extract_images_from_html(html, ttb_id):
    """Parse printable page HTML and extract image metadata.

    Returns list of image dicts with keys:
        ttb_id, image_id, label_type, ttb_original_url, width, height
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Parse label types from "Image Type:" markers
    image_type_list = []
    for p_tag in soup.find_all('p', class_='data'):
        if 'Image Type' not in p_tag.get_text():
            continue
        type_text = ''
        for sibling in p_tag.next_siblings:
            if isinstance(sibling, str):
                stripped = sibling.strip()
                if stripped:
                    type_text = stripped
                    break
            elif sibling.name == 'br':
                continue
            else:
                break
        image_type_list.append(parse_label_type(type_text))

    # Collect all attachment images
    img_tags = soup.find_all('img', src=re.compile(r'publicViewAttachment'))
    images = []

    for i, img in enumerate(img_tags):
        src = img.get('src', '')
        alt = img.get('alt', '')
        seq = i + 1

        # Label type from HTML text, fallback to alt
        if i < len(image_type_list):
            label_type = image_type_list[i]
        else:
            label_type = parse_label_type(alt.replace('Label Image:', '').strip())

        # Build full TTB URL
        ttb_original_url = f"https://ttbonline.gov{src}" if not src.startswith('http') else src

        # Pixel dimensions from img tag attributes
        px_width = img.get('width')
        px_height = img.get('height')
        if px_width:
            try:
                px_width = int(px_width)
            except ValueError:
                px_width = None
        if px_height:
            try:
                px_height = int(px_height)
            except ValueError:
                px_height = None

        images.append({
            'ttb_id': ttb_id,
            'image_id': f"{ttb_id}-{seq}",
            'label_type': label_type,
            'ttb_original_url': ttb_original_url,
            'width': px_width,
            'height': px_height,
        })

    return images


def get_extension(url):
    """Extract file extension from TTB image URL."""
    match = re.search(r'filename=([^&]+)', url)
    if match:
        filename = match.group(1)
        if '.' in filename:
            return filename.rsplit('.', 1)[-1].lower()
    return 'jpg'


def get_image_dimensions(image_bytes):
    """Get width and height from image bytes using Pillow."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        return img.width, img.height
    except Exception:
        return None, None


# =============================================================================
# D1 write operations
# =============================================================================

def insert_images_to_d1(images):
    """Insert image records into D1 cola_images table. Returns number inserted."""
    if not images:
        return 0

    statements = []
    for img in images:
        statements.append(
            f"INSERT OR IGNORE INTO cola_images "
            f"(ttb_id, image_id, label_type, ttb_original_url, width, height) "
            f"VALUES ("
            f"{escape_sql_value(img['ttb_id'])}, "
            f"{escape_sql_value(img['image_id'])}, "
            f"{escape_sql_value(img['label_type'])}, "
            f"{escape_sql_value(img['ttb_original_url'])}, "
            f"{escape_sql_value(img['width'])}, "
            f"{escape_sql_value(img['height'])}"
            f");"
        )

    sql = '\n'.join(statements)
    result = d1_execute(sql)

    if result.get("success"):
        total = 0
        for res in result.get("result", []):
            total += res.get("meta", {}).get("changes", 0)
        return total
    return 0


def update_image_row(image_id, r2_key, file_size, width, height, download_status):
    """Update a cola_images row with download results."""
    sql = (
        f"UPDATE cola_images SET "
        f"r2_key = {escape_sql_value(r2_key)}, "
        f"file_size = {escape_sql_value(file_size)}, "
        f"width = {escape_sql_value(width)}, "
        f"height = {escape_sql_value(height)}, "
        f"download_status = {escape_sql_value(download_status)} "
        f"WHERE image_id = {escape_sql_value(image_id)};"
    )
    return d1_execute(sql)


def get_pending_images_for_cola(ttb_id):
    """Get images for a COLA that still need downloading."""
    return d1_query_rows(
        f"SELECT image_id, ttb_id, ttb_original_url, download_status "
        f"FROM cola_images WHERE ttb_id = {escape_sql_value(ttb_id)} "
        f"AND (download_status IS NULL OR download_status NOT IN ('success'))"
    )


# =============================================================================
# D1 queries for COLA discovery
# =============================================================================

def get_colas_needing_processing(limit, checkpoint, retry_failed=False):
    """Get ttb_ids that need image processing, excluding checkpointed.

    Default mode: Union of Population A (no cola_images rows) and
    Population B (have rows but download_status IS NULL).

    --retry-failed mode: Population C (failed/timeout/captcha downloads).
    """
    if retry_failed:
        logger.info(f"Querying D1 for up to {limit} COLAs with failed images...")
        rows = d1_query_rows(
            f"SELECT DISTINCT ttb_id FROM cola_images "
            f"WHERE download_status IN ('failed', 'timeout', 'captcha') "
            f"ORDER BY ttb_id DESC "
            f"LIMIT {limit}"
        )
        ttb_ids = [r['ttb_id'] for r in rows]
    else:
        # Population A: COLAs with no cola_images rows at all
        logger.info(f"Querying D1 for COLAs missing image data...")
        rows_a = d1_query_rows(
            f"SELECT c.ttb_id FROM colas c "
            f"LEFT JOIN cola_images ci ON c.ttb_id = ci.ttb_id "
            f"WHERE ci.ttb_id IS NULL "
            f"ORDER BY c.approval_date DESC "
            f"LIMIT {limit}"
        )
        pop_a = [r['ttb_id'] for r in rows_a]
        logger.info(f"  Population A (no rows): {len(pop_a)}")

        # Population B: COLAs with rows but pending downloads
        remaining = limit - len(pop_a)
        pop_b = []
        if remaining > 0:
            rows_b = d1_query_rows(
                f"SELECT DISTINCT ttb_id FROM cola_images "
                f"WHERE download_status IS NULL "
                f"ORDER BY ttb_id DESC "
                f"LIMIT {remaining}"
            )
            pop_b = [r['ttb_id'] for r in rows_b]
            logger.info(f"  Population B (pending download): {len(pop_b)}")

        # Merge, dedup, preserve order (A first, then B)
        seen = set()
        ttb_ids = []
        for t in pop_a + pop_b:
            if t not in seen:
                seen.add(t)
                ttb_ids.append(t)

    # Filter out checkpointed
    before = len(ttb_ids)
    ttb_ids = [t for t in ttb_ids if t not in checkpoint]
    skipped = before - len(ttb_ids)
    if skipped:
        logger.info(f"  Skipped {skipped} already-checkpointed COLAs")

    logger.info(f"Total COLAs to process: {len(ttb_ids)}")
    return ttb_ids


def get_total_cola_count():
    """Total distinct COLAs in cola_images."""
    rows = d1_query_rows("SELECT COUNT(DISTINCT ttb_id) as cnt FROM cola_images")
    return rows[0]['cnt'] if rows else 0


def get_completed_cola_count():
    """COLAs where every image has download_status = 'success'."""
    rows = d1_query_rows(
        "SELECT COUNT(*) as cnt FROM ("
        "  SELECT ttb_id FROM cola_images GROUP BY ttb_id "
        "  HAVING SUM(CASE WHEN download_status IS NULL OR download_status != 'success' THEN 1 ELSE 0 END) = 0"
        ")"
    )
    return rows[0]['cnt'] if rows else 0


# =============================================================================
# Main pipeline
# =============================================================================

def process_colas(ttb_ids, dry_run=False, save_to_disk=False, discover_only=False):
    """Main pipeline: discover URLs + download images for each COLA via HTTP."""

    session = create_session()
    logger.info("HTTP session created (no browser needed)")

    # Stats
    colas_complete = 0
    colas_partial = 0
    colas_nav_failed = 0
    captcha_count = 0
    urls_discovered = 0
    urls_inserted = 0
    images_downloaded = 0
    images_uploaded = 0
    images_failed = 0
    images_corrupt = 0
    images_skipped = 0
    total_bytes = 0
    disk_counter = 0

    try:
        for cola_idx, ttb_id in enumerate(ttb_ids):
            logger.info(f"[{cola_idx+1}/{len(ttb_ids)}] {ttb_id}")

            # Step 1: Fetch COLA's printable page via HTTP
            html, fetch_status = fetch_cola_page(session, ttb_id)
            if html is None:
                colas_nav_failed += 1
                if fetch_status == 'captcha':
                    captcha_count += 1
                    logger.warning(f"  CAPTCHA — backing off")
                    time.sleep(COLA_DELAY * 10)
                else:
                    logger.warning(f"  Fetch failed — skipping (will retry next run)")
                    time.sleep(COLA_DELAY * 3)
                continue

            # Step 2: Parse HTML for image URLs
            discovered = extract_images_from_html(html, ttb_id)
            urls_discovered += len(discovered)

            if not discovered:
                logger.info(f"  No images on page")
                if not dry_run:
                    save_checkpoint_entry(ttb_id)
                colas_complete += 1
                time.sleep(COLA_DELAY)
                continue

            logger.info(f"  Found {len(discovered)} image(s):")
            for img in discovered:
                logger.info(f"    {img['image_id']} | {img['label_type']}")

            # Step 3: INSERT OR IGNORE into cola_images
            if not dry_run:
                inserted = insert_images_to_d1(discovered)
                urls_inserted += inserted
                if inserted > 0:
                    logger.info(f"  Inserted {inserted} new image row(s)")
            else:
                urls_inserted += len(discovered)

            # If discover-only mode, checkpoint and move on
            if discover_only:
                if not dry_run:
                    save_checkpoint_entry(ttb_id)
                colas_complete += 1
                time.sleep(COLA_DELAY)
                continue

            # Step 4: Get pending images for download
            if not dry_run:
                pending = get_pending_images_for_cola(ttb_id)
            else:
                pending = [{'image_id': img['image_id'], 'ttb_id': img['ttb_id'],
                            'ttb_original_url': img['ttb_original_url'],
                            'download_status': None} for img in discovered]

            if not pending:
                logger.info(f"  All images already downloaded")
                if not dry_run:
                    save_checkpoint_entry(ttb_id)
                colas_complete += 1
                images_skipped += len(discovered)
                time.sleep(COLA_DELAY)
                continue

            logger.info(f"  Downloading {len(pending)} image(s)...")

            # Step 5: Download each pending image via HTTP
            cola_all_ok = True

            for img_idx, img in enumerate(pending):
                image_id = img['image_id']
                url = img['ttb_original_url']

                logger.info(f"  [{img_idx+1}/{len(pending)}] {image_id}")

                image_bytes, status = download_image_http(session, url)

                # Session expired — re-fetch page to refresh cookies and retry
                if status == 'captcha' or (status == 'failed' and image_bytes is None):
                    logger.info(f"    Session issue — refreshing cookies...")
                    session.cookies.clear()
                    re_html, _ = fetch_cola_page(session, ttb_id)
                    if re_html is not None:
                        image_bytes, status = download_image_http(session, url)

                if image_bytes is None:
                    cola_all_ok = False
                    images_failed += 1
                    logger.warning(f"    {status}")
                    if not dry_run:
                        update_image_row(image_id, None, None, None, None, status)
                    continue

                images_downloaded += 1
                file_size = len(image_bytes)
                total_bytes += file_size

                # Save to disk for visual inspection
                if save_to_disk:
                    disk_counter += 1
                    ext_disk = get_extension(url)
                    disk_path = DATA_DIR / f"test_{disk_counter}.{ext_disk}"
                    disk_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(disk_path, 'wb') as f:
                        f.write(image_bytes)
                    logger.info(f"    Saved to {disk_path}")

                # Corrupt check
                if file_size < CORRUPT_THRESHOLD:
                    cola_all_ok = False
                    images_corrupt += 1
                    logger.warning(f"    Corrupt — {file_size:,} bytes (< {CORRUPT_THRESHOLD:,})")
                    if not dry_run:
                        update_image_row(image_id, None, file_size, None, None, 'corrupt')
                    continue

                # Dimensions
                width, height = get_image_dimensions(image_bytes)
                dim_str = f"{width}x{height}" if width else "unknown"

                # R2 key
                ext = get_extension(url)
                r2_key = f"labels/{ttb_id}/{image_id}.{ext}"
                content_type = CONTENT_TYPE_MAP.get(ext, 'image/jpeg')

                logger.info(f"    {file_size:,} bytes | {dim_str} | {ext} → {r2_key}")

                if not dry_run:
                    try:
                        upload_to_r2(r2_key, image_bytes, content_type)
                        update_image_row(image_id, r2_key, file_size, width, height, 'success')
                        images_uploaded += 1
                    except Exception as e:
                        cola_all_ok = False
                        logger.error(f"    R2 upload failed: {e}")
                        update_image_row(image_id, None, file_size, width, height, 'failed')
                        images_failed += 1
                else:
                    images_uploaded += 1  # Would have uploaded

                time.sleep(REQUEST_DELAY)

            # Checkpoint: only if ALL images for this COLA succeeded
            if cola_all_ok:
                colas_complete += 1
                if not dry_run:
                    save_checkpoint_entry(ttb_id)
                logger.info(f"  [OK] COLA complete")
            else:
                colas_partial += 1
                logger.warning(f"  [PARTIAL] Some images failed — will retry next run")

            # Progress every 10 COLAs
            if (cola_idx + 1) % 10 == 0:
                mb = total_bytes / (1024 * 1024)
                logger.info(f"  --- Progress: {cola_idx+1}/{len(ttb_ids)} COLAs | "
                           f"{urls_discovered} URLs, {images_uploaded} uploaded, "
                           f"{images_failed} failed | {mb:.1f} MB ---")

            # Delay between COLAs
            if cola_idx < len(ttb_ids) - 1:
                time.sleep(COLA_DELAY)

    except KeyboardInterrupt:
        logger.info("\nInterrupted by user")

    # Overall progress from D1
    total_colas_in_db = get_total_cola_count()
    completed_colas_in_db = get_completed_cola_count() if not dry_run else '?'

    # Summary
    mb = total_bytes / (1024 * 1024)
    print(f"\n{'='*60}")
    print(f"BACKFILL SUMMARY")
    print(f"{'='*60}")
    print(f"COLAs processed:       {len(ttb_ids)}")
    print(f"COLAs complete:        {colas_complete}")
    print(f"COLAs fetch failed:    {colas_nav_failed}")
    print(f"COLAs partial:         {colas_partial}")
    print(f"URLs discovered:       {urls_discovered}")
    if not discover_only:
        print(f"Images downloaded:     {images_downloaded}")
        print(f"Images uploaded:       {images_uploaded}")
        print(f"Images failed:         {images_failed}")
        print(f"Images corrupt (<5KB): {images_corrupt}")
        print(f"Images skipped:        {images_skipped}")
        print(f"Total downloaded:      {mb:.1f} MB")
        if images_downloaded:
            avg_kb = (total_bytes / images_downloaded) / 1024
            print(f"Avg file size:         {avg_kb:.0f} KB")
    if captcha_count:
        print(f"CAPTCHA blocks:        {captcha_count}")
    else:
        print(f"CAPTCHA:               none encountered")
    print(f"{'='*60}")
    if not discover_only:
        print(f"Overall: {completed_colas_in_db}/{total_colas_in_db:,} COLAs fully downloaded")
    if dry_run:
        print(f"[DRY RUN — nothing written to D1, R2, or checkpoint]")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Discover label image URLs from TTB and download to R2',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process 50 COLAs (discover URLs + download images)
  python scripts/backfill_images.py --limit 50

  # Dry run — show what would happen without writing
  python scripts/backfill_images.py --dry-run --limit 20

  # Discover URLs only (no download/upload)
  python scripts/backfill_images.py --discover-only --limit 100

  # Re-download COLAs with failed images
  python scripts/backfill_images.py --retry-failed --limit 50

  # Process specific ttb_ids
  python scripts/backfill_images.py --ttb-ids 26021001000664 24031001000777

  # Save images to disk for inspection
  python scripts/backfill_images.py --save-to-disk --limit 10
        """
    )
    parser.add_argument('--limit', type=int, default=50,
                        help='Max COLAs to process (default: 50)')
    parser.add_argument('--ttb-ids', nargs='+',
                        help='Specific ttb_ids to process (skips D1 lookup)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Discover + download without writing to D1, R2, or checkpoint')
    parser.add_argument('--retry-failed', action='store_true',
                        help='Re-download COLAs with failed/timeout/captcha images')
    parser.add_argument('--discover-only', action='store_true',
                        help='Only discover image URLs, do not download or upload')
    parser.add_argument('--save-to-disk', action='store_true',
                        help='Save each downloaded image to data/test_N.ext for inspection')
    # Keep --headless for backwards compatibility but it's now a no-op
    parser.add_argument('--headless', action='store_true',
                        help='(No-op, kept for backwards compatibility)')
    args = parser.parse_args()

    load_env()
    build_ca_bundle()
    init_d1()

    if not args.discover_only:
        init_r2()

    if args.ttb_ids:
        ttb_ids = args.ttb_ids
        logger.info(f"Using {len(ttb_ids)} ttb_ids from command line")
    else:
        checkpoint = load_checkpoint()
        if checkpoint:
            logger.info(f"Checkpoint: {len(checkpoint)} COLAs already completed")
        ttb_ids = get_colas_needing_processing(args.limit, checkpoint,
                                                retry_failed=args.retry_failed)

    if not ttb_ids:
        logger.info("No COLAs to process")
        return

    process_colas(ttb_ids, dry_run=args.dry_run,
                  save_to_disk=args.save_to_disk, discover_only=args.discover_only)


if __name__ == '__main__':
    main()
