"""
backfill_image_urls.py — DEPRECATED: Use backfill_images.py instead.

This script is superseded by backfill_images.py, which combines URL discovery
and image download in a single pass (halving TTB page visits).

Kept for reference only.
"""

import warnings
warnings.warn(
    "backfill_image_urls.py is deprecated. Use backfill_images.py instead, "
    "which combines URL discovery and image download in a single pass.",
    DeprecationWarning, stacklevel=2
)

"""
Original docstring:

Standalone script that visits TTB's printable version page for each COLA,
extracts image URLs and metadata, and writes to D1 cola_images table.

USAGE:
    python scripts/backfill_image_urls.py --limit 100
"""

import os
import re
import sys
import time
import argparse
import logging
from pathlib import Path
from urllib.parse import quote

import requests as http_requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.common.exceptions import TimeoutException
from webdriver_manager.firefox import GeckoDriverManager

import anthropic


# =============================================================================
# Paths and constants
# =============================================================================

SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
CHECKPOINT_FILE = DATA_DIR / "backfill_images_checkpoint.txt"

TTB_BASE = "https://ttbonline.gov/colasonline"
TTB_PRINTABLE_URL = f"{TTB_BASE}/viewColaDetails.do?action=publicFormDisplay&ttbid="

# Rate limiting
REQUEST_DELAY = 1.5  # seconds between page loads


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
# Checkpoint file
# =============================================================================

def load_checkpoint():
    """Load set of ttb_ids already processed."""
    if not CHECKPOINT_FILE.exists():
        return set()
    with open(CHECKPOINT_FILE, 'r') as f:
        return {line.strip() for line in f if line.strip()}


def save_checkpoint_entry(ttb_id):
    """Append a single ttb_id to the checkpoint file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, 'a') as f:
        f.write(ttb_id + '\n')


# =============================================================================
# CAPTCHA handling (same as cola_worker.py / test_image_extraction.py)
# =============================================================================

captcha_stats = {'attempts': 0, 'successes': 0, 'failures': 0}


def detect_captcha(driver):
    try:
        html = driver.page_source.lower()
        indicators = ['captcha', 'what code is in the image', 'g-recaptcha',
                     'access denied', 'support id']
        return any(ind in html for ind in indicators)
    except:
        return False


def solve_captcha_with_vision(driver, api_key):
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
            logger.warning("  Could not find CAPTCHA image element")
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
            logger.warning("  Claude returned empty CAPTCHA text")
            return False

        logger.info(f"  CAPTCHA answer: '{captcha_text}'")

        captcha_input = None
        for inp in driver.find_elements(By.CSS_SELECTOR, 'input[type="text"]'):
            if inp.is_displayed():
                captcha_input = inp
                break

        if not captcha_input:
            logger.warning("  Could not find CAPTCHA input field")
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
        logger.warning(f"  CAPTCHA auto-solve error: {e}")
        return False


def handle_captcha(driver, api_key):
    if not detect_captcha(driver):
        return True

    logger.info("CAPTCHA detected — attempting auto-solve...")

    for attempt in range(3):
        captcha_stats['attempts'] += 1
        logger.info(f"  Attempt {attempt + 1}/3")

        if solve_captcha_with_vision(driver, api_key):
            captcha_stats['successes'] += 1
            rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
            logger.info(f"  [OK] Solved (stats: {captcha_stats['successes']}/{captcha_stats['attempts']}, {rate:.0f}%)")
            return True

        captcha_stats['failures'] += 1
        if attempt < 2:
            try:
                driver.refresh()
                time.sleep(2)
                if not detect_captcha(driver):
                    return True
            except:
                pass

    # Manual fallback
    logger.warning("  Auto-solve exhausted. Falling back to manual...")
    print(f"\n{'='*60}")
    print(f"CAPTCHA — auto-solve failed after 3 attempts")
    print(f"Solve in the browser window, then press ENTER (or 'quit')...")
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
# Image extraction (from TTB printable version page)
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


def extract_images_from_page(driver, ttb_id, api_key):
    """
    Visit the printable version page for a ttb_id and extract image metadata.
    Returns list of image dicts, empty list if no images, or None on error.
    """
    url = TTB_PRINTABLE_URL + ttb_id

    try:
        driver.get(url)
        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script('return document.readyState') == 'complete'
        )
    except TimeoutException:
        logger.warning(f"  Timeout loading page")
        return None

    if not handle_captcha(driver, api_key):
        logger.warning(f"  CAPTCHA not solved")
        return None

    html = driver.page_source

    if 'Error Messages' in html and 'Unable to process request' in html:
        logger.warning(f"  TTB error page")
        return None

    soup = BeautifulSoup(html, 'html.parser')

    # Parse label types from "Image Type:" markers in the HTML
    # Structure: <p class="data">Image Type: </p>\n  Back\n  <br>
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

    # Parse dimension strings
    dimension_list = []
    for m in re.finditer(r'Actual Dimensions:\s*([^<]+)', html):
        dim_text = m.group(1).strip()
        width = height = None
        dim_match = re.search(r'([\d.]+)\s*inches?\s*W\s*X\s*([\d.]+)\s*inches?\s*H', dim_text, re.IGNORECASE)
        if dim_match:
            width = dim_match.group(1)
            height = dim_match.group(2)
        dimension_list.append((width, height))

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

        # Filename from URL
        filename_match = re.search(r'filename=([^&]+)', src)
        filename = filename_match.group(1) if filename_match else ''

        # Build full TTB URL (src is like "/colasonline/publicViewAttachment.do?...")
        ttb_original_url = f"https://ttbonline.gov{src}" if not src.startswith('http') else src

        # Dimensions (label dimensions from TTB, not pixel dimensions)
        label_w = dimension_list[i][0] if i < len(dimension_list) else None
        label_h = dimension_list[i][1] if i < len(dimension_list) else None

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
            'filename': filename,
        })

    return images


# =============================================================================
# D1 write
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


# =============================================================================
# Main pipeline
# =============================================================================

def get_ttb_ids_needing_images(limit):
    """Query D1 for ttb_ids that don't yet have entries in cola_images, ordered by most recent first."""
    logger.info(f"Querying D1 for up to {limit} ttb_ids missing image data...")

    rows = d1_query_rows(
        f"SELECT c.ttb_id FROM colas c "
        f"LEFT JOIN cola_images ci ON c.ttb_id = ci.ttb_id "
        f"WHERE ci.ttb_id IS NULL "
        f"ORDER BY c.approval_date DESC "
        f"LIMIT {limit}"
    )

    ttb_ids = [r["ttb_id"] for r in rows]
    logger.info(f"Found {len(ttb_ids)} ttb_ids needing images")
    return ttb_ids


