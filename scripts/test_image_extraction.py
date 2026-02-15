"""
test_image_extraction.py - Test CAPTCHA auto-solving + image URL extraction

Visits TTB printable version pages (action=publicFormDisplay), handles CAPTCHAs
via Claude Vision, and extracts label image URLs. Prints results only — no DB writes.

USAGE:
    # From local captcha_test.db
    python scripts/test_image_extraction.py --limit 10

    # From production D1
    python scripts/test_image_extraction.py --from-d1 --limit 50

    # Specific ttb_ids
    python scripts/test_image_extraction.py --ttb-ids 26021001000664 24031001000777
"""

import os
import re
import sys
import time
import argparse
import sqlite3

import requests as http_requests  # avoid collision with selenium
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.common.exceptions import TimeoutException
from webdriver_manager.firefox import GeckoDriverManager

import anthropic


TTB_PRINTABLE_URL = "https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid="

# CAPTCHA stats (module-level for simplicity)
captcha_stats = {'attempts': 0, 'successes': 0, 'failures': 0}


# =============================================================================
# Environment / API keys
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
ENV_FILE = os.path.join(BASE_DIR, '.env')


def load_env():
    """Load all env vars from .env file."""
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())


def require_env(name):
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} not found in env or .env file")
        sys.exit(1)
    return val


# =============================================================================
# CAPTCHA handling (same logic as cola_worker.py)
# =============================================================================

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
            print("    Could not find CAPTCHA image element")
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
            print("    Claude returned empty CAPTCHA text")
            return False

        print(f"    Claude says: '{captcha_text}'")

        captcha_input = None
        for inp in driver.find_elements(By.CSS_SELECTOR, 'input[type="text"]'):
            if inp.is_displayed():
                captcha_input = inp
                break

        if not captcha_input:
            print("    Could not find CAPTCHA input field")
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
        print(f"    CAPTCHA auto-solve error: {e}")
        return False


def handle_captcha(driver, api_key):
    if not detect_captcha(driver):
        return True

    print("  CAPTCHA detected — attempting auto-solve...")

    for attempt in range(3):
        captcha_stats['attempts'] += 1
        print(f"    Attempt {attempt + 1}/3")

        if solve_captcha_with_vision(driver, api_key):
            captcha_stats['successes'] += 1
            rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
            print(f"    [OK] Solved (stats: {captcha_stats['successes']}/{captcha_stats['attempts']}, {rate:.0f}%)")
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
    print("\n  Auto-solve failed. Solve in the browser window.")
    print("  Press ENTER to continue (or 'quit' to stop)...")
    try:
        resp = input("  > ").strip().lower()
        if resp == 'quit':
            return False
        if detect_captcha(driver):
            return handle_captcha(driver, api_key)
        print("  [OK] Solved manually")
        time.sleep(2)
        return True
    except EOFError:
        time.sleep(30)
        return not detect_captcha(driver)


# =============================================================================
# Image extraction
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
    """Map TTB 'Image Type' text to a normalized label_type."""
    text = text.strip().lower()
    if text in IMAGE_TYPE_MAP:
        return IMAGE_TYPE_MAP[text]
    # Partial match fallback
    for key, val in IMAGE_TYPE_MAP.items():
        if key in text:
            return val
    return 'other'


def extract_images(driver, ttb_id, api_key):
    """Visit printable version page and extract image URLs. Returns list of dicts or None on error."""
    url = TTB_PRINTABLE_URL + ttb_id

    try:
        driver.get(url)
        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script('return document.readyState') == 'complete'
        )
    except TimeoutException:
        print(f"  Timeout loading page")
        return None

    if not handle_captcha(driver, api_key):
        print(f"  CAPTCHA not solved, skipping")
        return None

    html = driver.page_source

    # Check for TTB error page
    if 'Error Messages' in html and 'Unable to process request' in html:
        print(f"  TTB error page (session issue or invalid ttb_id)")
        return None

    soup = BeautifulSoup(html, 'html.parser')

    # Build a list of (label_type, dimensions) by walking the "Image Type:" markers
    # HTML structure per image:
    #   <p class="data">Image Type: </p>
    #   Brand (front) or keg collar        <-- text node
    #   <br>
    #   Actual Dimensions: 3.8 inches W X 2.2 inches H<br>
    #   <br><br>
    #   <img src="/colasonline/publicViewAttachment.do?..." alt="..."/>
    image_types = []
    for p_tag in soup.find_all('p', class_='data'):
        if 'Image Type' not in p_tag.get_text():
            continue
        # The type text is the next sibling text node after this <p>
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
        image_types.append(parse_label_type(type_text))

    # Now collect all attachment images
    img_tags = soup.find_all('img', src=re.compile(r'publicViewAttachment'))
    images = []

    for i, img in enumerate(img_tags):
        src = img.get('src', '')
        alt = img.get('alt', '')

        # Use the parsed Image Type from the HTML text, fall back to alt
        if i < len(image_types):
            label_type = image_types[i]
        else:
            label_type = parse_label_type(alt.replace('Label Image:', '').strip())

        filename_match = re.search(r'filename=([^&]+)', src)
        filename = filename_match.group(1) if filename_match else src

        images.append({
            'index': i + 1,
            'label_type': label_type,
            'ttb_type_text': image_types[i] if i < len(image_types) else '(from alt)',
            'filename': filename,
            'src': src,
            'alt': alt,
        })

    return images


