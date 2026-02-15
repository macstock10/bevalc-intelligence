# BevAlc Intelligence — Image Processing & Enrichment Pipeline

## What This Document Is

Complete technical reference for the 4-stage pipeline that transforms raw TTB COLA filings into enriched, commercially classified product records. Covers every script, table, API, flag, known issue, and scaling estimate.

Built February 2026. All stages production-tested.

---

## Pipeline Overview

```
Stage 0          Stage 1              Stage 2         Stage 3           Stage 4
TTB Scraping → Image Download → OCR Extraction → Barcode Scan → LLM Enrichment
weekly_update.py  download_images_   run_ocr.py      run_barcodes.py   run_enrichment.py
                  to_r2.py
     ↓                ↓                 ↓               ↓                 ↓
  colas table    cola_images table   cola_images    cola_image_      colas enrichment
  (raw rows)     (R2 keys)          (ocr_text)     barcodes table    columns (38 cols)
```

**Data flow**: Each COLA filing → 1-6 label images → OCR text per image → barcode values per image → one enriched classification per COLA.

---

## Stage 0: TTB Scraping (Pre-existing)

**Script**: `scripts/weekly_update.py`
**Schedule**: Daily 9pm ET via GitHub Actions (`--days 7`)
**Volume**: ~3,000 new COLAs/week

Scrapes TTB Public COLA Registry, syncs to D1, classifies signals (NEW_COMPANY, NEW_BRAND, NEW_SKU, REFILE). The scraper includes a CAPTCHA solver at lines 342-352 using 2Captcha service for TTB's text CAPTCHAs.

**Output**: New rows in `colas` table. This is the starting point for the image pipeline.

---

## Stage 1: Image Download

**Script**: `scripts/download_images_to_r2.py`
**Table**: `cola_images` (migration 009)
**Storage**: Cloudflare R2 bucket `bevalc-reports`

### How It Works

TTB's `publicViewAttachment.do` servlet is **session-bound** — it only serves images for the COLA whose printable page is currently loaded. So the script:

1. Opens each COLA's printable page in Selenium (Firefox)
2. Uses JS `fetch()` from that page context to download image bytes
3. Uploads to R2 with key pattern: `cola-images/{ttb_id}/{image_id}.jpg`
4. Records metadata in `cola_images` table

### CAPTCHA Handling

TTB intermittently shows CAPTCHAs. The script auto-solves using **Claude Vision** (`claude-sonnet-4-5-20250929`):

1. Detects CAPTCHA via HTML indicators (`captcha`, `what code is in the image`, `g-recaptcha`)
2. Screenshots the CAPTCHA image element
3. Sends to Claude Vision: "What text is shown in this captcha image?"
4. Types answer into the input field and submits
5. Up to 3 auto-solve attempts, then manual fallback (waits for user input)

**CAPTCHA solver**: `solve_captcha()` at line 287, `handle_captcha()` at line 354.

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | 50 | Max COLAs to process (not images — a COLA with 4 images downloads all 4) |
| `--dry-run` | off | Download + measure but don't upload or update D1 |
| `--retry-failed` | off | Re-download COLAs with failed/timeout/captcha status |
| `--save-to-disk` | off | Save images locally for inspection |
| `--headless` | off | Run browser in headless mode |
| `--ttb-ids [IDS]` | none | Process specific ttb_ids |

### Constants

- `CORRUPT_THRESHOLD = 5 KB` — images smaller than this marked corrupt
- `MAX_RETRIES = 3` — per image download
- `REQUEST_DELAY = 0.5s` — between images within a COLA
- `COLA_DELAY = 3s` — between COLA page navigations
- **Checkpoint file**: `data/download_images_checkpoint.txt` — tracks completed COLAs for crash recovery

### Dependencies

```
pip install selenium boto3 Pillow requests anthropic
```
Plus Firefox + geckodriver.

---

## Stage 2: OCR Extraction

**Script**: `scripts/run_ocr.py`
**API**: Google Cloud Vision (`DOCUMENT_TEXT_DETECTION`)
**Auth**: Service account JSON via `GOOGLE_APPLICATION_CREDENTIALS`
**Cost**: $1.50 per 1,000 images

