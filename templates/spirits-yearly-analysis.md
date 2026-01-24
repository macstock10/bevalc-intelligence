# Annual Spirits Industry Analysis Template

## Article Type
Year-end comprehensive analysis of the distilled spirits industry.

## Target Length
1500-2500 words

## Publishing Schedule
Publish 60-90 days after year end (when TTB releases final annual data).

## Required D1 Queries

```sql
-- Full year production by category
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = {YEAR} AND month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'
ORDER BY value DESC;

-- 5-year production trend
SELECT year, statistical_detail, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'
AND year >= {YEAR - 4}
ORDER BY year, statistical_detail;

-- Industry member count over time
SELECT year, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_detail = 'Number of Industry Members'
ORDER BY year;

-- Tax paid withdrawals by category (demand)
SELECT year, statistical_detail, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_group LIKE '4-Tax Paid Withdrawals%'
AND year >= {YEAR - 4}
ORDER BY year, statistical_detail;

-- Bottled for domestic vs export
SELECT year,
       SUM(CASE WHEN statistical_group LIKE '6-%' THEN value ELSE 0 END) as domestic,
       SUM(CASE WHEN statistical_group LIKE '7-%' THEN value ELSE 0 END) as export
FROM ttb_spirits_stats
WHERE month IS NULL AND year >= {YEAR - 4}
GROUP BY year;

-- Raw materials used (grain, fruit, molasses trends)
SELECT year, statistical_detail, value
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_group LIKE '2-Raw Materials%'
AND year >= {YEAR - 2}
ORDER BY year, value DESC;

-- Producer size distribution (from rankings table)
SELECT year, size_tier, producer_count, pct_of_total
FROM ttb_producer_rankings
WHERE year >= {YEAR - 2}
ORDER BY year, size_tier;
```

## Structure

### Title Format
"The {Year} American Spirits Industry: [Key Theme]"

Examples:
- "The 2024 American Spirits Industry: Growth Slows as Premiumization Continues"
- "The 2024 American Spirits Industry: Whisky Dominates While Craft Consolidates"

### Executive Summary (150-200 words)
Three to four bullet points with the year's defining numbers:
- Total production volume and YoY change
- Category with largest growth
- Category with largest decline
- Industry member count change

Then one paragraph of context. What does this year mean for the industry?

### Production Analysis (400-500 words)
Cover all major categories with year-over-year and 5-year trend context.

Structure by category:
1. **Whisky** (largest by volume)
   - Total proof gallons
   - Breakdown: bourbon, rye, malt, wheat
   - 5-year CAGR
   - Producer count

2. **Vodka**
   - Volume and trend
   - Domestic vs. imported share

3. **Tequila/Agave** (if significant imports)
   - Import volumes
   - Growth rate

4. **Brandy, Rum, Gin, Cordials**
   - Grouped analysis for smaller categories
   - Notable movements

Include a simple table:

| Category | {YEAR} Production | YoY Change | 5-Year CAGR |
|----------|-------------------|------------|-------------|
| Whisky   | 112.4M PG         | +3.2%      | +4.1%       |
| Vodka    | 48.7M PG          | -1.8%      | -0.3%       |

### Market Demand vs. Production (300-400 words)
Compare production to tax paid withdrawals. This reveals:
- Inventory dynamics
- Market health
- Category-level supply/demand balance

Highlight categories where:
- Production significantly exceeds withdrawals (inventory building)
- Withdrawals exceed production (destocking)
- The gap is widening or narrowing

For whisky specifically, account for aging requirements. Production today becomes withdrawals years later.

### Industry Structure (300-400 words)
Analyze the producer landscape:

**Scale of Industry**
- Total industry members
- Change from prior year
- Historical context (10-year trend if available)

**Concentration Analysis**
Use producer rankings data:
- What % of volume comes from top tier?
- How many "craft" producers (under 50K PG)?
- Is concentration increasing or decreasing?

**Category Fragmentation**
Compare Count_IMs across categories:
- Whisky: highly fragmented (1,200+ producers)
- Vodka: moderately concentrated
- Brandy: small producer count

### Raw Materials & Input Costs (200-300 words)
Analyze materials used in production:
- Grain consumption trends
- Fruit usage (brandy indicator)
- Molasses (rum indicator)

Connect to broader agricultural/commodity markets when relevant. Rising grain costs impact production economics.

### Export vs. Domestic (200-300 words)
Compare bottled for domestic use vs. bottled for export:
- What share goes overseas?
- Is export share growing?
- Which categories export most?

### Looking Forward (150-200 words)
Based on the data, what trends should the industry watch?
- Categories gaining momentum
- Structural shifts in producer base
- Production/withdrawal gap implications

No predictions, just data-supported observations about trajectory.

## Writing Rules

BANNED PHRASES:
- "It's worth noting"
- "Interestingly"
- "Delve into"
- "The landscape"
- "In conclusion"
- "Navigate"
- "Robust"
- "Significant" (use specific numbers instead)
- All em dashes

REQUIRED:
- At least one data table
- Five-year context for major trends
- Specific proof gallon volumes (not just percentages)
- Producer counts from Count_IMs
- Calculation shown for any derived metrics

TONE:
- Authoritative industry analyst
- Let numbers tell the story
- Acknowledge limitations in data
- Include at least one contrarian or nuanced observation

PARAGRAPH STARTERS (vary these):
- Numbers first: "American distillers produced..."
- Context first: "For the third consecutive year..."
- Contrast: "While whisky volumes grew..."
- Question: "What explains the vodka decline?"
- Specific company type: "Craft producers under 50,000 proof gallons..."

## Data Verification Checklist

Before publishing:
- [ ] All YoY percentages calculated: (current - prior) / prior * 100
- [ ] 5-year CAGR calculated: (end/start)^(1/years) - 1
- [ ] Production volumes match D1 exactly
- [ ] Producer counts from Count_IMs field
- [ ] Table numbers match body text
- [ ] Raw data snapshot saved with article
