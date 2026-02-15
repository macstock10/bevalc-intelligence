"""
run_barcodes.py — Detect barcodes in label images from R2 using OpenCV

Downloads images from R2, runs cv2.barcode.BarcodeDetector (1D/2D barcodes)
and cv2.QRCodeDetector (QR codes) on each image, and inserts results into
the cola_image_barcodes D1 table. Images with no barcodes are silently
skipped (no row inserted).

Uses opencv-contrib-python which bundles the barcode module — no external
DLLs or system libraries needed (unlike pyzbar/zbar).

USAGE:
    # Scan up to 91 images
    python scripts/run_barcodes.py --limit 91

    # Dry run — detect but don't insert into D1
    python scripts/run_barcodes.py --dry-run --limit 50

SETUP:
    pip install opencv-contrib-python boto3 requests numpy
"""

import os
import sys
import time
import argparse
import logging
from pathlib import Path

import numpy as np
import cv2
import requests as http_requests
import boto3
from botocore.config import Config


SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR.parent
ENV_FILE = BASE_DIR / ".env"


# =============================================================================
# Logging
# =============================================================================

logger = logging.getLogger("run_barcodes")
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
# R2 client (read-only)
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
        config=Config(
            signature_version='s3v4',
            retries={'max_attempts': 3},
            connect_timeout=30,
            read_timeout=30,
        ),
        region_name='auto'
    )

    _r2['client'] = s3
    _r2['bucket'] = bucket
    logger.info(f"R2 bucket: {bucket}")


def download_from_r2(r2_key, max_retries=3, backoff=5):
    """Download image bytes from R2 with retry logic. Returns bytes or None."""
    for attempt in range(max_retries):
        try:
            resp = _r2['client'].get_object(Bucket=_r2['bucket'], Key=r2_key)
            return resp['Body'].read()
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff * (attempt + 1)
                logger.warning(f"  R2 download attempt {attempt+1} failed for {r2_key}: "
                             f"{e.__class__.__name__}, retrying in {wait}s...")
                time.sleep(wait)
            else:
                logger.error(f"  R2 download failed after {max_retries} attempts for {r2_key}: {e}")
                return None


# =============================================================================
# Barcode detection (OpenCV)
# =============================================================================

# OpenCV BarcodeDetector type strings → normalized names for D1
BARCODE_TYPE_MAP = {
    'EAN_13': 'EAN-13',
    'EAN_8': 'EAN-8',
    'UPC_A': 'UPC-A',
    'UPC_E': 'UPC-E',
    'UPC_EAN_EXTENSION': 'UPC-EAN-EXT',
}


