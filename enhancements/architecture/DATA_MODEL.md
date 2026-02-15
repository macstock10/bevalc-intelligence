# BevAlc Intelligence — Data Model

## Overview

All data is stored in Cloudflare D1 (SQLite-compatible). Images are stored in Cloudflare R2. Vectors are stored in Pinecone.

This document defines every table, column, type, and relationship. It is the source of truth for all pipeline components.

---

## Table: `colas` (EXISTING — to be extended)

### Existing columns (already in production)

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | INTEGER | Auto | Primary key |
| `ttb_id` | TEXT | TTB | Unique, not null. TTB approval ID |
| `status` | TEXT | TTB | Approval status |
| `vendor_code` | TEXT | TTB | |
| `serial_number` | TEXT | TTB | |
| `class_type_code` | TEXT | TTB | TTB regulatory class (e.g., "WHISKY DISTILLED FROM BOURBON MASH") |
| `origin_code` | TEXT | TTB | State/country of origin (e.g., "CALIFORNIA") |
| `brand_name` | TEXT | TTB | Registered brand name |
| `fanciful_name` | TEXT | TTB | Product-specific name |
| `type_of_application` | TEXT | TTB | |
| `for_sale_in` | TEXT | TTB | |
| `total_bottle_capacity` | TEXT | TTB | |
| `formula` | TEXT | TTB | |
| `approval_date` | TEXT | TTB | |
| `qualifications` | TEXT | TTB | TTB qualifying statements |
| `grape_varietal` | TEXT | TTB | Wine-specific |
| `wine_vintage` | TEXT | TTB | Wine-specific |
| `appellation` | TEXT | TTB | Wine-specific |
| `alcohol_content` | TEXT | TTB | |
| `ph_level` | TEXT | TTB | |
| `plant_registry` | TEXT | TTB | Permit/plant number |
| `company_name` | TEXT | TTB | |
| `street` | TEXT | TTB | Company address |
| `state` | TEXT | TTB | Company state |
| `contact_person` | TEXT | TTB | |
| `phone_number` | TEXT | TTB | |
| `year` | INTEGER | Derived | From approval_date |
| `month` | INTEGER | Derived | From approval_date |
| `day` | INTEGER | Derived | From approval_date |
| `scraped_at` | TEXT | System | Default CURRENT_TIMESTAMP |
| `signal` | TEXT | Migration | Added via ALTER TABLE post-creation |
| `category` | TEXT | Migration | Added via ALTER TABLE. Will be superseded by commercial_category but kept for backward compatibility |
| `company_id` | TEXT | Migration | Added via ALTER TABLE |
| `slug` | TEXT | Migration | Added via ALTER TABLE |

> **Note**: The `signal`, `category`, `company_id`, and `slug` columns exist on the D1 production table via migrations but are not in the original CREATE TABLE statement.

### New columns to add (enrichment pipeline)

