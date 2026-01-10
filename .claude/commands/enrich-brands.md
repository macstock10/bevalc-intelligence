# Enrich Brands Command

Automatically find and save websites for new brands from the weekly sync.

## Trigger
User says `/enrich-brands` or "enrich the new brands"

## Workflow

1. **Check for pending enrichments**
   ```bash
   cat logs/needs_enrichment.json
   ```
   If file doesn't exist or is empty, report "No brands need enrichment" and stop.

2. **For each brand in the list:**
   - Query D1 to confirm no existing brand_website entry
   - Search: `"{brand_name}" "{company_name}" {class_type_code} official website`
   - Skip retailers (drizly, totalwine, amazon, wine-searcher, vivino, etc.)
   - Pick the best official website result

3. **Save to D1:**
   ```bash
   cd worker && npx wrangler d1 execute bevalc-colas --remote --command="INSERT OR REPLACE INTO brand_websites (brand_name, website_url, confidence, verified_at) VALUES ('BRAND', 'https://...', 'Medium', datetime('now'))"
   ```

4. **Report progress:**
   - Show each brand as it's processed
   - Format: `[X/Total] BRAND NAME -> website.com ✓` or `-> N/A (not found)`

5. **Summary:**
   - Total processed
   - Successful matches
   - Not found

## Multi-Company Brands

If the same brand is filed by multiple companies:
1. Note this in output
2. Use company_websites instead of brand_websites
3. Each company gets their own website entry

## Output Format

```
Enriching 25 new brands...

[1/25] AUTEUR WINES (Auteur Wines LLC) -> auteurwines.com ✓
[2/25] ARCHETYPE DISTILLERY (Archetype Distillery LLC) -> archetypedistillery.com ✓
[3/25] OBSCURE BRAND (Unknown Co) -> N/A (not found)
...

Complete: 22 found, 3 not found
```

## When to Run

Run this command **Friday morning before 2pm ET** (after Thursday 10pm weekly sync, before Friday 2pm email report deadline).
