# BevAlc Intelligence — Processing Pipeline

## Overview

The pipeline transforms raw TTB COLA filings into enriched, queryable intelligence. It runs in sequential stages. Each stage reads from and writes to specific tables and updates the `processing_status` field on the `colas` table.

```
TTB Scraping → Image Download → OCR → Barcode Extraction → LLM Enrichment → Embedding → Derived Tables
     ↓              ↓             ↓            ↓                  ↓              ↓            ↓
  "raw"     "images_downloaded" "ocr_complete" (no status)   "enriched"    "embedded"    (nightly)
```

---

## Stage 0: COLA Scraping (EXISTING)

**Already built.** Scrapes TTB Public COLA Registry and writes records to the `colas` table in D1.

- **Trigger**: Cron (daily or as configured)
- **Output**: New rows in `colas` table with `processing_status = 'raw'`
- **Volume**: ~3,000 new COLAs per week

---

## Stage 1: Image Download

**Purpose**: Download all label images associated with each COLA from TTB's website and store in Cloudflare R2.

- **Trigger**: Runs after scraping, or on-demand for backfill
- **Reads**: `colas` where `processing_status = 'raw'`
- **Writes**: Images to R2, metadata rows to `cola_images` table
- **Updates**: `colas.processing_status = 'images_downloaded'`
- **External API**: TTB website (image URLs)
- **Rate Limiting**: Max 1-2 requests/second to TTB. Respect robots.txt.
- **CAPTCHA**: TTB may require captcha for image viewing. Options:
  1. Direct URL pattern (test if images are accessible without captcha page)
  2. 2Captcha service ($1-3 per 1,000 solves)
  3. COLA Cloud API as image source (if licensing their data)
  4. TTB FOIA bulk request

**Error Handling**:
- Timeout after 30s per image → mark `download_status = 'timeout'`, retry up to 3x
- Corrupted image (file size < 5KB) → mark `download_status = 'corrupt'`
- Missing image (404) → mark `download_status = 'missing'`
- Log all failures for review

**Validation**:
- 95%+ of COLAs should have at least one image
- Spot-check 50 images visually to confirm correct images for correct COLAs

**Validation Checkpoint (MUST PASS before proceeding to Stage 2)**:
Run these queries and log results to QUALITY_SCORECARD.md before processing OCR:
```sql
-- Total images downloaded
SELECT COUNT(*) FROM cola_images WHERE download_status = 'success';
-- Coverage: COLAs with at least 1 image
SELECT COUNT(DISTINCT ttb_id) FROM cola_images WHERE download_status = 'success';
-- Failure breakdown
SELECT download_status, COUNT(*) FROM cola_images GROUP BY download_status;
-- Average images per COLA
SELECT AVG(img_count) FROM (SELECT ttb_id, COUNT(*) as img_count FROM cola_images WHERE download_status = 'success' GROUP BY ttb_id);
-- Suspiciously small files (likely corrupt)
SELECT COUNT(*) FROM cola_images WHERE file_size < 5000 AND download_status = 'success';
```
If coverage < 90%, investigate the failure mode before proceeding. If corrupt rate > 2%, adjust detection threshold.

**Estimated Time**: 
- New daily batch (~600 COLAs): minutes
- Full backfill (2.6M COLAs, ~5M images): 2-3 weeks at respectful crawl speed

---

## Stage 2: OCR (Google Cloud Vision)

**Purpose**: Extract text from every label image using Google Cloud Vision API.

- **Trigger**: Runs after image download
- **Reads**: `cola_images` where `ocr_text IS NULL` and `download_status = 'success'`
- **Writes**: `ocr_text` and parsed fields on `cola_images` table
- **Updates**: `colas.processing_status = 'ocr_complete'` (after all images for a COLA are processed)
- **External API**: Google Cloud Vision `DOCUMENT_TEXT_DETECTION`
- **Auth**: Service account JSON (`bevalc-intel-29cc085a7954.json`)
- **Cost**: $1.50 per 1,000 images. ~$7K for full backfill.
- **Rate Limiting**: Google default is 1,800 requests/minute. Stay under 1,000/minute to be safe.

