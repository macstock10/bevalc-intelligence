"""
download_images_to_r2.py — Download label images from TTB and store in Cloudflare R2

Uses Selenium to download images through the browser's network stack
(TTB requires a real browser session, plain HTTP requests get blocked).

TTB's publicViewAttachment.do servlet is SESSION-BOUND: it only serves
images for the COLA whose printable page is currently loaded. So we must
navigate to each COLA's printable page before fetching its images. Then
we use JS fetch() from that page context to grab image bytes.

--limit counts COLAs, not individual images. A COLA with 4 images will
download all 4 before moving to the next. Checkpoint tracks completed
ttb_ids — a COLA is only checkpointed when ALL its images succeed.

USAGE:
    # Download images for 50 COLAs
    python scripts/download_images_to_r2.py --limit 50

    # Dry run — download + measure but don't upload or update D1
    python scripts/download_images_to_r2.py --dry-run --limit 20

    # Re-download COLAs with failed images
    python scripts/download_images_to_r2.py --retry-failed --limit 50

REQUIREMENTS:
    - Firefox + geckodriver (Selenium)
    - boto3 (R2 S3-compatible upload)
    - Pillow (image dimensions)
    - CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY in .env
    - CLOUDFLARE_R2_BUCKET_NAME in .env (default: bevalc-reports)
    - CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN in .env
    - ANTHROPIC_API_KEY in .env (for CAPTCHA auto-solve)
"""

import os
import re
import sys
import io
import time
import base64
import argparse
import logging
from pathlib import Path

import requests as http_requests
import boto3
from botocore.config import Config
from PIL import Image

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.common.exceptions import TimeoutException
from webdriver_manager.firefox import GeckoDriverManager

import anthropic


SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
CHECKPOINT_FILE = DATA_DIR / "download_images_checkpoint.txt"

CORRUPT_THRESHOLD = 5 * 1024  # 5KB
MAX_RETRIES = 3
REQUEST_DELAY = 0.5  # seconds between image downloads within a COLA
COLA_DELAY = 3       # seconds between COLA page navigations (avoid rate-limiting)

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

# JavaScript to fetch an image URL via the browser's network stack
# and return the bytes as base64. Runs in the browser context with
# full session cookies, bypassing SSL and CAPTCHA issues.
FETCH_IMAGE_JS = """
var callback = arguments[arguments.length - 1];
var url = arguments[0];
fetch(url, {credentials: 'same-origin'})
    .then(function(response) {
        var finalUrl = response.url || url;
        if (!response.ok) {
            callback({success: false, error: 'HTTP ' + response.status, status: response.status, finalUrl: finalUrl});
            return;
        }
        var contentType = response.headers.get('content-type') || '';
        if (contentType.indexOf('html') !== -1) {
            callback({success: false, error: 'got HTML (captcha?)', status: -1, finalUrl: finalUrl});
            return;
        }
        return response.arrayBuffer().then(function(buf) {
            var bytes = new Uint8Array(buf);
            var binary = '';
            var chunkSize = 8192;
            for (var i = 0; i < bytes.length; i += chunkSize) {
                var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                binary += String.fromCharCode.apply(null, chunk);
            }
            callback({
                success: true,
                data: btoa(binary),
                contentType: contentType,
                size: bytes.length,
                finalUrl: finalUrl
            });
        });
    })
    .catch(function(err) {
        callback({success: false, error: err.message || String(err), status: -1});
    });
"""


# =============================================================================
# Logging
# =============================================================================

logger = logging.getLogger("download_images")
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
# Checkpoint file (tracks fully-completed COLAs by ttb_id)
# =============================================================================

def load_checkpoint():
    if not CHECKPOINT_FILE.exists():
        return set()
    with open(CHECKPOINT_FILE, 'r') as f:
        return {line.strip() for line in f if line.strip()}


def save_checkpoint_entry(ttb_id):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, 'a') as f:
        f.write(ttb_id + '\n')


# =============================================================================
# CAPTCHA handling
# =============================================================================

captcha_stats = {'attempts': 0, 'successes': 0, 'failures': 0}

CAPTCHA_INDICATORS = ['captcha', 'what code is in the image', 'g-recaptcha']


def detect_captcha(driver):
    try:
        html = driver.page_source.lower()
        return any(ind in html for ind in CAPTCHA_INDICATORS)
    except Exception:
        return False