| Column | Type | Source | Notes |
|---|---|---|---|
| `super_category` | TEXT | LLM Enrichment | "Spirits", "Wine", or "Beer & FMB". From TAXONOMY.md |
| `commercial_category` | TEXT | LLM Enrichment | e.g., "Bourbon", "Tequila", "Red Wine". From TAXONOMY.md |
| `subcategory` | TEXT | LLM Enrichment | e.g., "Single Barrel Bourbon", "Reposado". From TAXONOMY.md |
| `product_description` | TEXT | LLM Enrichment | 1-2 sentence commercial description |
| `flavor_profile` | TEXT | LLM Enrichment | JSON array of descriptors: ["caramel","vanilla","oak"] |
| `production_method` | TEXT | LLM Enrichment | "Pot distilled", "Column distilled", "Triple-distilled", etc. |
| `barrel_type` | TEXT | LLM Enrichment | "New American oak", "Ex-bourbon", "Sherry cask", etc. |
| `finishing_process` | TEXT | LLM Enrichment | "Port wine finish", "Rum cask finish", etc. Null if none |
| `age_years` | INTEGER | LLM Enrichment / OCR | Standardized age statement in years |
| `is_cask_strength` | INTEGER | LLM Enrichment | 0 or 1 |
| `is_single_barrel` | INTEGER | LLM Enrichment | 0 or 1 |
| `is_limited_release` | INTEGER | LLM Enrichment | 0 or 1 |
| `is_organic` | INTEGER | LLM Enrichment | 0 or 1 |
| `is_gluten_free` | INTEGER | LLM Enrichment | 0 or 1 |
| `estimated_price_tier` | TEXT | LLM Enrichment | "value", "standard", "premium", "super-premium", "ultra-premium" |
| `target_market` | TEXT | LLM Enrichment | Brief description of target consumer |
| `packaging_format` | TEXT | LLM Enrichment | "Standard bottle", "Can", "Box set", "Bag-in-box", etc. |
| `parent_company` | TEXT | LLM Enrichment / Lookup | Ultimate parent (e.g., "Diageo", "Constellation Brands") |
| `is_new_brand` | INTEGER | Derived | 0 or 1. First time this brand_name appears |
| `is_line_extension` | INTEGER | Derived | 0 or 1. Same brand, new fanciful_name |
| `is_label_refresh` | INTEGER | Derived | 0 or 1. Same brand+product, new label |
| `label_website` | TEXT | LLM Enrichment | Website URL from label. LLM consolidates/cleans from OCR across all images for this COLA |
| `label_email` | TEXT | LLM Enrichment | Email from label. LLM consolidates from OCR |
| `label_phone` | TEXT | LLM Enrichment | Phone from label. LLM consolidates from OCR |
| `label_social_media` | TEXT | LLM Enrichment | JSON array: ["@handle on Instagram"]. LLM extracts from OCR |
| `label_tagline` | TEXT | LLM Enrichment | Marketing tagline from label |
| `distilled_in` | TEXT | LLM Enrichment | Location where distilled (if different from bottled) |
| `bottled_by` | TEXT | LLM Enrichment | Bottling company if different from brand owner |
| `bottled_in` | TEXT | LLM Enrichment | Bottling location |
| `imported_by` | TEXT | LLM Enrichment | Importer name if applicable |
| `year_established` | INTEGER | LLM Enrichment / OCR | Brand founding year if on label |
| `tasting_notes_raw` | TEXT | OCR Extraction | Exact tasting notes text from label |
| `enrichment_confidence` | TEXT | LLM Enrichment | "high", "medium", "low" |
| `taxonomy_feedback` | TEXT | LLM Enrichment | Feedback if product doesn't fit taxonomy cleanly |
| `prompt_version` | TEXT | System | Version of enrichment prompt used |
| `processing_status` | TEXT | System | Pipeline stage: "raw", "images_downloaded", "ocr_complete", "enriched", "embedded" |
| `enriched_at` | TEXT | System | Timestamp of enrichment completion |

---

## Table: `cola_images` (NEW)

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | INTEGER | Auto | Primary key |
| `ttb_id` | TEXT | FK → colas | Not null |
| `image_id` | TEXT | Derived | Unique. Format: "{ttb_id}-{sequence}" |
| `label_type` | TEXT | Derived | "front", "back", "neck", "strip", "other" |
| `ttb_original_url` | TEXT | TTB | URL on TTB's site |
| `r2_key` | TEXT | System | Cloudflare R2 storage key |
| `r2_thumbnail_key` | TEXT | System | R2 key for web-optimized thumbnail |
| `width` | INTEGER | System | Image width in pixels |
| `height` | INTEGER | System | Image height in pixels |
| `file_size` | INTEGER | System | File size in bytes |
| `ocr_text` | TEXT | Google Vision | Full raw OCR text from image |
| `ocr_abv` | REAL | Regex Parsing | ABV extracted from OCR text |
| `ocr_volume_ml` | INTEGER | Regex Parsing | Volume in mL extracted from OCR text |
| `ocr_proof` | INTEGER | Regex Parsing | Proof extracted from OCR text |
| `ocr_age_years` | INTEGER | Regex Parsing | Age in years extracted from OCR text |
| `ocr_website` | TEXT | Regex Parsing | Website URL extracted from OCR text |
| `ocr_email` | TEXT | Regex Parsing | Email extracted from OCR text |
| `ocr_phone` | TEXT | Regex Parsing | Phone extracted from OCR text |
| `ocr_quality_score` | TEXT | System | "good", "partial", "poor", "failed" |
| `download_status` | TEXT | System | "success", "failed", "timeout", "corrupt", "missing" |
| `created_at` | TEXT | System | Default CURRENT_TIMESTAMP |

### Indexes
- `idx_cola_images_ttb_id` on `ttb_id`
- `idx_cola_images_image_id` unique on `image_id`

---

