# CLAUDE-CONTENT.md

Content automation infrastructure for BevAlc Intelligence. LinkedIn is the primary distribution channel with a professional, data-driven tone.

## Overview

The content system generates professional business intelligence content from TTB filing data:

1. **Weekly Intelligence Brief** - Monday summary of prior week's filings
2. **Intent Signals** - Companies showing unusual filing velocity
3. **Category Analysis** - Deep dives on specific category trends
4. **Market Movers** - New entrants and significant market activity

All content is professional, data-forward, and suitable for industry executives on LinkedIn.

## Directory Structure

```
bevalc-intelligence/
├── .claude/
│   ├── CLAUDE.md                    # Main project context
│   ├── CLAUDE-CONTENT.md            # This file - content automation
│   ├── agents/                      # Subagent definitions
│   │   ├── data-miner.md           # Query D1 for weekly data
│   │   ├── content-writer.md       # Write structured content
│   │   └── newsletter-writer.md    # Assemble newsletters
│   └── commands/                    # Custom slash commands
│       ├── weekly-content.md       # Full weekly pipeline
│       ├── company-spotlight.md    # Company profile content
│       ├── trend-report.md         # Category trend analysis
│       ├── scan-news.md            # Run news scanners
│       └── enrich-brands.md        # Batch enrich brand websites
├── templates/                       # Content templates
│   ├── linkedin-weekly-intel.md    # Monday weekly summary
│   ├── linkedin-intent-signals.md  # Filing velocity alerts
│   ├── linkedin-category-analysis.md # Category deep dives
│   ├── linkedin-market-movers.md   # New entrants & activity
│   ├── company-spotlight.md        # Long-form company profiles
│   └── trend-report.md             # Detailed trend analysis
├── scripts/
│   ├── content-automation/         # PowerShell automation
│   │   ├── query-weekly-data.ps1   # Query D1
│   │   └── generate-content-queue.ps1  # Pipeline orchestrator
│   └── content-queue/              # Generated content output
└── reference/                       # Reference documents
```

## LinkedIn Content Types

### 1. Weekly Intelligence Brief
**Template:** `templates/linkedin-weekly-intel.md`
**When:** Monday morning
**Purpose:** Establish authority with consistent weekly data summary

**Structure:**
- Hook: Total filings number
- Stats: New brands, new companies, category breakdown
- Top filers: Top 3-5 companies
- Analysis: 2-3 sentences of insight
- CTA: Link to database

### 2. Intent Signals
**Template:** `templates/linkedin-intent-signals.md`
**When:** 1-2x/week when significant
**Purpose:** Surface actionable competitive intelligence

**Criteria for posting:**
- Company filing at 2x+ normal rate
- 50+ filings in a week from moderate filer
- New category entry by established player

**Structure:**
- Hook: Company + unusual activity
- Data: Filing velocity comparison
- Analysis: What it signals
- Context: Industry relevance

### 3. Category Analysis
**Template:** `templates/linkedin-category-analysis.md`
**When:** 1x/week, rotating categories
**Purpose:** Establish expertise in specific categories

**Rotation:** Whiskey, Tequila, RTD, Wine, Beer, Gin (6-week cycle)

**Structure:**
- Hook: Category trend + YoY change
- Data: Filing trend, top filers, market concentration
- New entrants: First-time filers in category
- Analysis: What the data indicates

### 4. Market Movers
**Template:** `templates/linkedin-market-movers.md`
**When:** Wednesday/Thursday
**Purpose:** Track market entry and significant moves

**Structure:**
- Hook: Number of new entrants
- Data: New companies, first filings
- Notable entries: Most interesting new players
- Established activity: Big company moves
- Analysis: Market implications

## Writing Guidelines

### Tone
- Professional and authoritative
- Data-forward, insight-driven
- Suitable for executives and analysts

### Banned Elements
- Emojis
- Exclamation marks
- Casual phrases ("check this out", "you won't believe", etc.)
- Marketing language ("amazing", "incredible", "game-changing")
- Overly enthusiastic language
- First-person plural assumptions ("we all know")

