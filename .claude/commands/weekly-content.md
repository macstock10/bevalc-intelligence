# /weekly-content

Generate the week's LinkedIn content from TTB data with focus on brand creation and market trends.

## Description
Queries D1 for market activity data and generates LinkedIn content focused on brand launches, new products, and long-term industry trends. This is a marketing tool - emphasize creation and innovation, not administrative filings.

## Usage
```
/weekly-content
/weekly-content --dry-run
/weekly-content --date 2026-01-11
```

## Options
| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what would be generated without writing files |
| `--date YYYY-MM-DD` | Generate for specific week ending date |

## CRITICAL: Data Integrity Rules

**NEVER FABRICATE DATA.** Every number in content must come from a D1 query.

- All statistics MUST come from actual D1 queries executed before writing
- Document every calculation with inputs and outputs
- If you don't have data for a claim, don't make the claim
- One wrong number destroys credibility permanently

## Content Philosophy

**Focus on CREATION, not administration:**
- "347 new brands launched" not "347 filings submitted"
- "23 companies entered the market" not "23 first-time filers"
- "Product innovation in whiskey" not "whiskey filing activity"

**Provide CONTEXT through trends:**
- Year-over-year comparisons
- Seasonal patterns (Q4 holiday rush, summer slowdown)
- Multi-year trajectories
- Market concentration changes

**Tell the STORY behind the data:**
- What do these numbers mean for the industry?
- What patterns are emerging?
- What should executives pay attention to?

## Content Types Generated

### 1. Weekly Intelligence Brief
**Output:** Monday's LinkedIn post
**Purpose:** Establish authority with consistent weekly market summary

Content includes:
- New brands launched and new companies entering market
- Year-over-year comparison (same period last year)
- Top brand launchers by category
- Category breakdown of new product activity
- 2-3 sentences of trend analysis

### 2. Intent Signals
**Output:** LinkedIn post (if significant velocity detected)
**Purpose:** Surface actionable competitive intelligence

Criteria for generation:
- Company launching products at 2x+ normal rate
- Burst of new brand activity from established player
- New category entry by major company

### 3. Category Analysis
**Output:** LinkedIn post for the week's category
**Purpose:** Deep expertise demonstration with historical context

Category rotation: Whiskey → Tequila → RTD → Wine → Beer → Gin

Content includes:
- Multi-year trend for category (3-5 years if available)
- Year-over-year change in context
- Market concentration analysis (is market consolidating or fragmenting?)
- New entrants vs established player share
- Seasonal patterns if relevant

### 4. Market Movers
**Output:** LinkedIn post
**Purpose:** Track market entry and innovation patterns

Content includes:
- Count of new companies entering market
- Notable first-time brand launchers
- Category distribution of new entrants
- What this signals about market attractiveness

## Pipeline Steps

### 1. Data Mining (CRITICAL: USE REAL D1 DATA)

**IMPORTANT:** All statistics MUST come from actual D1 queries. NEVER fabricate numbers.

**Execute ALL these queries BEFORE writing any content:**

```bash
# 1. Current 2-week period activity (use rolling 2-week windows for TTB backfill)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 AND day >= 10 GROUP BY signal ORDER BY count DESC"

# 2. Prior 2-week period for comparison
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE (year = 2025 AND month = 12 AND day >= 27) OR (year = 2026 AND month = 1 AND day < 10) GROUP BY signal ORDER BY count DESC"

# 3. Top brand launchers (NEW_BRAND signal) by category
npx wrangler d1 execute bevalc-colas --remote --command="SELECT company_name, category, COUNT(*) as new_brands FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 GROUP BY company_name, category ORDER BY new_brands DESC LIMIT 20"

# 4. Category breakdown of new brands
npx wrangler d1 execute bevalc-colas --remote --command="SELECT category, COUNT(*) as count FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 GROUP BY category ORDER BY count DESC"

# 5. Year-over-year comparison - same period last year
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2025 AND month = 1 GROUP BY signal ORDER BY count DESC"

# 6. Multi-year trend for new companies (annual totals)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT year, COUNT(*) as count FROM colas WHERE signal = 'NEW_COMPANY' GROUP BY year ORDER BY year DESC"

# 7. Multi-year trend for new brands (annual totals)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT year, COUNT(*) as count FROM colas WHERE signal = 'NEW_BRAND' GROUP BY year ORDER BY year DESC"

# 8. Category trend over multiple years
npx wrangler d1 execute bevalc-colas --remote --command="SELECT year, category, COUNT(*) as count FROM colas WHERE signal IN ('NEW_BRAND', 'NEW_COMPANY') AND year >= 2022 GROUP BY year, category ORDER BY year DESC, count DESC"

# 9. Market concentration - top 10 companies share of new brands
npx wrangler d1 execute bevalc-colas --remote --command="SELECT company_name, COUNT(*) as brands FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 GROUP BY company_name ORDER BY brands DESC LIMIT 10"

# 10. Seasonal pattern - monthly new brands for current and prior year
npx wrangler d1 execute bevalc-colas --remote --command="SELECT year, month, COUNT(*) as new_brands FROM colas WHERE signal = 'NEW_BRAND' AND year >= 2025 GROUP BY year, month ORDER BY year DESC, month DESC"
```