def run_backfill(ttb_ids, api_key, dry_run=False):
    """Main backfill loop."""
    checkpoint = load_checkpoint()
    remaining = [t for t in ttb_ids if t not in checkpoint]

    logger.info(f"Total ttb_ids: {len(ttb_ids)}")
    logger.info(f"Already in checkpoint: {len(ttb_ids) - len(remaining)}")
    logger.info(f"To process: {len(remaining)}")
    if dry_run:
        logger.info("[DRY RUN] Will not write to D1 or checkpoint")

    if not remaining:
        logger.info("Nothing to do")
        return

    # Start browser
    logger.info("Starting Firefox...")
    options = webdriver.FirefoxOptions()
    driver = webdriver.Firefox(
        service=FirefoxService(GeckoDriverManager().install()),
        options=options
    )
    driver.set_page_load_timeout(30)

    # Stats
    processed = 0
    pages_with = 0
    pages_without = 0
    pages_error = 0
    total_images = 0
    total_inserted = 0

    try:
        for i, ttb_id in enumerate(remaining):
            logger.info(f"[{i+1}/{len(remaining)}] {ttb_id}")

            images = extract_images_from_page(driver, ttb_id, api_key)

            if images is None:
                pages_error += 1
                logger.warning(f"  Error — skipping (will retry next run)")
                # Don't checkpoint errors so they get retried
                time.sleep(REQUEST_DELAY)
                continue

            processed += 1

            if len(images) == 0:
                logger.info(f"  No images")
                pages_without += 1
            else:
                logger.info(f"  Found {len(images)} image(s):")
                for img in images:
                    logger.info(f"    {img['image_id']} | {img['label_type']} | {img['filename']}")
                pages_with += 1
                total_images += len(images)

                if not dry_run:
                    inserted = insert_images_to_d1(images)
                    total_inserted += inserted
                    if inserted < len(images):
                        logger.info(f"    Inserted {inserted}/{len(images)} (rest already existed)")

            # Checkpoint — mark as done (even zero-image COLAs, so we don't revisit)
            if not dry_run:
                save_checkpoint_entry(ttb_id)

            time.sleep(REQUEST_DELAY)

            # Progress summary every 25
            if (i + 1) % 25 == 0:
                logger.info(f"  --- Progress: {i+1}/{len(remaining)} | "
                           f"{pages_with} with images, {pages_without} without, {pages_error} errors | "
                           f"{total_images} images found, {total_inserted} inserted ---")

    except KeyboardInterrupt:
        logger.info("\nInterrupted by user")
    finally:
        driver.quit()

    # Summary
    print(f"\n{'='*60}")
    print(f"BACKFILL SUMMARY")
    print(f"{'='*60}")
    print(f"Pages processed:      {processed}")
    print(f"Pages with images:    {pages_with}")
    print(f"Pages without images: {pages_without}")
    print(f"Pages errored:        {pages_error}")
    print(f"Total images found:   {total_images}")
    if not dry_run:
        print(f"Images inserted to D1: {total_inserted}")
    else:
        print(f"[DRY RUN — nothing written]")
    if captcha_stats['attempts']:
        rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
        print(f"CAPTCHA auto-solve:   {captcha_stats['successes']}/{captcha_stats['attempts']} ({rate:.0f}%)")
    else:
        print(f"CAPTCHA:              none encountered")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Backfill cola_images table with label image URLs from TTB printable pages',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Backfill 100 most recent COLAs missing images
  python scripts/backfill_image_urls.py --limit 100

  # Dry run — show what would happen without writing
  python scripts/backfill_image_urls.py --limit 20 --dry-run

  # Process specific ttb_ids
  python scripts/backfill_image_urls.py --ttb-ids 26021001000664 24031001000777

  # Reset checkpoint and start over
  # Delete data/backfill_images_checkpoint.txt, then run again
        """
    )
    parser.add_argument('--limit', type=int, default=100,
                        help='Max ttb_ids to process (default: 100)')
    parser.add_argument('--ttb-ids', nargs='+',
                        help='Specific ttb_ids to process (skips D1 lookup)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Fetch pages and print results without writing to D1')
    args = parser.parse_args()

    load_env()
    api_key = require_env('ANTHROPIC_API_KEY')
    init_d1()

    # Resolve ttb_ids
    if args.ttb_ids:
        ttb_ids = args.ttb_ids
    else:
        ttb_ids = get_ttb_ids_needing_images(args.limit)

    if not ttb_ids:
        logger.info("No ttb_ids to process")
        return

    run_backfill(ttb_ids, api_key, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