### How It Works

1. Queries `cola_images` for rows where `download_status = 'success'` and `ocr_text IS NULL`
2. Downloads image bytes from R2
3. Resizes if either dimension > 4096px (Vision API limit)
4. Calls Vision API `document_text_detection`
5. Stores `full_text_annotation.text` as `ocr_text`
6. Runs regex extraction for structured fields
7. Assigns quality score

### Regex-Extracted Fields

| Field | Pattern Examples | Stored In |
|-------|-----------------|-----------|
| `ocr_abv` | "40% ALC/VOL", "40% ABV" | REAL |
| `ocr_volume_ml` | "750ML", "1.75L", "12 FL OZ" | INTEGER (normalized to mL) |
| `ocr_proof` | "80 PROOF" | INTEGER |
| `ocr_age_years` | "AGED 12 YEARS", "12 YEAR OLD" | INTEGER |
| `ocr_website` | "www.example.com" | TEXT (prefixed with https://) |
| `ocr_email` | "info@brand.com" | TEXT |
| `ocr_phone` | "(555) 123-4567" | TEXT (normalized format) |

### Quality Scoring

| Score | Criteria |
|-------|----------|
| `good` | 50+ chars of text AND at least one field extracted |
| `partial` | 20-50 chars |
| `poor` | < 20 chars |
| `failed` | No text or error |

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | 50 | Max images to OCR |
| `--dry-run` | off | OCR but don't update D1 |
| `--retry-failed` | off | Re-OCR images with `ocr_quality_score = 'failed'` |

### Dependencies

```
pip install google-cloud-vision boto3 requests Pillow
```

---

## Stage 3: Barcode Extraction

**Script**: `scripts/run_barcodes.py`
**Library**: OpenCV (`opencv-contrib-python`) — no external DLLs needed
**Cost**: Compute only (no API calls)

### How It Works

1. Queries `cola_images` for rows with `download_status = 'success'` not yet in `cola_image_barcodes`
2. Downloads image bytes from R2 (3-attempt retry, 5s backoff, 30s timeout)
3. Runs `cv2.barcode.BarcodeDetector.detectAndDecodeMulti()` for 1D barcodes
4. Runs `cv2.QRCodeDetector.detectAndDecode()` for QR codes
5. Inserts results into `cola_image_barcodes` table
6. Images with no barcodes are silently skipped (no row inserted)

### OpenCV 4.13 Gotchas

**Critical**: OpenCV 4.13's `detectAndDecodeMulti` return value differs from documentation:

- **Actual return order**: `(retval, decoded_info, points, decoded_type)` — NOT `(retval, decoded_info, decoded_type, points)`
- `retval` can be a numpy array, not a bool — requires `isinstance` check + `.flat[0]` extraction
- `decoded_type` often returns an empty tuple — barcode type must be inferred from value length:
  - 12 digits → UPC-A
  - 13 digits → EAN-13
  - 8 digits → EAN-8
- `decoded_type[i]` may return numpy array, not string — requires `str()` coercion

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | 91 | Max images to scan |
| `--dry-run` | off | Detect but don't insert into D1 |

### R2 Download Resilience

- **Timeout**: 30s connect + 30s read (boto3 Config)
- **Retry**: 3 attempts with 5s × attempt backoff
- **Idempotent**: LEFT JOIN skips images already in `cola_image_barcodes`

### Detection Rate

From initial 91-image run: ~10% of images yield barcodes (9 UPC-A, 1 QR from 91 images).

### Dependencies

```
pip install opencv-contrib-python boto3 requests numpy
```

---

## Stage 4: LLM Enrichment

**Script**: `scripts/run_enrichment.py`
**Model**: `claude-haiku-4-5-20251001` (temperature 0)
**Prompt**: `enhancements/prompts/ENRICHMENT_PROMPT.md` (v1.1)
**Taxonomy**: `enhancements/taxonomy/TAXONOMY.md`
**Cost**: ~$0.005/COLA ($0.80/MTok input, $4/MTok output)

### How It Works

1. Queries `colas` for rows where `enriched_at IS NULL` AND has at least one `cola_images` row with `ocr_text IS NOT NULL`
2. For each COLA, fetches all its images' OCR text, separates front/back, takes best pre-parsed field values
3. Assembles prompt: TTB filing data + front label OCR + back label OCR + pre-parsed fields + taxonomy lists + edge case rules
4. Calls Claude, parses JSON response
5. **Post-processing**: Nulls any field where `field_sources` says "inferred" (except category fields)
6. Writes enrichment columns + metadata to `colas` table

### Enrichment Columns (38 total, migration 010)

**Classification** (3):
`super_category`, `commercial_category`, `subcategory`

**Product details** (6):
`product_description`, `flavor_profile` (JSON array), `production_method`, `barrel_type`, `finishing_process`, `age_years`

**Boolean flags** (5):
`is_cask_strength`, `is_single_barrel`, `is_limited_release`, `is_organic`, `is_gluten_free`

**Market / packaging** (4):
`estimated_price_tier`, `target_market`, `packaging_format`, `parent_company`

**Derived signals** (3):
`is_new_brand`, `is_line_extension`, `is_label_refresh`

**Label contact info** (5):
`label_website`, `label_email`, `label_phone`, `label_social_media` (JSON array), `label_tagline`

**Production / sourcing** (5):
`distilled_in`, `bottled_by`, `bottled_in`, `imported_by`, `year_established`

**Raw OCR** (1):
`tasting_notes_raw`

**Enrichment metadata** (6):
`field_sources` (JSON), `enrichment_confidence`, `taxonomy_feedback`, `prompt_version`, `processing_status`, `enriched_at`

### Anti-Hallucination System (3 layers)

**Layer 1 — Prompt rules**: Rule 6 prohibits inferring `parent_company`, `production_method`, `barrel_type`, `flavor_profile`, `estimated_price_tier`, or `target_market` from general knowledge. Only populate from explicit data in the input.

**Layer 2 — Field provenance**: Rule 7 requires a `field_sources` JSON object mapping every non-null field to its source: `ttb_filing`, `label_front`, `label_back`, `label_other`, or `inferred`.

**Layer 3 — Post-processing override**: After parsing Claude's JSON, before writing to D1, any field where `field_sources` maps it to `"inferred"` gets set to `null`. This is a hard override — no inferred data ever reaches the database.

**Exception**: Category fields (`super_category`, `commercial_category`, `subcategory`) plus metadata fields (`confidence`, `taxonomy_feedback`, `field_sources`) ARE allowed to be inferred from `class_type_code`.

**Effectiveness**: In the 50-COLA production run, Haiku ignored the no-inference rule ~34% of the time for `estimated_price_tier`. Post-processing caught and nulled all 50 inferred fields.

### Boolean Null Convention

`null` = unknown, `false` = confirmed not. If a label doesn't say "cask strength," `null` (unknown) is more honest than `false` (confirmed not). For M&A advisors and due diligence, the distinction matters.

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | 5 | Max COLAs to enrich |
| `--dry-run` | off | Call Claude but don't write to D1 |

### Verbose Output

Automatically prints full JSON response for the first spirits COLA and first wine COLA encountered, for manual verification.

### Dependencies

```
pip install anthropic requests
```

---

## Database Schema

### Migration 009: `cola_images` + `cola_image_barcodes`

```sql
-- cola_images
CREATE TABLE cola_images (
    ttb_id TEXT NOT NULL,
    image_id TEXT UNIQUE,          -- "{ttb_id}-{sequence}"
    label_type TEXT,               -- front, back, neck, strip, other
    ttb_original_url TEXT,
    r2_key TEXT,
    r2_thumbnail_key TEXT,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    ocr_text TEXT,
    ocr_abv REAL,
    ocr_volume_ml INTEGER,
    ocr_proof INTEGER,
    ocr_age_years INTEGER,
    ocr_website TEXT,
    ocr_email TEXT,
    ocr_phone TEXT,
    ocr_quality_score TEXT,        -- good, partial, poor, failed
    download_status TEXT DEFAULT 'pending'  -- success, failed, timeout, corrupt, missing
);

-- cola_image_barcodes
CREATE TABLE cola_image_barcodes (
    image_id TEXT,
    ttb_id TEXT,
    barcode_value TEXT,
    barcode_type TEXT,             -- UPC-A, UPC-E, EAN-13, EAN-8, QR
    confidence REAL,
    bbox_x INTEGER,
    bbox_y INTEGER,
    bbox_width INTEGER,
    bbox_height INTEGER
);
```

### Migration 010: Enrichment Columns

38 columns added to `colas` table (all nullable). 4 indexes:
- `idx_colas_super_category`
- `idx_colas_commercial_category`
- `idx_colas_enriched_at`
- `idx_colas_processing_status`

`processing_status` defaults to `'raw'`, set to `'enriched'` after successful LLM enrichment.

---

## Environment Variables

All scripts read from `.env` in project root:

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts (D1 + R2) |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts (D1) |
| `CLOUDFLARE_API_TOKEN` | All scripts (D1) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | download_images, run_ocr, run_barcodes |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | download_images, run_ocr, run_barcodes |
| `CLOUDFLARE_R2_BUCKET_NAME` | R2 scripts (default: bevalc-reports) |
| `GOOGLE_APPLICATION_CREDENTIALS` | run_ocr (Vision API) |
| `ANTHROPIC_API_KEY` | download_images (CAPTCHA), run_enrichment (classification) |

**Note**: `.env` file has non-standard lines — can't `source .env` in bash. Scripts parse it manually.

---

## Known Issues

1. **TTB session binding** requires Selenium (slow). No known way to get images via plain HTTP.
2. **CAPTCHA frequency** is unpredictable. Claude Vision auto-solve works ~70% of the time; manual fallback needed for the rest.
3. **OpenCV 4.13 barcode type detection** unreliable — `decoded_type` is often empty. Length-based inference covers UPC-A/EAN-13/EAN-8 but can't distinguish UPC-E or other formats.
4. **R2 socket timeouts** occur occasionally under load. Retry logic (3 attempts, 5s backoff) handles this.
5. **Haiku ignores no-inference rule** ~34% of the time for `estimated_price_tier`. Post-processing catches all cases, but a future prompt iteration may reduce this.
6. **No batch API yet** — enrichment processes one COLA at a time with 1s rate limit. Anthropic Batch API would reduce cost 50% and eliminate rate limiting.

---

## Scaling Plan

| Milestone | Images | OCR Cost | Enrichment Cost | Time |
|-----------|--------|----------|-----------------|------|
| Pilot (done) | 91 | $0.14 | $0.28 (50 COLAs) | 1 hour |
| Weekly batch | ~600 | $0.90 | $3.00 | automated |
| Full backfill | ~5M | ~$7,500 | ~$13,000 | 2-3 weeks |

**Batch API savings**: Anthropic Batch API offers 50% discount. Full backfill enrichment cost drops from ~$13K to ~$6.5K.

**Parallelism**: Image download is bottlenecked by TTB's session requirement (sequential). OCR and barcodes can run in parallel. Enrichment can use Batch API for async processing.

---

## File Index

| File | Purpose |
|------|---------|
| `scripts/download_images_to_r2.py` | Stage 1: Image download via Selenium |
| `scripts/run_ocr.py` | Stage 2: Google Vision OCR |
| `scripts/run_barcodes.py` | Stage 3: OpenCV barcode detection |
| `scripts/run_enrichment.py` | Stage 4: Claude LLM enrichment |
| `scripts/migrations/009_cola_images.sql` | Schema: cola_images + cola_image_barcodes |
| `scripts/migrations/010_enrichment_columns.sql` | Schema: 38 enrichment columns on colas |
| `enhancements/prompts/ENRICHMENT_PROMPT.md` | Prompt v1.1 with examples |
| `enhancements/taxonomy/TAXONOMY.md` | Valid categories/subcategories |
| `enhancements/architecture/DATA_MODEL.md` | Column definitions and rationale |
| `enhancements/architecture/PIPELINE.md` | Original architecture doc (pre-implementation) |