### Required Elements
- Lead with data/numbers
- Cite specific companies and counts
- Include "What this signals/indicates" analysis
- End with CTA to bevalcintel.com
- Acknowledge limitations where appropriate

### Length Guidelines
- LinkedIn posts: 150-250 words
- Hook must fit in first 2 lines (before "See more" truncation)
- Long-form articles: 800-1500 words

## Quick Commands

### Run Weekly Content Pipeline
```bash
/weekly-content
```
Generates all four content types from current D1 data.

### Generate Specific Content
```bash
# Company spotlight
/company-spotlight diageo

# Trend report
/trend-report tequila --period year

# Scan for industry news
/scan-news
```

## Weekly Schedule

| Day | Content Type | Time |
|-----|--------------|------|
| Monday | Weekly Intelligence Brief | 9am ET |
| Wednesday | Market Movers | 10am ET |
| Thursday | Intent Signals (if notable) | 10am ET |
| Friday | Category Analysis | 10am ET |

## Data Requirements

All content pulls from D1 using these core queries:

```sql
-- Weekly totals
SELECT COUNT(*) FROM colas
WHERE approval_date >= '[start]' AND approval_date <= '[end]'

-- Signal breakdown
SELECT signal, COUNT(*) FROM colas
WHERE approval_date >= '[start]' AND approval_date <= '[end]'
GROUP BY signal

-- Top filers (normalized companies)
SELECT c.canonical_name, COUNT(*) as count
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
WHERE approval_date >= '[start]' AND approval_date <= '[end]'
GROUP BY c.id ORDER BY count DESC LIMIT 10

-- Filing velocity (intent signals)
WITH recent AS (
  SELECT company_name, COUNT(*) as recent_count
  FROM colas WHERE approval_date >= date('now', '-7 days')
  GROUP BY company_name
),
baseline AS (
  SELECT company_name, COUNT(*) / 4.0 as avg_weekly
  FROM colas
  WHERE approval_date >= date('now', '-35 days')
    AND approval_date < date('now', '-7 days')
  GROUP BY company_name
)
SELECT r.company_name, r.recent_count, b.avg_weekly,
       r.recent_count / b.avg_weekly as velocity_multiple
FROM recent r JOIN baseline b ON r.company_name = b.company_name
WHERE b.avg_weekly >= 5 AND r.recent_count >= b.avg_weekly * 2
ORDER BY velocity_multiple DESC
```

## Content Queue

Generated content is stored in `scripts/content-queue/`:

| File Pattern | Contents |
|--------------|----------|
| `weekly-data-{date}.json` | D1 query results |
| `linkedin-drafts-{date}.md` | LinkedIn post drafts |
| `newsletter-{date}.json` | Assembled newsletter |
| `spotlight-{company}-{date}.json` | Company spotlight |
| `trend-{topic}-{date}.json` | Trend report |

## Environment Variables

```
CLOUDFLARE_ACCOUNT_ID=xxx
CLOUDFLARE_D1_DATABASE_ID=xxx
CLOUDFLARE_API_TOKEN=xxx
```

## Integration

The content system integrates with:

1. **D1 Database** - All data queries use the Cloudflare D1 API
2. **SEO Pages** - Content links to `/company/[slug]` and `/brand/[slug]`
3. **Weekly Report** - Content generation runs after weekly sync
4. **Email System** - Newsletter content can feed React Email templates

## Example LinkedIn Post

```
3,247 alcohol labels filed with TTB last week.

Here's what the data shows:

The Numbers
- Total filings: 3,247 (down 8% from prior week)
- New brands: 412
- New market entrants: 23
- Category leader: Wine at 41%

Top Filers
1. Accolade Brands - 156 filings
2. Treasury Wine Estates - 89 filings
3. Constellation Brands - 67 filings

Notable Activity
Wine imports dominated, accounting for nearly half of all filings.
Whiskey filings dropped 15% week-over-week after a strong December.

What This Signals
The post-holiday filing pattern is normalizing. Import activity
suggests distributors are repositioning inventory for Q1.

---

Database: bevalcintel.com
1.9M+ TTB filings. Updated weekly.
```
