# /weekly-content

Generate the week's LinkedIn content from TTB filing data.

## Description
Queries D1 for the prior week's filings and generates all four LinkedIn content types with professional, data-driven tone.

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

## Content Types Generated

### 1. Weekly Intelligence Brief
**Output:** Monday's LinkedIn post
**Purpose:** Establish authority with consistent weekly data summary

Content includes:
- Total filings and week-over-week change
- New brands, new SKUs, new market entrants
- Top 3-5 filers by volume
- Category breakdown
- 2-3 sentences of analysis

### 2. Intent Signals
**Output:** LinkedIn post (if significant velocity detected)
**Purpose:** Surface actionable competitive intelligence

Criteria for generation:
- Company at 2x+ normal filing rate
- 50+ filings from typically moderate filer
- New category entry by established player

### 3. Category Analysis
**Output:** LinkedIn post for the week's category
**Purpose:** Deep expertise demonstration

Category rotation: Whiskey → Tequila → RTD → Wine → Beer → Gin

Content includes:
- YoY trend for category
- Top filers and market share
- New entrants to category
- Industry implications

### 4. Market Movers
**Output:** LinkedIn post
**Purpose:** Track market entry and significant moves

Content includes:
- Count of new market entrants
- Notable first-time filers
- Established player activity
- Market implications

## Pipeline Steps

### 1. Data Mining (CRITICAL: USE REAL D1 DATA)

**IMPORTANT:** All statistics MUST come from actual D1 queries. NEVER fabricate numbers.

**Execute ALL these queries BEFORE writing any content:**

```bash
# 1. Total filings for current period
npx wrangler d1 execute bevalc-colas --remote --command="SELECT COUNT(*) as total FROM colas WHERE year = 2026 AND month = 1"

# 2. Signal breakdown
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 GROUP BY signal ORDER BY count DESC"

# 3. Top filers
npx wrangler d1 execute bevalc-colas --remote --command="SELECT company_name, COUNT(*) as filings FROM colas WHERE year = 2026 AND month = 1 GROUP BY company_name ORDER BY filings DESC LIMIT 10"

# 4. Category breakdown (get 25 for aggregations)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT class_type_code, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 GROUP BY class_type_code ORDER BY count DESC LIMIT 25"

# 5. Historical comparison - same month last year
npx wrangler d1 execute bevalc-colas --remote --command="SELECT COUNT(*) as total FROM colas WHERE year = 2025 AND month = 1"

# 6. Historical new companies - same month last year
npx wrangler d1 execute bevalc-colas --remote --command="SELECT COUNT(*) as count FROM colas WHERE year = 2025 AND month = 1 AND signal = 'NEW_COMPANY'"

# 7. New company trend by month (for averages)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT year, month, COUNT(*) as count FROM colas WHERE signal = 'NEW_COMPANY' AND year >= 2025 GROUP BY year, month ORDER BY year DESC, month DESC"

# 8. Top filers for comparison periods
npx wrangler d1 execute bevalc-colas --remote --command="SELECT company_name, COUNT(*) as filings FROM colas WHERE year = 2025 AND month = 1 GROUP BY company_name ORDER BY filings DESC LIMIT 5"

npx wrangler d1 execute bevalc-colas --remote --command="SELECT company_name, COUNT(*) as filings FROM colas WHERE year = 2025 AND month = 12 GROUP BY company_name ORDER BY filings DESC LIMIT 5"
```

### 2. Calculate and Document All Math

**Before writing ANY content**, calculate and document:

```
Days elapsed: [X]
MTD total: [from query 1]
Run rate: [total] ÷ [days] × [days_in_month] = [result]

YoY comparison:
- Current run rate: [X]
- Same month last year: [from query 5]
- Change: ([current] - [last_year]) ÷ [last_year] = [X]%

New company analysis:
- MTD new companies: [from query 2]
- Run rate: [mtd] ÷ [days] × [days_in_month] = [result]
- Same month last year: [from query 6]
- YoY change: ([pace] - [last_year]) ÷ [last_year] = [X]%

Category shares:
- Wine total: [sum wine categories from query 4]
- Wine %: [total] ÷ [grand_total] = [X]%
```

### 3. Content Generation
**For each content type:**
- Apply template from `/templates/linkedin-*.md`
- Insert ONLY verified data from queries
- Show calculation for every percentage/comparison
- Generate analysis section
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

Claude: Generating LinkedIn content for week ending January 11, 2026...

[1/4] Querying D1...
  Total filings: 2,891
  New brands: 347
  New companies: 19
  Top filer: Accolade Brands (142)

[2/4] Weekly Intelligence Brief
  Generated 198-word post
  Hook: "2,891 alcohol labels filed with TTB last week."

[3/4] Intent Signals
  Found 2 companies with 2x+ velocity:
  - Brown-Forman (3.2x normal)
  - Campari America (2.4x normal)
  Generated post for Brown-Forman activity

[4/4] Category Analysis (Whiskey)
  YoY change: +18%
  Top filer: Brown-Forman (312)
  New entrants: 23

[5/4] Market Movers
  19 new market entrants this week
  Notable: Pacific RTD Partners (6 first filings)

Content ready! Saved to:
  scripts/content-queue/weekly-data-2026-01-11.json
  scripts/content-queue/linkedin-drafts-2026-01-11.md

Posting Schedule:
  Monday 9am:    Weekly Intelligence Brief
  Wednesday 10am: Market Movers
  Thursday 10am:  Intent Signals (Brown-Forman)
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