**Processing per image**:
1. Read image bytes from R2
2. Call Vision API `document_text_detection`
3. Store `response.full_text_annotation.text` as `ocr_text`
4. Run regex parsing on `ocr_text` to extract:
   - `ocr_abv`: Pattern match `XX% ALC/VOL`, `XX% ABV`, `XX% ALC`, `ALCOHOL XX% BY VOLUME`
   - `ocr_proof`: Pattern match `XX PROOF`
   - `ocr_volume_ml`: Pattern match `750ML`, `1L`, `375ML`, etc. Normalize to mL integer.
   - `ocr_age_years`: Pattern match `AGED X YEARS`, `X YEAR OLD`, `X YR OLD`
   - `ocr_website`: Pattern match URLs (`.com`, `.co`, `.us`, `.net`). Clean OCR artifacts (spaces in URLs).
   - `ocr_email`: Pattern match email addresses
   - `ocr_phone`: Pattern match phone numbers
5. Assess `ocr_quality_score`:
   - "good": 50+ characters of clean text
   - "partial": 20-50 characters or some garbled sections
   - "poor": < 20 characters
   - "failed": empty or only noise

**Error Handling**:
- Vision API error → log, retry up to 3x, mark as "failed" if persistent
- Empty response → mark `ocr_quality_score = 'failed'`

**Validation**:
- Pull 50 records, compare OCR text against actual label images
- Calculate hit rates: ABV (target 90%+), website (target 85%+), age statement (target 85%+ when present)
- Document hit rates in QUALITY_SCORECARD.md

**Validation Checkpoint (MUST PASS before proceeding to Stage 4)**:
Run these queries and log results to QUALITY_SCORECARD.md:
```sql
-- OCR quality distribution
SELECT ocr_quality_score, COUNT(*) FROM cola_images WHERE download_status = 'success' GROUP BY ocr_quality_score;
-- Field hit rates (% of images where each field was extracted)
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN ocr_abv IS NOT NULL THEN 1 ELSE 0 END) as has_abv,
  SUM(CASE WHEN ocr_volume_ml IS NOT NULL THEN 1 ELSE 0 END) as has_volume,
  SUM(CASE WHEN ocr_website IS NOT NULL THEN 1 ELSE 0 END) as has_website,
  SUM(CASE WHEN ocr_age_years IS NOT NULL THEN 1 ELSE 0 END) as has_age
FROM cola_images WHERE ocr_text IS NOT NULL;
-- Average OCR text length (proxy for quality)
SELECT AVG(LENGTH(ocr_text)) FROM cola_images WHERE ocr_quality_score = 'good';
-- Cross-check: does OCR ABV match TTB alcohol_content?
SELECT COUNT(*) as matches, 
  (SELECT COUNT(*) FROM cola_images ci JOIN colas c ON ci.ttb_id = c.ttb_id 
   WHERE ci.ocr_abv IS NOT NULL AND c.alcohol_content IS NOT NULL) as total_comparable
FROM cola_images ci JOIN colas c ON ci.ttb_id = c.ttb_id 
WHERE ci.ocr_abv IS NOT NULL AND c.alcohol_content IS NOT NULL
AND ABS(ci.ocr_abv - CAST(REPLACE(c.alcohol_content, '%', '') AS REAL)) < 0.5;
```
**Manual review**: Pull 50 random records where `ocr_quality_score = 'good'`, open the label image side-by-side with the OCR text. Score each as correct/partial/wrong. If accuracy < 85%, investigate regex patterns.
**Red flags**: If `ocr_quality_score = 'failed'` exceeds 15%, investigate whether image quality or Vision API calls are the issue.

---

## Stage 3: Barcode Extraction

**Purpose**: Detect and decode UPC/EAN barcodes from label images.

- **Trigger**: Runs after image download (can run in parallel with OCR)
- **Reads**: `cola_images` where `download_status = 'success'`
- **Writes**: Rows to `cola_image_barcodes` table
- **External API**: None (local processing with pyzbar)
- **Cost**: Compute only

**Processing per image**:
1. Read image bytes from R2
2. Convert to grayscale for better detection
3. Run pyzbar decode
4. For each barcode found: store value, type, confidence, bounding box
5. If no barcode found on first pass, try with contrast enhancement and re-scan

**Validation**:
- Expect 30-50% of COLAs to yield at least one barcode
- Verify decoded values have valid check digits
- Compare capture rate against COLA Cloud's ~18% rate (470K / 2.6M)

---

## Stage 4: LLM Enrichment (Claude API)

**Purpose**: Classify every COLA into the commercial taxonomy and extract rich product fields using the combined TTB data + OCR text.

