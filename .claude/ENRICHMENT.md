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

### Order Within Each Date
For each date, enrich in this order:
1. NEW_COMPANY
2. NEW_BRAND
3. NEW_SKU
4. REFILE

### Example Flow
If most recent scrape has dates 01/08, 01/07, 01/06:

```
01/08/2026: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE
01/07/2026: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE
01/06/2026: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE
(continue backwards through all dates)
```

### Query to Get Brands
```sql
SELECT DISTINCT brand_name, company_name, class_type_code, signal, approval_date
FROM colas
WHERE signal IN ('NEW_COMPANY', 'NEW_BRAND', 'NEW_SKU', 'REFILE')
  AND brand_name NOT IN (SELECT brand_name FROM brand_websites)
ORDER BY
  substr(approval_date, 7, 4) || substr(approval_date, 1, 2) || substr(approval_date, 4, 2) DESC,
  CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 END
LIMIT 30
```

This orders by date descending first, then by signal priority within each date.

---

## Search Pattern (CRITICAL - ALWAYS FOLLOW)

**ALWAYS search with ALL THREE components (NO quotation marks):**

```
[Brand Name] [Category] [Company Name]
```

**Example from database:**
- brand_name: STELLA DI CAMPALTO
- class_type_code: TABLE RED WINE
- company_name: Oenoteca, A&N Fine Wines LLC

**Search query:** `Stella Di Campalto wine Oenoteca`

**WHY THIS MATTERS:**
- Same brand names can exist from DIFFERENT companies
- Example: "FIELD & STREAM" filed by BOTH Drowned Lands Brewery AND Sugarlands Distilling
- You MUST verify the website matches the SPECIFIC company in the filing

**Category simplification:**
| class_type_code | Search term |
|-----------------|-------------|
| TABLE RED WINE, TABLE WHITE WINE | wine |
| BEER, ALE, LAGER, MALT BEVERAGES | beer |
| VODKA, VODKA SPECIALTIES | vodka |
| BOURBON WHISKY, BLENDED BOURBON | whiskey |
| BRANDY, FRUIT BRANDY | brandy |
| GIN, DRY GIN | gin |
| RUM, LIGHT RUM | rum |
| TEQUILA, MEZCAL | tequila |
| LIQUEURS, CORDIALS | liqueur |
| SAKE | sake |
| HONEY BASED TABLE WINE | mead |

**Search variations (try in order if first fails):**
1. `Brand Name Category Company Name` (ALWAYS TRY FIRST)
2. `Company Name Category official website`
3. `Brand Name Company Name`
4. `Company Name distillery/winery/brewery`

**NEVER save a website without verifying it matches the filing company.**

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
1. **Save to D1 with NOT_FOUND flag** so the modal shows we looked:
   ```bash
   cd worker && npx wrangler d1 execute bevalc-colas --remote --command="INSERT OR REPLACE INTO brand_websites (brand_name, website_url, confidence, verified_at, notes) VALUES ('BRAND NAME', 'NOT_FOUND', 'none', datetime('now'), 'Reason not found')"
   ```
2. Include reason in notes field (e.g., "new distillery, no website yet")
3. Move on to next brand (don't waste time)

Common reasons for not finding:
- New/small producer without web presence
- Import brand with foreign-only website
- Restaurant/bar private label
- Contract brewer with no public brand page

---

## Quick Reference Commands

**Get brands needing enrichment (ALWAYS USE THIS):**
```bash
cd worker && npx wrangler d1 execute bevalc-colas --remote --command="SELECT DISTINCT brand_name, company_name, class_type_code, signal, approval_date FROM colas WHERE signal IN ('NEW_COMPANY', 'NEW_BRAND', 'NEW_SKU', 'REFILE') AND brand_name NOT IN (SELECT brand_name FROM brand_websites) ORDER BY substr(approval_date, 7, 4) || substr(approval_date, 1, 2) || substr(approval_date, 4, 2) DESC, CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 END LIMIT 30"
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