## Table: `cola_image_barcodes` (NEW)

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | INTEGER | Auto | Primary key |
| `image_id` | TEXT | FK → cola_images | Not null |
| `ttb_id` | TEXT | FK → colas | Denormalized for query convenience |
| `barcode_value` | TEXT | pyzbar | Decoded barcode string |
| `barcode_type` | TEXT | pyzbar | "UPC-A", "UPC-E", "EAN-13", "EAN-8", "QR", etc. |
| `confidence` | REAL | pyzbar | Detection confidence 0-1 |
| `bbox_x` | INTEGER | pyzbar | Bounding box X coordinate |
| `bbox_y` | INTEGER | pyzbar | Bounding box Y coordinate |
| `bbox_width` | INTEGER | pyzbar | Bounding box width |
| `bbox_height` | INTEGER | pyzbar | Bounding box height |
| `created_at` | TEXT | System | Default CURRENT_TIMESTAMP |

### Indexes
- `idx_barcodes_ttb_id` on `ttb_id`
- `idx_barcodes_value` on `barcode_value`

---

## Table: `permittees` (NEW — extends company data from colas table)

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | INTEGER | Auto | Primary key |
| `plant_registry` | TEXT | TTB | Unique. Primary identifier from TTB |
| `company_name` | TEXT | TTB | Legal business name |
| `street` | TEXT | TTB | Street address |
| `city` | TEXT | Derived | Parsed from address |
| `state` | TEXT | TTB | State (2-letter code) |
| `zip_code` | TEXT | Derived | Parsed from address |
| `phone_number` | TEXT | TTB | From COLA filing |
| `contact_person` | TEXT | TTB | From COLA filing |
| `website` | TEXT | External Enrichment | Company website |
| `contact_email` | TEXT | External Enrichment | Primary contact email |
| `parent_company` | TEXT | Lookup / LLM | Ultimate parent company |
| `company_type` | TEXT | LLM Enrichment | "craft_producer", "major_multinational", "importer", "contract_bottler", "negociant" |
| `social_media` | TEXT | External Enrichment | JSON: {"twitter": "...", "instagram": "...", "linkedin": "..."} |
| `is_active` | INTEGER | Derived | 0 or 1. Has filed a COLA in last 365 days |
| `cola_count` | INTEGER | Derived | Total COLAs filed |
| `first_cola_date` | TEXT | Derived | Date of first COLA |
| `last_cola_date` | TEXT | Derived | Date of most recent COLA |
| `categories_filed` | TEXT | Derived | JSON array of distinct commercial_category values |
| `enrichment_status` | TEXT | System | "raw", "website_found", "contacts_enriched", "complete" |
| `created_at` | TEXT | System | Default CURRENT_TIMESTAMP |
| `updated_at` | TEXT | System | |

### Indexes
- `idx_permittees_plant_registry` unique on `plant_registry`
- `idx_permittees_state` on `state`
- `idx_permittees_company_name` on `company_name`

---

## Derived Intelligence Tables (NEW)

### Table: `category_trends`

Recomputed nightly. Tracks filing volume by category over time.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `period_type` | TEXT | "week", "month", "quarter" |
| `period_start` | TEXT | Start date of period |
| `super_category` | TEXT | |
| `commercial_category` | TEXT | |
| `subcategory` | TEXT | |
| `filing_count` | INTEGER | Number of COLAs filed in period |
| `prev_period_count` | INTEGER | Filing count in prior equivalent period |
| `pct_change` | REAL | Percentage change period-over-period |
| `yoy_change` | REAL | Year-over-year percentage change |
| `computed_at` | TEXT | Default CURRENT_TIMESTAMP |

### Table: `new_entrants`

Recomputed nightly. Flags notable new filings.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `ttb_id` | TEXT | FK → colas |
| `plant_registry` | TEXT | FK → permittees |
| `entrant_type` | TEXT | "new_company" (first COLA ever), "new_category" (existing company, new category), "new_brand" (new brand_name) |
| `commercial_category` | TEXT | Category of the new filing |
| `subcategory` | TEXT | |
| `detected_date` | TEXT | Date the new entrant was detected |
| `company_name` | TEXT | Denormalized for convenience |
| `brand_name` | TEXT | Denormalized |
| `computed_at` | TEXT | Default CURRENT_TIMESTAMP |

### Table: `brand_velocity`

