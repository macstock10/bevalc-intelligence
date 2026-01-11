# Brand Enrichment Process

This document describes how to enrich brands with website URLs using Claude.

---

## When to Run Enrichment

Run enrichment after:
1. Weekly update (Friday 9pm ET) - `weekly_update.py` outputs `logs/needs_enrichment.json`
2. Manual request from user
3. Backfill historical data

---

## Enrichment Hierarchy (Priority Order)

**CRITICAL: Always start from the most recent approval_date in the database.**

### Step 1: Query Most Recent Records
```sql
SELECT brand_name, company_name, class_type_code, signal, approval_date
FROM colas
WHERE signal IN ('NEW_COMPANY', 'NEW_BRAND')
  AND brand_name NOT IN (SELECT brand_name FROM brand_websites)
ORDER BY
  substr(approval_date, 7, 4) || substr(approval_date, 1, 2) || substr(approval_date, 4, 2) DESC,
  CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 END
LIMIT 50
```

### Step 2: Enrich in This Order
1. **Most recent date first** (e.g., if 01/08/2026 exists, do those before 01/07/2026)
2. Within each date: **NEW_COMPANY** before **NEW_BRAND**
3. Then work backwards chronologically
4. Backfill older records last

---

## Search Pattern

For each brand, search using this format:

```
"[Brand Name]" [Category] "[Company Name]"
```

**Example:**
- Brand: STELLA DI CAMPALTO
- Category: TABLE RED WINE (from class_type_code)
- Company: Oenoteca, A&N Fine Wines LLC

Search: `"Stella Di Campalto" Wine "Oenoteca, A&N Fine Wines"`

**Category simplification:** Use the simple category name:
- TABLE RED WINE, TABLE WHITE WINE -> Wine
- BEER, ALE, LAGER -> Beer
- VODKA 80-89 PROOF -> Vodka
- BOURBON WHISKY, BLENDED BOURBON -> Bourbon/Whiskey
- etc.

If no results, try variations:
1. Brand name + category only
2. Company name + category only
3. Brand name + company name (no category)
4. Just company name + "distillery/winery/brewery"

---

## Category Mapping (class_type_code)

| Code | Category |
|------|----------|
| BWN | Wine |
| BWC | Wine Cooler |
| DSS | Spirits |
| DSW | Whiskey |
| DSG | Gin |
| DSV | Vodka |
| DSR | Rum |
| DST | Tequila |
| DSB | Brandy |
| MLB | Beer |
| MLA | Ale |
| MLL | Lager |

---

## Saving to D1

Use wrangler CLI to insert into `brand_websites` table:

```bash
cd worker && npx wrangler d1 execute bevalc-colas --remote --command="INSERT OR REPLACE INTO brand_websites (brand_name, website_url, confidence, verified_at, notes) VALUES ('BRAND NAME', 'https://website.com', 'high', datetime('now'), 'Enriched via Claude search')"
```

**Table Schema:**
| Column | Type | Notes |
|--------|------|-------|
| brand_name | TEXT | Primary key (exact match from colas table) |
| website_url | TEXT | Full URL with https:// |
| confidence | TEXT | 'high', 'medium', or 'low' |
| verified_at | TEXT | datetime('now') |
| notes | TEXT | Source/method of enrichment |

---

## Progress Logging

Track progress in `scripts/logs/enrichment_progress.json`:

```json
{
  "last_run": "2026-01-11T18:15:00Z",
  "status": "in_progress",
  "total_to_enrich": 50,
  "completed": 14,
  "brands_enriched": [
    {"brand": "BRAND NAME", "website": "https://...", "signal": "NEW_COMPANY"}
  ],
  "brands_not_found": [
    {"brand": "BRAND NAME", "company": "Company Name", "signal": "NEW_COMPANY"}
  ],
  "remaining_brands": ["BRAND1", "BRAND2"]
}
```

---

## Confidence Levels

- **high**: Direct match on official company website, brand clearly listed
- **medium**: Found on distributor site or secondary source
- **low**: Inferred from search results, not 100% certain

---

## Brands Not Found

If a brand cannot be found after multiple search attempts:
1. Add to `brands_not_found` in progress log
2. Include company name for future reference
3. Move on to next brand (don't waste time)

Common reasons for not finding:
- New/small producer without web presence
- Import brand with foreign-only website
- Restaurant/bar private label
- Contract brewer with no public brand page

---

## Quick Reference Commands

**Get brands needing enrichment:**
```bash
cd worker && npx wrangler d1 execute bevalc-colas --remote --command="SELECT brand_name, company_name, class_type_code, signal FROM colas WHERE signal IN ('NEW_COMPANY', 'NEW_BRAND') AND brand_name NOT IN (SELECT brand_name FROM brand_websites) ORDER BY CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 END LIMIT 50"
```

**Check if brand already enriched:**
```bash
cd worker && npx wrangler d1 execute bevalc-colas --remote --command="SELECT * FROM brand_websites WHERE brand_name = 'BRAND NAME'"
```

---

## Automation (Future)

Daily enrichment should run after `daily-sync.yml` completes:
1. Query D1 for unenriched NEW_COMPANY and NEW_BRAND records
2. Use Claude to search and enrich each brand
3. Save results to brand_websites table
4. Log progress to enrichment_progress.json

Currently: Manual process triggered by user request.
