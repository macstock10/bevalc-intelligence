# LinkedIn Category Analysis Post

Deep dive on a specific category's filing trends - suitable for industry-specific audiences.

---

## Template Structure

### Hook (First 2 lines)
```
[Category] filings are [up/down] [X]% year-over-year.

[One sentence on why this matters]
```

### Body

**The Trend**
| Period | Filings | Change |
|--------|---------|--------|
| This year | [X] | - |
| Last year | [X] | [+/-X]% |
| 2-year avg | [X] | [+/-X]% |

**Who's Driving It**
Top 5 filers in [Category]:
1. [Company] - [X] filings ([X]% share)
2. [Company] - [X] filings
3. [Company] - [X] filings
4. [Company] - [X] filings
5. [Company] - [X] filings

**Market Concentration**
Top 5 share: [X]% (vs [X]% last year)
[One sentence on whether market is consolidating or fragmenting]

**New Entrants**
[X] companies filed [Category] labels for the first time this year.
Notable: [Company 1], [Company 2]

**What This Indicates**
[2-3 paragraphs of professional analysis on what the filing data suggests about the category's health, competitive dynamics, and direction]

---

Full [Category] data at bevalcintel.com/category/[slug]

---

## Writing Guidelines

### Tone
- Analytical, suitable for trade publication
- Support assertions with data
- Avoid promotional language about any company
- Professional vocabulary appropriate for industry executives

### Category Selection
Prioritize categories with:
- Clear trend (up or down 10%+)
- Broad interest (whiskey, tequila, RTD vs. niche categories)
- Recent news relevance
- Sufficient data volume for meaningful analysis

### Analysis Depth
- YoY comparison is minimum
- Include market concentration analysis when relevant
- Note new entrants vs. established player activity
- Connect to broader industry trends when possible

---

## Example Post

```
American whiskey filings are up 23% year-over-year.

The category continues to outpace overall spirits growth.

The Trend
| Period | Filings | Change |
|--------|---------|--------|
| 2025 | 18,234 | - |
| 2024 | 14,821 | +23% |
| 2023 | 13,456 | +36% |

Who's Driving It
Top 5 filers in American Whiskey:
1. Brown-Forman - 2,341 filings (12.8% share)
2. Sazerac - 1,876 filings (10.3%)
3. Heaven Hill - 1,654 filings (9.1%)
4. Beam Suntory - 1,432 filings (7.9%)
5. Diageo - 1,287 filings (7.1%)

Market Concentration
Top 5 share: 47.2% (vs 51.3% last year)
Market is fragmenting slightly as craft distillers gain share.

New Entrants
156 companies filed American whiskey labels for the first time this year.
Notable: Castle & Key, Widow Jane, Starlight Distillery

What This Indicates
American whiskey's filing growth reflects sustained consumer demand, but the composition of filings is shifting. Large players are filing more line extensions and variants (NEW_SKU signals), while new entrants are driving NEW_BRAND growth.

The fragmenting market share suggests craft and premium segments are gaining traction. Watch for consolidation moves in 2026 as major players acquire proven craft brands to recapture share.

---

Full American Whiskey data at bevalcintel.com/category/whiskey/2025
```

---

## Data Requirements

```sql
-- Category filing trend by year
SELECT year, COUNT(*) as filings
FROM colas
WHERE class_type_code LIKE '%WHISKEY%'
   OR class_type_code LIKE '%WHISKY%'
   OR class_type_code LIKE '%BOURBON%'
GROUP BY year
ORDER BY year DESC
LIMIT 5

-- Top filers in category
SELECT c.canonical_name, COUNT(*) as count
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
WHERE (class_type_code LIKE '%WHISKEY%'
   OR class_type_code LIKE '%WHISKY%'
   OR class_type_code LIKE '%BOURBON%')
  AND year = 2025
GROUP BY c.id
ORDER BY count DESC
LIMIT 10

-- First-time filers in category this year
WITH this_year AS (
  SELECT DISTINCT company_name FROM colas
  WHERE year = 2025
    AND (class_type_code LIKE '%WHISKEY%' OR class_type_code LIKE '%BOURBON%')
),
prior_years AS (
  SELECT DISTINCT company_name FROM colas
  WHERE year < 2025
    AND (class_type_code LIKE '%WHISKEY%' OR class_type_code LIKE '%BOURBON%')
)
SELECT ty.company_name FROM this_year ty
LEFT JOIN prior_years py ON ty.company_name = py.company_name
WHERE py.company_name IS NULL
```

---

## Posting Frequency
- 1 per week, rotating categories
- Schedule: Whiskey, Tequila, RTD, Wine, Beer, Gin (6-week rotation)
- Adjust based on news relevance
