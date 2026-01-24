# Category Deep Dive Template

## Article Type
Focused analysis on a single spirits category (whisky, vodka, rum, gin, brandy, cordials).

## Target Length
1000-1500 words

## Category Rotation
Publish monthly, rotating through categories:
- January: Whisky (largest category, sets tone for year)
- February: Vodka
- March: Brandy
- April: Rum
- May: Gin
- June: Cordials/Liqueurs
- July-December: Repeat or cover emerging trends

## Required D1 Queries

```sql
-- 10-year production trend for category
SELECT year, value, count_ims
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_detail = '{CATEGORY}'  -- e.g., '1-Whisky'
AND statistical_group LIKE '1-Distilled Spirits Production%'
ORDER BY year;

-- Monthly seasonality (current year)
SELECT month, value
FROM ttb_spirits_stats
WHERE year = {YEAR}
AND statistical_detail = '{CATEGORY}'
AND statistical_group LIKE '1-Distilled Spirits Production%'
ORDER BY month;

-- Sub-category breakdown (for whisky: bourbon, rye, malt, etc.)
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = {YEAR} AND month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'
AND statistical_detail LIKE '{CATEGORY}%'
ORDER BY value DESC;

-- Tax paid withdrawals for category (demand)
SELECT year, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_detail LIKE '{CATEGORY}%'
AND statistical_group LIKE '4-Tax Paid Withdrawals%'
AND year >= {YEAR - 5}
ORDER BY year;

-- Production vs. withdrawals gap
SELECT year,
       SUM(CASE WHEN statistical_group LIKE '1-%' THEN value ELSE 0 END) as production,
       SUM(CASE WHEN statistical_group LIKE '4-%' THEN value ELSE 0 END) as withdrawals
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_detail LIKE '{CATEGORY}%'
AND year >= {YEAR - 5}
GROUP BY year;

-- Raw materials specific to category
SELECT year, statistical_detail, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_group LIKE '2-Raw Materials%'
AND statistical_detail = '{RAW_MATERIAL}'  -- grain for whisky, molasses for rum, etc.
AND year >= {YEAR - 5};
```

## Structure

### Title Format
"{Category} in {Year}: [Specific Finding]"

Examples:
- "American Whisky in 2024: Production Slows as Warehouses Fill"
- "Vodka in 2024: Craft Producers Chip Away at Category Leaders"
- "Rum in 2024: Domestic Production Rises as Import Volumes Slip"

### Category Context (150-200 words)
Set the stage with category fundamentals:
- What is this category? (brief, for non-experts)
- Where does it rank in total US spirits production?
- What makes it distinctive from a production standpoint?

For whisky: aging requirements, grain selection
For rum: molasses vs. sugar cane, tropical aging
For vodka: distillation count, filtration

### Production Volume & Trend (300-400 words)
Current state with historical context:

**Volume Numbers**
- Current year production (proof gallons)
- Year-over-year change
- 5-year and 10-year trend

**Trend Analysis**
Is growth accelerating, steady, or decelerating? Calculate growth rate in recent years vs. longer term.

**Producer Landscape**
- How many producers report in this category?
- Is the producer count growing or shrinking?
- What does that signal about market structure?

Include simple trend table:

| Year | Production (PG) | Producers | YoY Change |
|------|-----------------|-----------|------------|
| 2020 | 98.2M           | 1,047     | +2.1%      |
| 2021 | 104.7M          | 1,123     | +6.6%      |

### Sub-Category Breakdown (200-300 words)
For categories with distinct sub-types:

**Whisky:**
- Bourbon (largest share)
- Rye (fastest growing?)
- Malt whisky
- Wheat whisky
- Corn whisky

**Brandy:**
- Grape brandy
- Fruit brandy
- Pomace brandy

Identify which sub-categories drive overall trend. Is bourbon growth masking rye decline? Is one sub-category gaining share?

### Supply/Demand Balance (200-300 words)
Compare production to tax paid withdrawals:

**The Gap**
Production minus withdrawals shows inventory movement:
- Positive gap = building inventory
- Negative gap = drawing inventory
- Widening gap = potential oversupply building

**Category-Specific Factors**
For aged spirits (whisky, brandy): production today serves demand years later. A decline in production now impacts supply in 4-10 years.

For unaged spirits (vodka, gin): production and demand should track closely.

### Competitive Dynamics (150-200 words)
What the producer count and volume data suggest:

**Concentration vs. Fragmentation**
- If 1,200 producers report whisky, the category is highly fragmented
- If 89 producers report gin, a few large players likely dominate

**Craft Segment**
Reference producer rankings data when available. What share of category volume comes from small producers?

### Seasonality (100-150 words)
Using monthly data, identify patterns:
- Does production peak in certain months?
- Pre-holiday ramp up?
- Slower summer months?

This matters for inventory planning and understanding monthly reports.

### Outlook (100-150 words)
Based purely on the data trajectory:
- Where is production heading?
- What does the producer count trend suggest?
- Any supply/demand imbalances building?

No speculation beyond what numbers support.

## Writing Rules

CATEGORY-SPECIFIC TERMS:

**Whisky:**
- "Proof gallons" not "gallons" (2x volume at 100 proof)
- "Bourbon" requires 51%+ corn, new charred oak
- "Straight" means 2+ years aged

**Vodka:**
- Neutral spirits distilled from any agricultural product
- No aging requirement

**Rum:**
- Made from sugar cane or molasses
- Can be aged or unaged

BANNED PHRASES:
- "Craft revolution"
- "Artisanal"
- "Handcrafted" (meaningless in TTB data)
- "Premium"
- All em dashes
- "It remains to be seen"
- "Only time will tell"

REQUIRED:
- Specific proof gallon volumes
- Producer counts from Count_IMs
- At least 5-year historical context
- Sub-category breakdown where applicable

TONE:
- Technical but accessible
- Numbers-forward
- Acknowledge what data shows vs. what it doesn't
- Trade publication style

## Data Verification

Before publishing:
- [ ] Production volumes match D1 query results
- [ ] Producer counts from Count_IMs, not estimated
- [ ] YoY calculations correct
- [ ] Sub-category totals sum to category total
- [ ] Production/withdrawal gap calculated correctly