# =============================================================================
# D1 query for ttb_ids
# =============================================================================

def fetch_ttb_ids_from_d1(limit):
    """Query production D1 for recent ttb_ids."""
    account_id = require_env('CLOUDFLARE_ACCOUNT_ID')
    database_id = require_env('CLOUDFLARE_D1_DATABASE_ID')
    api_token = require_env('CLOUDFLARE_API_TOKEN')

    api_url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/d1/database/{database_id}/query"
    )

    # Get recent ttb_ids ordered by approval_date DESC
    sql = f"SELECT ttb_id FROM colas ORDER BY approval_date DESC LIMIT {limit}"

    print(f"Querying D1 for {limit} recent ttb_ids...")
    resp = http_requests.post(
        api_url,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json"
        },
        json={"sql": sql}
    )

    if resp.status_code != 200:
        print(f"ERROR: D1 API returned {resp.status_code}: {resp.text[:200]}")
        sys.exit(1)

    data = resp.json()
    if not data.get("success"):
        print(f"ERROR: D1 query failed: {data.get('errors', 'unknown')}")
        sys.exit(1)

    rows = data.get("result", [{}])[0].get("results", [])
    ttb_ids = [r["ttb_id"] for r in rows]
    print(f"Got {len(ttb_ids)} ttb_ids from D1")
    return ttb_ids


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Test CAPTCHA auto-solving + image URL extraction on TTB printable pages'
    )
    parser.add_argument('--limit', type=int, default=10,
                        help='Max pages to test (default: 10)')
    parser.add_argument('--ttb-ids', nargs='+',
                        help='Specific ttb_ids to test (skips DB lookup)')
    parser.add_argument('--from-d1', action='store_true',
                        help='Pull ttb_ids from production D1 database')
    parser.add_argument('--db', default='data/captcha_test.db',
                        help='SQLite DB to read ttb_ids from (default: data/captcha_test.db)')
    parser.add_argument('--headless', action='store_true',
                        help='Run browser in headless mode (not recommended for CAPTCHA testing)')
    args = parser.parse_args()

    load_env()
    api_key = require_env('ANTHROPIC_API_KEY')

    # Resolve ttb_ids
    if args.ttb_ids:
        ttb_ids = args.ttb_ids
    elif args.from_d1:
        ttb_ids = fetch_ttb_ids_from_d1(args.limit)
    else:
        if not os.path.exists(args.db):
            print(f"ERROR: {args.db} not found. Use --from-d1 or provide --ttb-ids.")
            sys.exit(1)
        conn = sqlite3.connect(args.db)
        rows = conn.execute('SELECT ttb_id FROM colas ORDER BY ttb_id LIMIT ?', (args.limit,)).fetchall()
        ttb_ids = [r[0] for r in rows]
        conn.close()
        if not ttb_ids:
            print(f"ERROR: No records in {args.db}")
            sys.exit(1)

    print(f"\nTesting {len(ttb_ids)} printable version pages")
    print(f"{'=' * 60}\n")

    # Start browser
    options = webdriver.FirefoxOptions()
    if args.headless:
        options.add_argument('--headless')

    print("Starting Firefox...")
    driver = webdriver.Firefox(
        service=FirefoxService(GeckoDriverManager().install()),
        options=options
    )
    driver.set_page_load_timeout(30)

    total_images = 0
    pages_with = 0
    pages_without = 0
    pages_error = 0
    max_images_seen = 0

    try:
        for i, ttb_id in enumerate(ttb_ids):
            print(f"[{i+1}/{len(ttb_ids)}] ttb_id: {ttb_id}")

            images = extract_images(driver, ttb_id, api_key)

            if images is None:
                pages_error += 1
            elif len(images) == 0:
                print(f"  No images")
                pages_without += 1
            else:
                print(f"  Found {len(images)} image(s):")
                for img in images:
                    print(f"    [{img['index']}] {img['label_type']}: {img['filename']}")
                pages_with += 1
                total_images += len(images)
                max_images_seen = max(max_images_seen, len(images))

            time.sleep(1.5)

    except KeyboardInterrupt:
        print("\n\nInterrupted")
    finally:
        driver.quit()

    tested = pages_with + pages_without + pages_error
    print(f"\n{'=' * 60}")
    print(f"SUMMARY")
    print(f"{'=' * 60}")
    print(f"Pages tested:         {tested}")
    print(f"Pages with images:    {pages_with}")
    print(f"Pages without images: {pages_without}")
    print(f"Pages errored:        {pages_error}")
    print(f"Total images found:   {total_images}")
    if pages_with:
        print(f"Avg images/page:      {total_images / pages_with:.1f}")
        print(f"Max images on a page: {max_images_seen}")
    if captcha_stats['attempts']:
        rate = captcha_stats['successes'] / captcha_stats['attempts'] * 100
        print(f"CAPTCHA auto-solve:   {captcha_stats['successes']}/{captcha_stats['attempts']} ({rate:.0f}%)")
    else:
        print(f"CAPTCHA:              none encountered")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