def solve_captcha(driver, api_key):
    """Attempt to auto-solve a CAPTCHA using Claude Vision."""
    try:
        captcha_img = None
        site_chrome = ['arrowrt', 'masthead', 'arch', 'footer', 'logo', 'ttb',
                       'treasury', 'treas', 'spacer', '.gif']
        for img in driver.find_elements(By.TAG_NAME, 'img'):
            src = (img.get_attribute('src') or '').lower()
            if any(skip in src for skip in site_chrome):
                continue
            if not img.is_displayed():
                continue
            if img.size['height'] < 20 or img.size['width'] < 40:
                continue
            captcha_img = img
            break

        if not captcha_img:
            logger.warning("    Could not find CAPTCHA image element")
            return False

        img_b64 = captcha_img.screenshot_as_base64
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=32,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                    {"type": "text", "text": "What text is shown in this captcha image? Return only the characters, nothing else."}
                ],
            }]
        )

        captcha_text = response.content[0].text.strip()
        if not captcha_text:
            return False

        logger.info(f"    CAPTCHA answer: '{captcha_text}'")

        captcha_input = None
        for inp in driver.find_elements(By.CSS_SELECTOR, 'input[type="text"]'):
            if inp.is_displayed():
                captcha_input = inp
                break

        if not captcha_input:
            return False

        captcha_input.clear()
        captcha_input.send_keys(captcha_text)

        try:
            submit = driver.find_element(By.CSS_SELECTOR, 'input[type="submit"][value="submit" i]')
            submit.click()
        except Exception:
            captcha_input.send_keys(Keys.RETURN)

        time.sleep(2)
        return not detect_captcha(driver)

    except Exception as e:
        logger.warning(f"    CAPTCHA auto-solve error: {e}")
        return False


def handle_captcha(driver, api_key):
    """Handle CAPTCHA with up to 3 auto-solve attempts + manual fallback."""
    if not detect_captcha(driver):
        return True

    logger.info("  CAPTCHA detected — attempting auto-solve...")

    for attempt in range(3):
        captcha_stats['attempts'] += 1
        logger.info(f"    Attempt {attempt + 1}/3")

        if solve_captcha(driver, api_key):
            captcha_stats['successes'] += 1
            rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
            logger.info(f"    [OK] Solved (stats: {captcha_stats['successes']}/{captcha_stats['attempts']}, {rate:.0f}%)")
            return True

        captcha_stats['failures'] += 1
        if attempt < 2:
            try:
                driver.refresh()
                time.sleep(2)
                if not detect_captcha(driver):
                    return True
            except Exception:
                pass

    # Manual fallback
    logger.warning("  Auto-solve exhausted. Solve in the browser, then press ENTER (or 'quit').")
    try:
        resp = input("> ").strip().lower()
        if resp == 'quit':
            return False
        if detect_captcha(driver):
            return handle_captcha(driver, api_key)
        logger.info("  [OK] Solved manually")
        time.sleep(2)
        return True
    except EOFError:
        time.sleep(30)
        return not detect_captcha(driver)


# =============================================================================
# Browser session + image download
# =============================================================================

TTB_PRINTABLE_URL = "https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid="


def navigate_to_cola(driver, ttb_id, api_key):
    """Navigate to a COLA's printable page and handle any CAPTCHA.

    TTB's publicViewAttachment.do is session-bound — it only serves images
    for the COLA whose printable page is currently loaded. We MUST navigate
    to each COLA's page before fetching its images.
    """
    url = TTB_PRINTABLE_URL + ttb_id
    for attempt in range(2):
        try:
            driver.get(url)
            break
        except Exception as e:
            if attempt == 0:
                logger.warning(f"  Page load error for {ttb_id}: {e.__class__.__name__}, retrying in 10s...")
                time.sleep(10)
            else:
                logger.warning(f"  Page load failed on retry for {ttb_id}")
                return False

    try:
        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script('return document.readyState') == 'complete'
        )
    except TimeoutException:
        pass

    if not handle_captcha(driver, api_key):
        logger.error(f"  CAPTCHA not solved for {ttb_id}")
        return False

    # Check for TTB error page
    html = driver.page_source
    if 'Error Messages' in html and 'Unable to process request' in html:
        logger.warning(f"  TTB error page for {ttb_id}")
        return False

    return True


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


