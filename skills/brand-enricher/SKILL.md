# Brand Enricher Skill

## Overview
Find official websites for beverage alcohol brands by querying D1 for company context and then searching the web.

## When to Invoke
Automatically invoke this skill when the user:
- Asks to "find the website for [brand]"
- Says "look up [brand] website"
- Asks "what's the website for [brand]"
- Says "enrich [brand]" or "get brand info for [brand]"
- Mentions finding official brand URLs/links
- Asks to "find websites for these brands: ..."

## Workflow

### Step 1: Query D1 for Context (REQUIRED)
Always query D1 first to get company name and category:

```bash
curl -s "https://bevalcintel.com/api/search?q=BRAND_NAME&limit=5" | jq '.results[] | {brand_name, company_name, class_type_code}'
```

Or via D1 API:
```sql
SELECT DISTINCT brand_name, company_name, class_type_code
FROM colas
WHERE brand_name LIKE '%BRAND_NAME%'
LIMIT 5;
```

### Step 2: Web Search with All Context
Search using brand + company + category together:
- Primary: `"{brand}" "{company}" {category}`
- Fallback: `"{company}" official website`

### Step 3: Score and Verify
- Prefer domains containing brand or company name
- Skip retailers (drizly, totalwine, amazon, etc.)
- Verify with WebFetch if uncertain

### Step 4: Report Result
```
Brand: {brand_name}
Company: {company_name} (from D1)
Category: {category}
Website: {url}
Confidence: High/Medium/Low
Notes: {explanation}
```

## Key Insight
Including the company name from D1 dramatically improves search accuracy, especially for obscure brands. A brand like "Wonky Ear" alone yields poor results, but "Wonky Ear Sideshow Spirits whiskey" finds the distillery immediately.

## Multi-Company Brands
The same brand name can be filed by multiple companies (e.g., WYATT EARP is filed by World Whiskey Society, AIKO Importers, and Henebery Spirits). When enriching:

1. **Check for multiple filers**: Query D1 for all unique (brand_name, company_name) pairs
2. **Enrich each pairing separately**: Each company gets their own website lookup
3. **Don't skip seen brands**: Always check the brand+company combo, not just the brand
4. **Store appropriately**:
   - Use `brand_websites` for the primary producer's product page
   - Use `company_websites` for company-level sites (fallback)

## Examples

**User:** "Find the website for Wonky Ear"
1. Query D1 → Company: Sideshow Spirits, Category: AMERICAN SINGLE MALT WHISKEY
2. Search: "Wonky Ear" "Sideshow Spirits" whiskey
3. Result: https://www.sideshowspirits.com/

**User:** "Get me websites for Carroll Noir and Casa Huitzila"
1. Query D1 for each brand
2. Search with company names
3. Return results for each

## Retailers to Skip
- drizly.com, totalwine.com, wine.com, reservebar.com
- amazon.com, walmart.com, target.com, costco.com
- wine-searcher.com, vivino.com, untappd.com

## Confidence Levels
- **High**: Domain contains brand/company name, verified via WebFetch
- **Medium**: Found on parent company site, product page exists
- **Low**: Only social media or third-party references found
