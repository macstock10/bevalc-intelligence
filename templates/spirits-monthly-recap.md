# Monthly Spirits Market Recap Template

## Article Type
Monthly recap of distilled spirits production and market activity.

## Target Length
800-1200 words

## Required D1 Queries

```sql
-- Current month production by category
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = {YEAR} AND month = {MONTH}
AND statistical_group LIKE '1-Distilled Spirits Production%'
AND statistical_detail != '1-Distilled Spirits Production'
ORDER BY value DESC;

-- Same month prior year (YoY comparison)
SELECT statistical_detail, value
FROM ttb_spirits_stats
WHERE year = {YEAR - 1} AND month = {MONTH}
AND statistical_group LIKE '1-Distilled Spirits Production%';

-- Prior month (MoM comparison)
SELECT statistical_detail, value
FROM ttb_spirits_stats
WHERE year = {YEAR} AND month = {MONTH - 1}
AND statistical_group LIKE '1-Distilled Spirits Production%';

-- Tax paid withdrawals (market demand signal)
SELECT statistical_detail, value
FROM ttb_spirits_stats
WHERE year = {YEAR} AND month = {MONTH}
AND statistical_group LIKE '4-Tax Paid Withdrawals%';

-- Industry member count trend
SELECT year, month, value
FROM ttb_spirits_stats
WHERE statistical_detail = 'Number of Industry Members'
AND year >= {YEAR - 2}
ORDER BY year, month;
```

## Structure

### Title Format
"{Month} {Year}: [Key Finding in Plain Language]"

Examples:
- "November 2024: Whisky Production Hits Five-Year Low as Inventory Builds"
- "August 2024: Vodka Rebounds While Tequila Growth Slows"

### Opening (100-150 words)
Lead with the most significant number from the month. Put it in context immediately.

DO:
- "American distillers produced 98.4 million proof gallons of whisky in November, down 12% from the same month last year."
- "The spirits industry added 47 new producers in Q3, bringing the total to 2,891 active distilled spirits plants."

DON'T:
- "This month saw interesting developments in the spirits industry."
- "Let's delve into the November production data."

### Production Overview (200-300 words)
Cover each major category with specific numbers:
- Whisky (bourbon, rye, malt, wheat)
- Brandy
- Rum
- Gin
- Vodka
- Cordials and liqueurs

For each, provide:
1. Current month production volume
2. Year-over-year change (percentage and direction)
3. Number of producers reporting

Compare to seasonal norms when relevant. November/December typically see higher production ahead of holiday season.

### Market Signals (200-300 words)
Tax paid withdrawals indicate actual market demand (product leaving bonded warehouses for sale).

Compare production vs. withdrawals:
- Production > Withdrawals = Inventory building
- Withdrawals > Production = Drawing down inventory

Highlight any significant gaps. A producer building inventory might signal:
- Anticipating demand growth
- Aging requirements (whisky)
- Supply chain hedging

### Industry Structure (150-200 words)
Track the producer count and what it means:
- How many active producers?
- Net change from prior month?
- Concentration: top producers vs. craft segment

Include the count of industry members (Count_IMs) reporting in each category. A category with 1,200+ reporters vs. one with 50 tells different stories about market structure.

### Category Spotlight (150-200 words)
Pick ONE category with notable movement and go deeper:
- Why might this be happening?
- What does historical data show?
- Any regulatory or market factors at play?

### Closing (50-100 words)
Brief forward look. What to watch next month. No "in conclusion" or summary of what you just wrote.

## Writing Rules

BANNED PHRASES:
- "It's worth noting"
- "Interestingly"
- "Delve into"
- "The landscape"
- "In conclusion"
- "To summarize"
- "This represents"
- All em dashes (use commas, periods, or parentheses)

REQUIRED:
- Every paragraph must contain at least one specific number
- Company counts and production volumes must come from D1 queries
- Year-over-year comparisons for all major categories
- Plain language explanations (no jargon without context)

SENTENCE VARIETY:
- Mix short sentences (under 10 words) with longer ones
- Start paragraphs with different words (not all "The...")
- Include at least one question per article
- Use active voice almost exclusively

TONE:
- Trade publication analyst, not press release
- Confident but not hyperbolic
- Include nuance ("while X increased, the rate of growth slowed")
- Acknowledge uncertainty when data is limited

## Data Verification

Before publishing, verify:
1. All percentages calculated correctly (show formula)
2. Numbers match D1 query results exactly
3. YoY comparisons use same month, not rolling period
4. Producer counts match Count_IMs field
