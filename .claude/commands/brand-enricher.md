# /brand-enricher

Find official websites for beverage alcohol brands using web search.

## Description
Searches the web to find and verify official brand websites. **Always queries D1 first** to get company name and category, then searches with all three pieces for maximum accuracy.

## Usage
```
/brand-enricher <brand-name>
/brand-enricher "Tito's Handmade Vodka"
/brand-enricher "Maker's Mark" --save
```

## Arguments
| Argument | Description |
|----------|-------------|
| `brand-name` | The brand name to search for |

## Options
| Flag | Description |
|------|-------------|
| `--save` | Save result to D1 brand_websites table |
| `--verbose` | Show detailed search process |

## Workflow

### 1. Query D1 for Brand Context (REQUIRED)
**Always query D1 first** to get company name and category:
```sql
SELECT DISTINCT
    c.brand_name,
    c.company_name,
    c.class_type_code
FROM colas c
WHERE c.brand_name LIKE '%{brand_name}%'
LIMIT 5;
```

This step is critical - searching with company name dramatically improves results for obscure brands.

### 2. Generate Search Variants
Clean and vary the brand name:
- Remove trademark symbols (®, ™)
- Try with/without apostrophes: "Tito's" → "Titos"
- Try with/without spaces/hyphens

### 3. Web Search (with Company Name)
Use WebSearch with **brand + company + category** together:
1. `"{brand_name}" "{company_name}" {category}` (PRIMARY - highest accuracy)
2. `"{brand_name}" {category} distillery OR winery OR brewery`
3. `"{company_name}" official website {category}`

**Example:** For "Wonky Ear" with company "Sideshow Spirits" and category "AMERICAN SINGLE MALT":
- Search: `"Wonky Ear" "Sideshow Spirits" whiskey`
- Result: https://www.sideshowspirits.com/

### 4. Score Results
For each result, evaluate:

**Positive signals:**
- Domain contains brand OR company name → HIGH confidence
- Title/snippet prominently mentions brand
- Page has age gate (common for alcohol brands)
- Has "About Us" or "Our Story" content

**Negative signals (retailers to skip):**
- drizly.com, totalwine.com, wine.com, reservebar.com
- amazon.com, walmart.com, target.com, costco.com
- wine-searcher.com, vivino.com, untappd.com
- Wikipedia, news articles, social media only

### 5. Verify Top Candidate
Use WebFetch on the best URL to confirm:
- Brand name OR company name appears on page
- Looks like official site (not retailer listing)
- Has product info, company info, or contact details

### 6. Report Result
Output format:
```
Brand: {brand_name}
Company: {company_name} (from D1)
Category: {category}
Website: {url} (or "NOT FOUND")
Confidence: High/Medium/Low
Source: WebSearch
Notes: {brief explanation}
```

### 7. Save to D1 (if --save)
```sql
INSERT OR REPLACE INTO brand_websites
(brand_name, company_name, website_url, confidence, source, verified_at, notes, status)
VALUES (?, ?, ?, ?, 'websearch', datetime('now'), ?, 'found')
```

## D1 Schema
```sql
CREATE TABLE IF NOT EXISTS brand_websites (
    brand_name TEXT PRIMARY KEY,
    company_name TEXT,
    website_url TEXT,
    confidence TEXT,
    source TEXT,
    verified_at TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending'
);
```

## Examples

### Found with High Confidence (Common Brand)
```
Brand: Tito's Handmade Vodka
Company: Fifth Generation Inc (from D1)
Category: VODKA
Website: https://www.titosvodka.com
Confidence: High
Source: WebSearch - domain contains brand, official product pages found
Notes: Age gate present, Austin TX origin confirmed on About page
```

### Found with High Confidence (Obscure Brand)
```
Brand: Carroll Noir
Company: True Standard Distilling Company (from D1)
Category: RUM SPECIALTIES
Website: https://truestandarddistilling.com/
Confidence: High
Source: WebSearch - company website found, rum distillery confirmed
Notes: Frederick, MD distillery. Brand may be new/upcoming product.
```

### Found - Parent Company Site
```
Brand: The 12th Spice
Company: Jacob Rieger & Company (from D1)
Category: BOURBON WHISKY
Website: https://www.jriegerco.com/our-spirits/bourbon
Confidence: High
Source: WebSearch - brand is product line from parent distillery
Notes: Kansas City distillery, brand listed under bourbon products
```

### Not Found (Private Label)
```
Brand: Kirkland Signature
Company: Costco Wholesale Corporation (from D1)
Category: Various
Website: NOT FOUND
Confidence: N/A
Source: WebSearch
Notes: Private label brand (Costco), no standalone website
Status: not_found
```