Recomputed nightly. Tracks filing frequency acceleration per brand.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `brand_name` | TEXT | |
| `plant_registry` | TEXT | FK → permittees |
| `period_type` | TEXT | "quarter" |
| `current_period_filings` | INTEGER | |
| `prev_period_filings` | INTEGER | |
| `pct_change` | REAL | |
| `is_accelerating` | INTEGER | 0 or 1. Filing rate increasing |
| `computed_at` | TEXT | Default CURRENT_TIMESTAMP |

### Table: `competitive_clusters`

Recomputed weekly. Groups similar products filed in close time windows.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `cluster_id` | TEXT | Groups related filings together |
| `ttb_id` | TEXT | FK → colas |
| `subcategory` | TEXT | |
| `filing_window_days` | INTEGER | Number of days this cluster spans |
| `cluster_size` | INTEGER | Number of filings in cluster |
| `distinct_companies` | INTEGER | Number of unique companies |
| `description` | TEXT | AI-generated cluster summary |
| `computed_at` | TEXT | Default CURRENT_TIMESTAMP |

---

## Content Tables (for Intelligence Query Product)

### Table: `content_items`

Stores all ingested unstructured content (tweets, articles, newsletters, transcripts).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `source_type` | TEXT | "twitter", "article", "newsletter", "transcript", "press_release" |
| `source_name` | TEXT | e.g., "Shanken News Daily", "@username", "Constellation Brands Q3 2025" |
| `source_url` | TEXT | Link to original |
| `author` | TEXT | |
| `title` | TEXT | Article title or null for tweets |
| `content` | TEXT | Full text content |
| `published_at` | TEXT | Publication/post date |
| `ingested_at` | TEXT | Default CURRENT_TIMESTAMP |
| `embedding_status` | TEXT | "pending", "embedded", "failed" |

### Table: `content_chunks`

Content split into chunks for embedding and retrieval.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `content_id` | INTEGER | FK → content_items |
| `chunk_index` | INTEGER | Position within the content item |
| `chunk_text` | TEXT | The text chunk |
| `token_count` | INTEGER | Approximate token count |
| `pinecone_id` | TEXT | Corresponding vector ID in Pinecone |
| `embedded_at` | TEXT | |

### Table: `research_quality`

Logs self-evaluation scores for every deep research query. Used to track output quality over time.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | Primary key |
| `query_text` | TEXT | The user's original question |
| `decomposition_sub_questions` | INTEGER | Number of sub-questions generated |
| `retrieval_results_count` | INTEGER | Total results retrieved across all sources |
| `gaps_identified` | INTEGER | Gaps found in evidence assessment |
| `gaps_filled` | INTEGER | Gaps filled by targeted retrieval |
| `eval_completeness` | INTEGER | 1-5 score |
| `eval_accuracy` | INTEGER | 1-5 score |
| `eval_source_diversity` | INTEGER | 1-5 score |
| `eval_insight_quality` | INTEGER | 1-5 score |
| `eval_forward_view` | INTEGER | 1-5 score |
| `eval_honesty` | INTEGER | 1-5 score |
| `eval_overall` | REAL | Average of dimension scores |
| `eval_pass` | INTEGER | 0 or 1. Overall score ≥ 3.0 |
| `total_latency_ms` | INTEGER | End-to-end query time |
| `total_cost_usd` | REAL | Estimated API cost for the query |
| `prompt_version` | TEXT | Version of synthesis prompts used |
| `created_at` | TEXT | Default CURRENT_TIMESTAMP |

---

## Pinecone Index Configuration

| Setting | Value |
|---|---|
| Index name | `bevalc-intel` |
| Dimensions | 3072 (text-embedding-3-large) |
| Metric | cosine |
| Cloud | AWS |
| Region | us-east-1 |

### Metadata fields stored with each vector
- `source_type`: "cola", "twitter", "article", "newsletter", "transcript"
- `ttb_id`: for COLA-sourced vectors
- `content_id`: for content-sourced vectors
- `chunk_id`: for content chunks
- `commercial_category`: for filtering
- `subcategory`: for filtering
- `author`: for filtering
- `published_date`: for date filtering
- `source_name`: for filtering

---

## D1 Size Considerations

Cloudflare D1 has a max database size of 10GB on the paid plan. With 2M+ COLA records plus enrichment fields, images metadata, and content tables, monitor size carefully. If approaching limits:
- Move `ocr_text` (the largest text field) to R2 as JSON files
- Consider splitting into multiple D1 databases (e.g., one for COLAs, one for content)
- Or migrate to a managed PostgreSQL instance (Neon, Supabase) if D1 limits become a constraint

