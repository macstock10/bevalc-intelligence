# Company Normalization & Classification Flow

This document explains how company names are normalized, how aliases are created,
and how NEW_COMPANY/NEW_BRAND/NEW_SKU signals are classified in the current pipeline.

## Goals

- Prevent false NEW_COMPANY signals caused by minor name variants (LLC/Inc, punctuation, commas).
- Keep classification consistent across daily/weekly pipelines.
- Ensure data remains correct going forward without manual aliasing.

## Ingestion + Classification (Daily/Weekly)

1. **Scrape**: `scripts/weekly_update.py` (run daily via GitHub Actions)
2. **Sync**: Records inserted into D1 (`colas`)
3. **Alias Enrichment**: `add_new_companies()` runs automatically
   - Inserts company rows and alias variants into `company_aliases`
4. **Classification**: `classify_new_records()` in `weekly_update.py`
   - Uses **normalized alias map** to resolve company_id
   - Applies NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE

## Normalization Logic

Normalization for matching uses `normalize_company_for_match()` in:

- `scripts/lib/d1_utils.py`

Rules:
- Uppercase
- Replace `&` with `AND`
- Remove punctuation
- Collapse whitespace
- Strip common legal suffixes (LLC, INC, LTD, etc.)
- If comma-separated parts normalize to the same value, collapse to one
- Collapse exact duplicated halves (e.g., `A B A B` → `A B`)

This normalized key is used for both alias creation and classification lookup.

## Automatic Alias Variants

`add_new_companies()` now generates and stores multiple alias variants:

- Raw company_name
- Comma‑separated parts
- Normalized variants

This ensures future filings like:

- `JACKS BOURBON`
- `JACKS BOURBON, LLC`
- `JACKS BOURBON LLC`

all map to the same company_id.

## One‑Time Backfill Steps (Completed)

1. **Alias Variant Backfill**
   - Script: `scripts/backfill_company_alias_variants.py`
   - Adds normalized aliases for existing companies

2. **Normalized Duplicate Merge**
   - Script: `scripts/merge_normalized_company_duplicates.py`
   - Merges duplicate company_ids that normalize to the same key

3. **Reclassification**
   - Script: `scripts/batch_classify.py`
   - Recomputes signals across all records

## Remaining Edge Cases

Some NEW_COMPANY records may still map to multiple company_ids under the same normalized key.
For those, we use:

- Script: `scripts/merge_remaining_new_company_duplicates.py`

This merges remaining duplicates and should be followed by:

```
python scripts/batch_classify.py
```

## Audit-Only Duplicate Report

To evaluate edge cases without merging anything, run:

```
python scripts/audit_company_duplicates.py
```

This creates two CSVs in `logs/`:
- `auto_merge_candidates_YYYYMMDD.csv`
- `review_needed_YYYYMMDD.csv`

The report uses normalized name + address/phone/brand overlap to recommend
safe merges vs manual review.

## Verification Queries

Use these to validate the system:

```sql
-- Recent suspicious NEW_COMPANY (should be 0)
SELECT COUNT(*)
FROM colas c
JOIN company_aliases ca ON UPPER(c.company_name) = UPPER(ca.raw_name)
WHERE c.signal = 'NEW_COMPANY'
AND c.approval_date >= date('now', '-30 days');
```

```sql
-- Signal distribution
SELECT signal, COUNT(*) AS cnt
FROM colas
GROUP BY signal
ORDER BY cnt DESC;
```

## Files to Know

- `scripts/lib/d1_utils.py` (normalization + alias creation)
- `scripts/weekly_update.py` (daily pipeline + classification)
- `scripts/daily_sync.py` (manual daily pipeline)
- `scripts/batch_classify.py` (full reclassification)
- `scripts/backfill_company_alias_variants.py` (alias backfill)
- `scripts/merge_normalized_company_duplicates.py` (safe duplicate merge)
- `scripts/merge_remaining_new_company_duplicates.py` (final duplicate merge)