- **Trigger**: Runs after OCR is complete
- **Reads**: `colas` where `processing_status = 'ocr_complete'`, joined with `cola_images` for OCR text
- **Writes**: All enrichment columns on `colas` table (commercial_category, subcategory, product_description, etc.)
- **Updates**: `colas.processing_status = 'enriched'`, `colas.enriched_at`, `colas.prompt_version`
- **External API**: Anthropic Claude Batch API
- **Model**: claude-sonnet-4-20250514 (or claude-opus-4-20250514 for edge cases)
- **Cost**: ~$1K for 2.6M records via batch API

**Processing per COLA**:
1. Assemble input:
   - Structured TTB fields: brand_name, fanciful_name, class_type_code, origin_code, alcohol_content, grape_varietal, wine_vintage, appellation
   - OCR text from front label (if available)
   - OCR text from back label (if available)
   - Pre-parsed OCR fields (ocr_abv, ocr_volume_ml, etc.) as confirmation signals
2. Send to Claude with ENRICHMENT_PROMPT (see docs/prompts/ENRICHMENT_PROMPT.md)
3. Parse JSON response
4. Write all fields to `colas` table
5. Log the full request/response pair for debugging

**Prompt Engineering**:
- See ENRICHMENT_PROMPT.md for the exact prompt
- Taxonomy values are constrained to TAXONOMY.md
- Temperature: 0 (deterministic output)
- Include `taxonomy_feedback` field for products that don't fit cleanly

**Batch API Usage**:
- Format all records as JSONL
- Submit to Anthropic batch API
- Results return within hours
- Parse results and write to D1

**Error Handling**:
- Malformed JSON response → log, re-attempt with explicit JSON instruction
- Missing required fields → log, mark `enrichment_confidence = 'low'`
- Batch API timeout → resubmit failed records

**Validation**:
- Pre-batch: test prompt on 500 records, manually review every output, iterate prompt
- Post-batch: check null rates per field (category should be < 2% null)
- Post-batch: check distribution reasonableness (are category counts plausible?)
- Post-batch: check consistency (same brand → same category across filings)
- Post-batch: manual review of 50 random records from batch
- Document accuracy in QUALITY_SCORECARD.md

**Validation Checkpoint — Pre-Batch (MUST PASS before running full batch)**:
1. Run prompt on 50 records spanning: 10 bourbon/whiskey, 10 wine, 10 beer, 5 tequila/mezcal, 5 vodka/gin, 5 RTD/FMB, 5 edge cases
2. For each record, open the label image and manually score:
   - super_category: correct / wrong
   - commercial_category: correct / wrong
   - subcategory: correct / wrong / acceptable-alternative
   - estimated_price_tier: correct / off-by-one / wrong
   - boolean flags (is_cask_strength, etc.): correct / wrong
   - product_description: accurate / misleading / hallucinated
   - extracted fields (website, email, etc.): found-and-correct / found-but-wrong / missed
3. Target: 95%+ on super_category, 90%+ on commercial_category, 85%+ on subcategory
4. If targets not met, iterate prompt and re-run on same 50 + 50 new records
5. Log all scores and prompt version to QUALITY_SCORECARD.md

