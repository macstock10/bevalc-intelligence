# /brand-enricher

Find official websites for beverage alcohol brands using web search.

## Description
Searches the web to find and verify official brand websites. Uses intelligent search strategies and verification to distinguish official sites from retailers.

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

### 1. Generate Search Variants
Clean and vary the brand name:
- Remove trademark symbols (®, ™)
- Try with/without apostrophes: "Tito's" → "Titos"
- Try with/without spaces/hyphens

### 2. Web Search
Use WebSearch with these queries (try 2-3):
1. `"{brand_name}" official website`
2. `"{brand_name}" {category} distillery OR winery OR brewery`
3. `site:linkedin.com "{brand_name}" beverage alcohol`

### 3. Score Results
For each result, evaluate:

**Positive signals:**
- Domain contains brand name (e.g., titosvodka.com) → HIGH confidence
- Title/snippet prominently mentions brand
- Page has age gate (common for alcohol brands)
- Has "About Us" or "Our Story" content

**Negative signals (retailers to skip):**
- drizly.com, totalwine.com, wine.com, reservebar.com
- amazon.com, walmart.com, target.com, costco.com
- wine-searcher.com, vivino.com, untappd.com
- Wikipedia, news articles, social media only

### 4. Verify Top Candidate
Use WebFetch on the best URL to confirm:
- Brand name appears on page
- Looks like official site (not retailer listing)
- Has product info, company info, or contact details

### 5. Report Result
Output format:
```
Brand: {brand_name}
Website: {url} (or "NOT FOUND")
Confidence: High/Medium/Low
Source: WebSearch
Notes: {brief explanation}
```

### 6. Save to D1 (if --save)
```sql
INSERT OR REPLACE INTO brand_websites
(brand_name, website_url, confidence, source, verified_at, notes, status)
VALUES (?, ?, ?, 'websearch', datetime('now'), ?, 'found')
```

## D1 Schema
```sql
CREATE TABLE IF NOT EXISTS brand_websites (
    brand_name TEXT PRIMARY KEY,
    website_url TEXT,
    confidence TEXT,
    source TEXT,
    verified_at TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending'
);
```

## Examples

### Found with High Confidence
```
Brand: Tito's Handmade Vodka
Website: https://www.titosvodka.com
Confidence: High
Source: WebSearch - domain contains brand, official product pages found
Notes: Age gate present, Austin TX origin confirmed on About page
```

### Not Found (Private Label)
```
Brand: Kirkland Signature
Website: NOT FOUND
Confidence: N/A
Source: WebSearch
Notes: Private label brand (Costco), no standalone website
Status: not_found
```

### Needs Review
```
Brand: Old Crow
Website: https://www.jimbeam.com/en-us/products/old-crow-bourbon
Confidence: Medium
Source: WebSearch
Notes: Brand owned by Beam Suntory, no standalone site. Listed on parent company website.
```