---

## Migration Strategy

New columns on the `colas` table should be added via D1 migrations. All new columns must be nullable since existing records won't have values until processed through the enrichment pipeline.

```sql
-- Example migration: add enrichment columns
ALTER TABLE colas ADD COLUMN super_category TEXT;
ALTER TABLE colas ADD COLUMN commercial_category TEXT;
ALTER TABLE colas ADD COLUMN subcategory TEXT;
ALTER TABLE colas ADD COLUMN product_description TEXT;
ALTER TABLE colas ADD COLUMN flavor_profile TEXT;
ALTER TABLE colas ADD COLUMN production_method TEXT;
ALTER TABLE colas ADD COLUMN barrel_type TEXT;
ALTER TABLE colas ADD COLUMN finishing_process TEXT;
ALTER TABLE colas ADD COLUMN age_years INTEGER;
ALTER TABLE colas ADD COLUMN is_cask_strength INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_single_barrel INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_limited_release INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_organic INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_gluten_free INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN estimated_price_tier TEXT;
ALTER TABLE colas ADD COLUMN target_market TEXT;
ALTER TABLE colas ADD COLUMN packaging_format TEXT;
ALTER TABLE colas ADD COLUMN parent_company TEXT;
ALTER TABLE colas ADD COLUMN is_new_brand INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_line_extension INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN is_label_refresh INTEGER DEFAULT 0;
ALTER TABLE colas ADD COLUMN label_website TEXT;
ALTER TABLE colas ADD COLUMN label_email TEXT;
ALTER TABLE colas ADD COLUMN label_phone TEXT;
ALTER TABLE colas ADD COLUMN label_social_media TEXT;
ALTER TABLE colas ADD COLUMN label_tagline TEXT;
ALTER TABLE colas ADD COLUMN distilled_in TEXT;
ALTER TABLE colas ADD COLUMN bottled_by TEXT;
ALTER TABLE colas ADD COLUMN bottled_in TEXT;
ALTER TABLE colas ADD COLUMN imported_by TEXT;
ALTER TABLE colas ADD COLUMN year_established INTEGER;
ALTER TABLE colas ADD COLUMN tasting_notes_raw TEXT;
ALTER TABLE colas ADD COLUMN enrichment_confidence TEXT;
ALTER TABLE colas ADD COLUMN taxonomy_feedback TEXT;
ALTER TABLE colas ADD COLUMN prompt_version TEXT;
ALTER TABLE colas ADD COLUMN processing_status TEXT DEFAULT 'raw';
ALTER TABLE colas ADD COLUMN enriched_at TEXT;
```

New tables (`cola_images`, `cola_image_barcodes`, `permittees`, derived tables, content tables) are created fresh.

---

## Field Mapping: LLM Output → D1 Columns

The Claude enrichment prompt outputs JSON. Some fields need conversion before writing to D1:

| Prompt JSON Field | D1 Column | Conversion |
|---|---|---|
| `confidence` | `enrichment_confidence` | Rename only |
| `is_cask_strength` (true/false) | `is_cask_strength` (0/1) | Boolean → INTEGER |
| `is_single_barrel` (true/false) | `is_single_barrel` (0/1) | Boolean → INTEGER |
| `is_limited_release` (true/false) | `is_limited_release` (0/1) | Boolean → INTEGER |
| `is_organic` (true/false) | `is_organic` (0/1) | Boolean → INTEGER |
| `is_gluten_free` (true/false) | `is_gluten_free` (0/1) | Boolean → INTEGER |
| `flavor_profile` (JSON array) | `flavor_profile` (TEXT) | JSON.stringify() |
| `label_social_media` (JSON array) | `label_social_media` (TEXT) | JSON.stringify() |

All other fields map 1:1 by name and type.

### Data Flow for Contact Fields

Contact information flows through two stages:
1. **Stage 2 (OCR)**: Raw extraction via regex → stored per-image on `cola_images` table (`ocr_website`, `ocr_email`, `ocr_phone`)
2. **Stage 4 (LLM)**: Claude sees the raw OCR text from all images, consolidates and cleans the best values → stored on `colas` table (`label_website`, `label_email`, `label_phone`)

The per-image OCR fields are the raw source. The `colas` table fields are the cleaned, authoritative values.
