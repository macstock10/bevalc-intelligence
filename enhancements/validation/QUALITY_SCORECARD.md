# BevAlc Intelligence — Quality Scorecard

## Purpose

Track accuracy metrics at every pipeline stage. Update this document after each batch run and validation review.

---

## Image Download Metrics

| Metric | Target | Actual | Date | Notes |
|---|---|---|---|---|
| COLAs with ≥1 image | 95%+ | — | — | |
| Images per COLA (avg) | ~2 | — | — | |
| Download success rate | 98%+ | — | — | |
| Timeout rate | <1% | — | — | |
| Corrupt image rate | <0.5% | — | — | |
| Missing image rate (404) | <2% | — | — | |

---

## OCR Metrics

| Metric | Target | Actual | Date | Notes |
|---|---|---|---|---|
| OCR quality "good" | 70%+ | — | — | 50+ chars clean text |
| OCR quality "partial" | <20% | — | — | 20-50 chars or garbled |
| OCR quality "poor" | <5% | — | — | <20 chars |
| OCR quality "failed" | <5% | — | — | Empty/noise only |

### Field Extraction Hit Rates (from OCR text)

| Field | Target | Actual | Date | Notes |
|---|---|---|---|---|
| ABV | 90%+ | — | — | When present on label |
| Volume (mL) | 90%+ | — | — | |
| Proof | 85%+ | — | — | When present on label |
| Age statement | 85%+ | — | — | When present on label |
| Website URL | 85%+ | — | — | When present on label |
| Email | 80%+ | — | — | When present on label |
| Phone | 75%+ | — | — | When present on label |

---

## Barcode Extraction Metrics

| Metric | Target | Actual | Date | Notes |
|---|---|---|---|---|
| COLAs with ≥1 barcode | 30-50% | — | — | |
| Valid check digit rate | 95%+ | — | — | Of decoded barcodes |
| False positive rate | <2% | — | — | |

---

## LLM Enrichment Accuracy

### Classification Accuracy (manual review of N records)

| Field | Target | Actual | N Reviewed | Date | Prompt Version |
|---|---|---|---|---|---|
| super_category | 99%+ | — | — | — | — |
| commercial_category | 95%+ | — | — | — | — |
| subcategory | 90%+ | — | — | — | — |
| estimated_price_tier | 80%+ | — | — | — | — |
| is_cask_strength | 95%+ | — | — | — | — |
| is_single_barrel | 95%+ | — | — | — | — |
| parent_company | 85%+ | — | — | — | — |

### Null Rates (full batch)

| Field | Expected Null % | Actual Null % | Date | Notes |
|---|---|---|---|---|
| super_category | <1% | — | — | Almost everything should classify |
| commercial_category | <2% | — | — | |
| subcategory | <5% | — | — | |
| product_description | <10% | — | — | |
| flavor_profile | 50-70% | — | — | Only present when label has tasting notes |
| production_method | 60-80% | — | — | Rarely on labels |
| barrel_type | 70-85% | — | — | Mostly spirits |
| age_years | 80-90% | — | — | Only aged products |
| estimated_price_tier | <15% | — | — | Should be inferable for most products |
| parent_company | 40-60% | — | — | Hard to determine for small producers |

### Distribution Checks (full batch)

| Category | Expected % of Total | Actual % | Date | Plausible? |
|---|---|---|---|---|
| Wine (all) | 40-50% | — | — | |
| Spirits (all) | 30-40% | — | — | |
| Beer & FMB (all) | 10-20% | — | — | |

### Taxonomy Feedback

| Batch Run | Records with Feedback | Top Issues | Actions Taken |
|---|---|---|---|
| — | — | — | — |

### Consistency Checks

| Check | Expected | Actual | Date | Notes |
|---|---|---|---|---|
| Same brand → same super_category | 99%+ consistency | — | — | |
| Same brand + fanciful → same subcategory | 95%+ consistency | — | — | |
| ABV matches ocr_abv (±0.5%) | 95%+ when both present | — | — | |

---

## Overall Pipeline Health

| Metric | Value | Date |
|---|---|---|
| Total COLAs in D1 | — | — |
| COLAs at "raw" status | — | — |
| COLAs at "images_downloaded" | — | — |
| COLAs at "ocr_complete" | — | — |
| COLAs at "enriched" | — | — |
| COLAs at "embedded" | — | — |
| Backlog (records waiting) | — | — |
| Daily throughput | — | — |
| Estimated days to complete backfill | — | — |

---

## Review Log

| Date | Reviewer | Records Reviewed | Key Findings | Actions |
|---|---|---|---|---|
| — | — | — | — | — |