def download_image(driver, url):
    """
    Download image bytes via JavaScript fetch() in the browser context.
    Returns (image_bytes, status).
    """
    for attempt in range(MAX_RETRIES):
        try:
            result = driver.execute_async_script(FETCH_IMAGE_JS, url)
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                logger.info(f"    JS fetch error (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                time.sleep(2 ** attempt)
                continue
            return None, 'timeout'

        if result is None:
            if attempt < MAX_RETRIES - 1:
                logger.info(f"    Null result (attempt {attempt + 1}/{MAX_RETRIES}), retrying...")
                time.sleep(2 ** attempt)
                continue
            return None, 'failed'

        if result.get('success'):
            image_bytes = base64.b64decode(result['data'])
            return image_bytes, 'success'

        error = result.get('error', 'unknown')

        # CAPTCHA or session expired — caller should re-navigate
        if 'html' in error.lower() or 'captcha' in error.lower():
            return None, 'captcha'

        if attempt < MAX_RETRIES - 1:
            logger.info(f"    Fetch error: {error} (attempt {attempt + 1}/{MAX_RETRIES}), retrying...")
            time.sleep(2 ** attempt)
        else:
            logger.warning(f"    Fetch failed: {error}")
            return None, 'failed'

    return None, 'failed'


# =============================================================================
# D1 queries
# =============================================================================

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


def get_colas_needing_download(limit, checkpoint, retry_failed=False):
    """Get distinct ttb_ids that have pending/failed images, excluding checkpointed."""
    if retry_failed:
        where = "download_status IN ('failed', 'timeout', 'captcha')"
        desc = "failed/timed-out"
    else:
        where = "download_status IS NULL"
        desc = "pending"

    logger.info(f"Querying D1 for up to {limit} COLAs with {desc} images...")

    rows = d1_query_rows(
        f"SELECT DISTINCT ttb_id FROM cola_images "
        f"WHERE {where} "
        f"ORDER BY ttb_id DESC "
        f"LIMIT {limit}"
    )

    ttb_ids = [r['ttb_id'] for r in rows]

    # Filter out already-checkpointed COLAs
    before = len(ttb_ids)
    ttb_ids = [t for t in ttb_ids if t not in checkpoint]
    skipped = before - len(ttb_ids)
    if skipped:
        logger.info(f"Skipped {skipped} already-checkpointed COLAs")

    logger.info(f"Found {len(ttb_ids)} COLAs to process")
    return ttb_ids


def get_images_for_cola(ttb_id):
    """Get all image rows for a specific COLA."""
    return d1_query_rows(
        f"SELECT image_id, ttb_id, ttb_original_url, download_status "
        f"FROM cola_images WHERE ttb_id = {escape_sql_value(ttb_id)} "
        f"ORDER BY id ASC"
    )


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

def run_download(ttb_ids, api_key, headless=False, dry_run=False, save_to_disk=False):
    """Download all images for each COLA via Selenium, upload to R2."""
    # Start browser
    logger.info("Starting Firefox...")
    options = webdriver.FirefoxOptions()
    if headless:
        options.add_argument('--headless')

    driver = webdriver.Firefox(
        service=FirefoxService(GeckoDriverManager().install()),
        options=options
    )
    driver.set_page_load_timeout(30)
    driver.set_script_timeout(60)  # Allow up to 60s for large image fetch

    # Stats
    colas_complete = 0
    colas_partial = 0
    colas_nav_failed = 0
    images_downloaded = 0
    images_uploaded = 0
    images_failed = 0
    images_corrupt = 0
    images_skipped = 0
    total_bytes = 0
    disk_counter = 0  # For --save-to-disk numbering

    try:
        for cola_idx, ttb_id in enumerate(ttb_ids):
            images = get_images_for_cola(ttb_id)
            pending = [img for img in images if img.get('download_status') != 'success']

            logger.info(f"[COLA {cola_idx+1}/{len(ttb_ids)}] {ttb_id} — "
                       f"{len(images)} images ({len(pending)} pending)")

            if not pending:
                logger.info(f"  All images already downloaded")
                if not dry_run:
                    save_checkpoint_entry(ttb_id)
                colas_complete += 1
                images_skipped += len(images)
                continue

            # Navigate to THIS COLA's printable page first.
            # TTB's publicViewAttachment.do is session-bound — it only
            # serves images for the COLA whose page is currently loaded.
            if not navigate_to_cola(driver, ttb_id, api_key):
                colas_nav_failed += 1
                images_failed += len(pending)
                if not dry_run:
                    for img in pending:
                        update_image_row(img['image_id'], None, None, None, None, 'failed')
                continue

            cola_all_ok = True

            for img_idx, img in enumerate(pending):
                image_id = img['image_id']
                url = img['ttb_original_url']

                logger.info(f"  [{img_idx+1}/{len(pending)}] {image_id}")

                # Download via browser JS fetch (from this COLA's page context)
                image_bytes, status = download_image(driver, url)

                if status == 'captcha':
                    # CAPTCHA during fetch — re-navigate and retry once
                    logger.info(f"    CAPTCHA during fetch — re-navigating to {ttb_id}...")
                    if navigate_to_cola(driver, ttb_id, api_key):
                        image_bytes, status = download_image(driver, url)

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
                           f"{images_uploaded} uploaded, {images_failed} failed | "
                           f"{mb:.1f} MB ---")

            # Delay between COLAs to avoid TTB rate-limiting
            if cola_idx < len(ttb_ids) - 1:
                time.sleep(COLA_DELAY)

    except KeyboardInterrupt:
        logger.info("\nInterrupted by user")
    finally:
        driver.quit()

    # Get overall progress from D1
    total_colas = get_total_cola_count()
    completed_colas = get_completed_cola_count() if not dry_run else '?'

    # Summary
    mb = total_bytes / (1024 * 1024)
    print(f"\n{'='*60}")
    print(f"DOWNLOAD SUMMARY")
    print(f"{'='*60}")
    print(f"COLAs processed:      {len(ttb_ids)}")
    print(f"COLAs complete:       {colas_complete}")
    print(f"COLAs nav failed:     {colas_nav_failed}")
    print(f"COLAs partial:        {colas_partial}")
    print(f"Images downloaded:    {images_downloaded}")
    print(f"Images uploaded:      {images_uploaded}")
    print(f"Images failed:        {images_failed}")
    print(f"Images corrupt (<5KB):{images_corrupt}")
    print(f"Images skipped:       {images_skipped}")
    print(f"Total downloaded:     {mb:.1f} MB")
    if images_downloaded:
        avg_kb = (total_bytes / images_downloaded) / 1024
        print(f"Avg file size:        {avg_kb:.0f} KB")
    if captcha_stats['attempts']:
        rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
        print(f"CAPTCHA auto-solve:   {captcha_stats['successes']}/{captcha_stats['attempts']} ({rate:.0f}%)")
    else:
        print(f"CAPTCHA:              none encountered")
    print(f"{'='*60}")
    print(f"Progress: {completed_colas}/{total_colas:,} COLAs complete "
          f"({images_uploaded} images downloaded)")
    if dry_run:
        print(f"[DRY RUN — nothing uploaded, checkpointed, or updated]")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Download label images from TTB and upload to Cloudflare R2',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download images for 50 COLAs
  python scripts/download_images_to_r2.py --limit 50

  # Dry run — download but don't upload or update D1
  python scripts/download_images_to_r2.py --dry-run --limit 20

  # Re-download COLAs with failed images
  python scripts/download_images_to_r2.py --retry-failed --limit 50

  # Reset checkpoint and start over
  # Delete data/download_images_checkpoint.txt, then run again
        """
    )
    parser.add_argument('--limit', type=int, default=50,
                        help='Max COLAs to process (default: 50)')
    parser.add_argument('--ttb-ids', nargs='+',
                        help='Specific ttb_ids to download (skips D1 lookup)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Download and measure without uploading to R2 or updating D1')
    parser.add_argument('--retry-failed', action='store_true',
                        help='Re-download COLAs with failed/timeout/captcha images')
    parser.add_argument('--save-to-disk', action='store_true',
                        help='Save each downloaded image to data/test_N.ext for inspection')
    parser.add_argument('--headless', action='store_true',
                        help='Run browser in headless mode')
    args = parser.parse_args()

    load_env()
    api_key = require_env('ANTHROPIC_API_KEY')
    init_d1()
    init_r2()

    if args.ttb_ids:
        ttb_ids = args.ttb_ids
        logger.info(f"Using {len(ttb_ids)} ttb_ids from command line")
    else:
        checkpoint = load_checkpoint()
        if checkpoint:
            logger.info(f"Checkpoint: {len(checkpoint)} COLAs already completed")
        ttb_ids = get_colas_needing_download(args.limit, checkpoint, retry_failed=args.retry_failed)

    if not ttb_ids:
        logger.info("No COLAs to process")
        return

    run_download(ttb_ids, api_key, headless=args.headless, dry_run=args.dry_run,
                 save_to_disk=args.save_to_disk)


if __name__ == '__main__':
    main()
