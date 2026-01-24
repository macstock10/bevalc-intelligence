# LinkedIn Category Analysis Post

Deep dive on a specific category's brand creation trends with multi-year context.

---

## Template Structure

### Hook (First 2 lines)
```
[Category] brand launches are [up/down] [X]% year-over-year.

[One sentence on the multi-year trajectory or why this matters]
```

### Body

**The Multi-Year Picture**
| Year | New Brands | Change |
|------|------------|--------|
| 2026 (pace) | [X] | - |
| 2025 | [X] | [+/-X]% |
| 2024 | [X] | [+/-X]% |
| 2023 | [X] | [+/-X]% |

**Who's Driving Innovation**
Top 5 brand launchers in [Category] (2026 YTD):
1. [Company] - [X] new brands ([X]% share)
2. [Company] - [X] new brands
3. [Company] - [X] new brands
4. [Company] - [X] new brands
5. [Company] - [X] new brands

**Market Structure**
Top 5 share of new brands: [X]% (vs [X]% in 2024)
[One sentence on whether market is consolidating or fragmenting]

**New Market Entrants**
[X] companies launched their first [Category] brand in 2026.
Notable: [Company 1], [Company 2]

**Seasonal Pattern**
[1-2 sentences on how this period compares to typical seasonal patterns - Q4 holiday rush, summer slowdown, etc.]

**What This Means for the Category**
[2-3 paragraphs of professional analysis on what the brand creation data suggests about the category's trajectory, competitive dynamics, and direction. Include:
- Is growth accelerating or decelerating?
- Is innovation coming from incumbents or new entrants?
- What subcategories or trends are driving activity?
- What should industry observers watch for?]

---

Full [Category] data at bevalcintel.com/category/[slug]

---

## Writing Guidelines

### Tone
- Analytical, suitable for trade publication
- Support assertions with data
- Avoid promotional language about any company
- Professional vocabulary appropriate for industry executives

### Language Rules
- Say "brand launches" not "filings"
- Say "innovation activity" not "filing activity"
- Say "market entrants" not "first-time filers"
- Focus on what companies are CREATING, not administrative processes

### Category Selection
Prioritize categories with:
- Clear multi-year trend (up or down 10%+)
- Broad interest (whiskey, tequila, RTD vs. niche categories)
- Recent news relevance
- Sufficient data volume for meaningful analysis

### Analysis Depth
- Multi-year comparison is minimum (3-5 years when available)
- Include market concentration analysis
- Note new entrants vs. established player activity
- Reference seasonal patterns when relevant
- Connect to broader industry trends

---

## Example Post

```
American whiskey brand launches are up 23% year-over-year.

The category has grown every year since 2020, with no signs of slowing.

The Multi-Year Picture
| Year | New Brands | Change |
|------|------------|--------|
| 2026 (pace) | 19,800 | +9% |
| 2025 | 18,234 | +23% |
| 2024 | 14,821 | +10% |
| 2023 | 13,456 | +8% |

Who's Driving Innovation
Top 5 brand launchers in American Whiskey (2026 YTD):
1. Brown-Forman - 312 new brands (8.2% share)
2. Sazerac - 276 new brands (7.3%)
3. Heaven Hill - 234 new brands (6.2%)
4. Beam Suntory - 198 new brands (5.2%)
5. Diageo - 167 new brands (4.4%)

Market Structure
Top 5 share of new brands: 31.3% (vs 38.1% in 2024)
The market is fragmenting as craft distillers gain share.

New Market Entrants
156 companies launched their first American whiskey brand in 2025.
Notable: Castle & Key, Widow Jane, Starlight Distillery

Seasonal Pattern
January brand creation is 8% above the 3-year average for this period, suggesting strong momentum heading into spring distribution cycles.

What This Means for the Category
American whiskey's sustained growth reflects durable consumer demand, but the composition of innovation is shifting. Major producers are increasingly focused on line extensions and variants - 72% of Brown-Forman's launches were SKU extensions of existing brands.

Meanwhile, new entrants are driving true brand creation. Of the 156 first-time whiskey launchers in 2025, 67% introduced entirely new brand names rather than contract-distilled products under established labels.

The fragmenting market share (top 5 down 7 points vs. 2024) suggests craft and premium segments are gaining traction. Watch for consolidation activity as major players look to acquire proven craft brands.

---

Full American Whiskey data at bevalcintel.com/category/whiskey/2025
```

---

## Data Requirements

```sql
-- Multi-year brand creation trend
SELECT year, COUNT(*) as new_brands
FROM colas
WHERE signal = 'NEW_BRAND'
  AND category = 'Whiskey'
  AND year >= 2022
GROUP BY year
ORDER BY year DESC

-- Top brand launchers in category
SELECT company_name, COUNT(*) as new_brands
FROM colas
WHERE signal = 'NEW_BRAND'
  AND category = 'Whiskey'
  AND year = 2026
GROUP BY company_name
ORDER BY new_brands DESC
LIMIT 10

-- Market concentration comparison
SELECT year,
  SUM(CASE WHEN rn <= 5 THEN new_brands ELSE 0 END) as top_5_brands,
  SUM(new_brands) as total_brands
FROM (
  SELECT year, company_name, COUNT(*) as new_brands,
    ROW_NUMBER() OVER (PARTITION BY year ORDER BY COUNT(*) DESC) as rn
  FROM colas
  WHERE signal = 'NEW_BRAND' AND category = 'Whiskey'
  GROUP BY year, company_name
)
WHERE year >= 2024
GROUP BY year

-- First-time brand launchers in category this year
WITH this_year AS (
  SELECT DISTINCT company_name FROM colas
  WHERE year = 2026 AND signal = 'NEW_BRAND' AND category = 'Whiskey'
),
prior_years AS (
  SELECT DISTINCT company_name FROM colas
  WHERE year < 2026 AND signal = 'NEW_BRAND' AND category = 'Whiskey'
)
SELECT COUNT(*) as new_entrants FROM this_year ty
LEFT JOIN prior_years py ON ty.company_name = py.company_name
WHERE py.company_name IS NULL

-- Monthly pattern for seasonal analysis
SELECT year, month, COUNT(*) as new_brands
FROM colas
WHERE signal = 'NEW_BRAND'
  AND category = 'Whiskey'
  AND year >= 2024
GROUP BY year, month
ORDER BY year DESC, month DESC
```

---

## Posting Frequency
- 1 per week, rotating categories
- Schedule: Whiskey, Tequila, RTD, Wine, Beer, Gin (6-week rotation)
- Adjust based on news relevance

---

## CRITICAL: Data Verification

Before posting, verify:
1. Multi-year trend numbers are accurate
2. Market share percentages are calculated correctly
3. New entrant counts use consistent methodology
4. All claims trace to query results