### 2. Calculate and Document All Math

**Before writing ANY content**, calculate and document:

```
PERIOD COMPARISON (2-week rolling windows due to TTB backfill):
- Current period: [dates]
- Prior period: [dates]

NEW BRANDS:
- Current period: [X] new brands launched
- Prior period: [X] new brands launched
- Change: ([current] - [prior]) ÷ [prior] = [X]%

NEW COMPANIES (market entrants):
- Current period: [X] companies entered market
- Prior period: [X] companies entered market
- Change: ([current] - [prior]) ÷ [prior] = [X]%

YEAR-OVER-YEAR CONTEXT:
- Same period last year: [X] new brands
- YoY change: ([current] - [last_year]) ÷ [last_year] = [X]%
- Full year 2025 total: [X] new brands
- Full year 2024 total: [X] new brands
- Annual trend: [+/-X]%

CATEGORY BREAKDOWN:
- Wine: [X] new brands ([X]% of total)
- Beer: [X] new brands ([X]% of total)
- Whiskey: [X] new brands ([X]% of total)
[etc.]

MARKET CONCENTRATION:
- Top 10 companies share: [X]% of new brands
- vs. last year: [X]% (market [consolidating/fragmenting])
```

### 3. Content Generation
**For each content type:**
- Apply template from `/templates/linkedin-*.md`
- Insert ONLY verified data from queries
- Show calculation for every percentage/comparison
- Frame as brand creation and market activity, not administrative filings
- Include historical context and trend analysis
- Add CTA to bevalcintel.com

**Output:** `scripts/content-queue/linkedin-drafts-{date}.md`

### 4. Add Raw Data Reference Section (MANDATORY)

Every content file MUST end with:
1. **All SQL queries** - Exact SQL executed
2. **All query results** - Exact results returned
3. **Calculation block** - Every formula with inputs/outputs
4. **Verification checksums** - List confirming each claim traces to data

### 5. Cross-Reference Before Saving

Audit every number in the content:
- If any claim cannot trace to a query result → FIX IT
- If any calculation is wrong → FIX IT
- One wrong number destroys credibility

## Output Files

```
content-queue/
├── weekly-data-2026-01-11.json     # Raw D1 query results
└── linkedin-drafts-2026-01-11.md   # All four LinkedIn posts
```

## Writing Guidelines Applied

All generated content follows these rules:

**Tone:**
- Professional and authoritative
- Data-forward, insight-driven
- Suitable for executives and analysts

**Banned:**
- Emojis
- Exclamation marks
- Casual phrases
- Marketing language

**Required:**
- Lead with data/numbers
- Specific companies and counts
- "What this signals" analysis
- CTA to database

## Example Session

```
User: /weekly-content

Claude: Generating LinkedIn content for period ending January 23, 2026...

[1/5] Querying D1 for market activity...
  Current period (Jan 10-23): 927 total, 896 new brands, 31 new companies
  Prior period (Dec 27-Jan 9): 891 total, 857 new brands, 34 new companies
  YoY comparison: Jan 2025 had 812 new brands (+10.3%)

[2/5] Calculating trends...
  Annual new brands: 2025 (18,234) vs 2024 (16,891) = +8.0%
  Wine share: 41% of new brands (vs 38% same period last year)
  Top 10 company concentration: 23% of new brands (fragmenting market)

[3/5] Weekly Intelligence Brief
  Generated 215-word post
  Hook: "896 new alcohol brands launched in the past two weeks."
  Context: 10% above same period last year, wine leading category growth

[4/5] Category Analysis (Whiskey)
  Multi-year trend: +23% growth 2022-2025
  2025 total: 18,234 new whiskey brands
  Market fragmenting: craft share up 4 points
  New entrants: 156 first-time whiskey brand launchers in 2025

[5/5] Market Movers
  31 companies entered the alcohol market
  Notable: 3 RTD-focused startups, 2 celebrity-backed tequila brands
  Spirits continue to attract majority of new entrants

Content ready! Saved to:
  scripts/content-queue/weekly-data-2026-01-23.json
  scripts/content-queue/linkedin-drafts-2026-01-23.md

Posting Schedule:
  Monday 9am:    Weekly Intelligence Brief
  Wednesday 10am: Market Movers
  Friday 10am:    Category Analysis (Whiskey)
```

## Post-Pipeline Steps

1. **Review** - Open `linkedin-drafts-{date}.md` and review all posts
2. **Edit** - Adjust language as needed
3. **Schedule** - Copy posts to LinkedIn or scheduling tool
4. **Track** - Monitor engagement for content optimization

## Environment Requirements
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