def bytes_to_cv2(image_bytes):
    """Convert raw image bytes to a cv2 image (numpy array)."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def detect_barcodes(image_bytes):
    """Detect barcodes and QR codes in image bytes using OpenCV.

    Uses cv2.barcode.BarcodeDetector for 1D barcodes (UPC, EAN)
    and cv2.QRCodeDetector for QR codes. Returns list of dicts with
    barcode_value, barcode_type, confidence, bbox_x/y/width/height.
    """
    img = bytes_to_cv2(image_bytes)
    if img is None:
        logger.warning(f"  Could not decode image")
        return []

    barcodes = []

    # --- 1D barcodes via BarcodeDetector.detectAndDecodeMulti ---
    try:
        detector = cv2.barcode.BarcodeDetector()
        ret = detector.detectAndDecodeMulti(img)

        # OpenCV 4.13 returns numpy arrays — coerce to Python types
        ok = ret[0]
        if isinstance(ok, np.ndarray):
            ok = ok.size > 0 and ok.flat[0]
        ok = bool(ok)

        decoded_info = ret[1] if len(ret) > 1 else None
        # OpenCV 4.13: order is (retval, decoded_info, points, decoded_type)
        points = ret[2] if len(ret) > 2 else None
        decoded_type = ret[3] if len(ret) > 3 else None

        if ok and decoded_info is not None:
            for i, value in enumerate(decoded_info):
                value = str(value) if not isinstance(value, str) else value
                if not value:
                    continue

                if decoded_type is not None and len(decoded_type) > i:
                    rt = decoded_type[i]
                    raw_type = str(rt) if not isinstance(rt, str) else rt
                else:
                    raw_type = 'UNKNOWN'

                # OpenCV 4.13 often returns empty decoded_type — infer from value length
                if raw_type == 'UNKNOWN' and value.isdigit():
                    if len(value) == 12:
                        raw_type = 'UPC_A'
                    elif len(value) == 13:
                        raw_type = 'EAN_13'
                    elif len(value) == 8:
                        raw_type = 'EAN_8'

                normalized_type = BARCODE_TYPE_MAP.get(raw_type, raw_type)

                # Compute bounding box from the 4 corner points
                if points is not None and i < len(points):
                    pts = points[i]
                    x_min = int(np.min(pts[:, 0]))
                    y_min = int(np.min(pts[:, 1]))
                    x_max = int(np.max(pts[:, 0]))
                    y_max = int(np.max(pts[:, 1]))
                else:
                    x_min = y_min = x_max = y_max = 0

                barcodes.append({
                    'barcode_value': value,
                    'barcode_type': normalized_type,
                    'confidence': 1.0,
                    'bbox_x': x_min,
                    'bbox_y': y_min,
                    'bbox_width': x_max - x_min,
                    'bbox_height': y_max - y_min,
                })
    except Exception as e:
        logger.warning(f"  BarcodeDetector error: {e}")

    # --- QR codes via QRCodeDetector ---
    try:
        qr_detector = cv2.QRCodeDetector()
        data, points, _ = qr_detector.detectAndDecode(img)

        if data:
            if points is not None:
                pts = points[0]
                x_min = int(np.min(pts[:, 0]))
                y_min = int(np.min(pts[:, 1]))
                x_max = int(np.max(pts[:, 0]))
                y_max = int(np.max(pts[:, 1]))
            else:
                x_min = y_min = x_max = y_max = 0

            # Avoid duplicates if BarcodeDetector already found it
            existing_values = {b['barcode_value'] for b in barcodes}
            if data not in existing_values:
                barcodes.append({
                    'barcode_value': data,
                    'barcode_type': 'QR',
                    'confidence': 1.0,
                    'bbox_x': x_min,
                    'bbox_y': y_min,
                    'bbox_width': x_max - x_min,
                    'bbox_height': y_max - y_min,
                })
    except Exception as e:
        logger.warning(f"  QRCodeDetector error: {e}")

    return barcodes


# =============================================================================
# D1 queries
# =============================================================================

def get_images_needing_scan(limit):
    """Get cola_images rows not yet scanned for barcodes."""
    logger.info(f"Querying D1 for up to {limit} images not yet scanned...")

    rows = d1_query_rows(
        f"SELECT ci.image_id, ci.ttb_id, ci.r2_key "
        f"FROM cola_images ci "
        f"LEFT JOIN cola_image_barcodes cib ON ci.image_id = cib.image_id "
        f"WHERE ci.download_status = 'success' AND cib.image_id IS NULL "
        f"ORDER BY ci.ttb_id DESC "
        f"LIMIT {limit}"
    )

    logger.info(f"Found {len(rows)} images to scan")
    return rows


def insert_barcode(image_id, ttb_id, barcode):
    """Insert a single barcode row into cola_image_barcodes."""
    sql = (
        f"INSERT INTO cola_image_barcodes "
        f"(image_id, ttb_id, barcode_value, barcode_type, confidence, "
        f"bbox_x, bbox_y, bbox_width, bbox_height) VALUES ("
        f"{escape_sql_value(image_id)}, "
        f"{escape_sql_value(ttb_id)}, "
        f"{escape_sql_value(barcode['barcode_value'])}, "
        f"{escape_sql_value(barcode['barcode_type'])}, "
        f"{escape_sql_value(barcode['confidence'])}, "
        f"{escape_sql_value(barcode['bbox_x'])}, "
        f"{escape_sql_value(barcode['bbox_y'])}, "
        f"{escape_sql_value(barcode['bbox_width'])}, "
        f"{escape_sql_value(barcode['bbox_height'])})"
    )
    return d1_execute(sql)


# =============================================================================
# Main pipeline
# =============================================================================

def run_barcodes(images, dry_run=False):
    """Scan each image for barcodes: download from R2, detect, insert into D1."""
    images_scanned = 0
    images_with_barcodes = 0
    images_no_barcodes = 0
    r2_errors = 0
    total_barcodes = 0

    # Track barcode type distribution
    type_counts = {}

    for idx, img in enumerate(images):
        image_id = img['image_id']
        ttb_id = img['ttb_id']
        r2_key = img['r2_key']

        logger.info(f"[{idx+1}/{len(images)}] {image_id} ({r2_key})")

        # Download from R2
        image_bytes = download_from_r2(r2_key)
        if image_bytes is None:
            r2_errors += 1
            continue

        images_scanned += 1

        # Detect barcodes
        barcodes = detect_barcodes(image_bytes)

        if not barcodes:
            images_no_barcodes += 1
            logger.info(f"  No barcodes found")
            continue

        images_with_barcodes += 1
        total_barcodes += len(barcodes)

        for bc in barcodes:
            logger.info(
                f"  {bc['barcode_type']}: {bc['barcode_value']} "
                f"(at {bc['bbox_x']},{bc['bbox_y']} {bc['bbox_width']}x{bc['bbox_height']})"
            )
            type_counts[bc['barcode_type']] = type_counts.get(bc['barcode_type'], 0) + 1

            if not dry_run:
                insert_barcode(image_id, ttb_id, bc)

        # Progress every 25 images
        if (idx + 1) % 25 == 0:
            logger.info(f"  --- Progress: {idx+1}/{len(images)} | "
                       f"{images_with_barcodes} with barcodes, {total_barcodes} total ---")

    # Summary
    print(f"\n{'='*60}")
    print(f"BARCODE SCAN SUMMARY")
    print(f"{'='*60}")
    print(f"Images scanned:         {images_scanned}")
    print(f"Images with barcodes:   {images_with_barcodes}")
    print(f"Images without barcodes:{images_no_barcodes}")
    print(f"Total barcodes found:   {total_barcodes}")
    if r2_errors:
        print(f"R2 download errors:     {r2_errors}")
    if type_counts:
        print(f"\nBarcode types:")
        for btype, count in sorted(type_counts.items(), key=lambda x: -x[1]):
            print(f"  {btype:12s}: {count}")
    if images_scanned:
        print(f"\nDetection rate: {images_with_barcodes}/{images_scanned} "
              f"({images_with_barcodes/images_scanned*100:.0f}%)")
    if images_with_barcodes:
        print(f"Avg barcodes/image (when found): "
              f"{total_barcodes/images_with_barcodes:.1f}")
    if dry_run:
        print(f"\n[DRY RUN — nothing inserted into D1]")
    print(f"{'='*60}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Detect barcodes in label images from R2 using OpenCV',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/run_barcodes.py --limit 91
  python scripts/run_barcodes.py --dry-run --limit 50
        """
    )
    parser.add_argument('--limit', type=int, default=91,
                        help='Max images to scan (default: 91)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Detect barcodes but don\'t insert into D1')
    args = parser.parse_args()

    load_env()
    init_d1()
    init_r2()

    images = get_images_needing_scan(args.limit)
    if not images:
        logger.info("No images to scan")
        return

    run_barcodes(images, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