**Validation Checkpoint — Post-Batch (run after each batch)**:
```sql
-- Null rate check
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN super_category IS NULL THEN 1 ELSE 0 END) as null_super,
  SUM(CASE WHEN commercial_category IS NULL THEN 1 ELSE 0 END) as null_category,
  SUM(CASE WHEN subcategory IS NULL THEN 1 ELSE 0 END) as null_subcategory,
  SUM(CASE WHEN estimated_price_tier IS NULL THEN 1 ELSE 0 END) as null_price
FROM colas WHERE processing_status = 'enriched';

-- Distribution check: does this look plausible?
SELECT super_category, COUNT(*) as cnt, 
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM colas WHERE super_category IS NOT NULL), 1) as pct
FROM colas WHERE super_category IS NOT NULL GROUP BY super_category ORDER BY cnt DESC;

SELECT commercial_category, COUNT(*) as cnt
FROM colas WHERE commercial_category IS NOT NULL GROUP BY commercial_category ORDER BY cnt DESC LIMIT 20;

-- Consistency check: same brand should → same super_category
SELECT brand_name, COUNT(DISTINCT super_category) as distinct_supers
FROM colas WHERE super_category IS NOT NULL
GROUP BY brand_name HAVING distinct_supers > 1
ORDER BY distinct_supers DESC LIMIT 20;

-- Confidence distribution
SELECT enrichment_confidence, COUNT(*) FROM colas WHERE enrichment_confidence IS NOT NULL GROUP BY enrichment_confidence;

-- Taxonomy feedback: what doesn't fit?
SELECT taxonomy_feedback, COUNT(*) FROM colas 
WHERE taxonomy_feedback IS NOT NULL 
GROUP BY taxonomy_feedback ORDER BY COUNT(*) DESC LIMIT 20;

-- Invalid values check: anything outside the taxonomy?
SELECT commercial_category, COUNT(*) FROM colas 
WHERE commercial_category NOT IN ([list of valid categories from TAXONOMY.md])
AND commercial_category IS NOT NULL
GROUP BY commercial_category;
```
**Red flags that require prompt iteration**:
- super_category null rate > 1%
- commercial_category null rate > 3%
- Wine share < 35% or > 55% of total (known distribution from TTB)
- Confidence "low" > 10% of records
- Same brand appearing in multiple super_categories (consistency failure)
- Any values outside the taxonomy valid lists (constrained output failure)

---

## Stage 5: Embedding

**Purpose**: Generate vector embeddings for enriched COLA records and content items for semantic search.

- **Trigger**: Runs after enrichment
- **Reads**: `colas` where `processing_status = 'enriched'`, `content_chunks` where `embedding_status = 'pending'`
- **Writes**: Vectors to Pinecone, updates `processing_status = 'embedded'` or `embedding_status = 'embedded'`
- **External API**: OpenAI text-embedding-3-large
- **Cost**: ~$5-10/month at steady state

**For COLA records**:
1. Construct embedding text: combine commercial_category, subcategory, product_description, brand_name, fanciful_name, origin_code, flavor_profile, production_method
2. Call OpenAI embedding API
3. Upsert to Pinecone with metadata (ttb_id, commercial_category, subcategory, approval_date, etc.)

**For content items** (tweets, articles, etc.):
1. Chunk content into ~500 token segments with overlap
2. Store chunks in `content_chunks` table
3. Embed each chunk
4. Upsert to Pinecone with metadata (source_type, author, published_date, etc.)

---

## Stage 6: Derived Intelligence Tables

**Purpose**: Compute aggregate analytics from enriched data.

- **Trigger**: Nightly cron job
- **Reads**: `colas` where `processing_status IN ('enriched', 'embedded')`
- **Writes**: `category_trends`, `new_entrants`, `brand_velocity`, `competitive_clusters`

**category_trends**: 
- Group by period (week/month/quarter) and category/subcategory
- Calculate filing counts and period-over-period changes

**new_entrants**:
- Compare each COLA's plant_registry against historical filings
- Flag first-ever filings, first-in-category filings, new brand names

**brand_velocity**:
- Calculate filing frequency per brand per quarter
- Flag brands with accelerating filing rates

**competitive_clusters**:
- Group filings by subcategory within rolling 45-day windows
- Flag subcategories with unusual concentration of new filings from distinct companies

---

## Stage 7: Content Ingestion (Intelligence Product)

**Purpose**: Ingest unstructured content from external sources.

Runs independently from the COLA pipeline on its own cron schedules.

### Twitter (X API)
- **Frequency**: Every 4-6 hours
- **Process**: Poll User Tweets Timeline for each of 50 tracked accounts
- **Store**: Raw tweet text + metadata in `content_items`
- **Embed**: Chunk and embed into Pinecone

### Trade Publications (Firecrawl)
- **Frequency**: Daily
- **Process**: Crawl RSS feeds and article pages for target publications
- **Store**: Clean article text + metadata in `content_items`
- **Embed**: Chunk and embed into Pinecone

### Newsletters (Cloudflare Email Workers)
- **Frequency**: On arrival
- **Process**: Parse HTML body with Mozilla Readability
- **Store**: Clean text + metadata in `content_items`
- **Embed**: Chunk and embed into Pinecone

---

## Pipeline Monitoring

Track these metrics:
- Records per stage (how many at each processing_status)
- Daily throughput per stage
- Error rates per stage
- API costs per stage
- Processing backlog (records waiting at each stage)

A simple dashboard or daily email summary showing these numbers keeps the pipeline healthy.
