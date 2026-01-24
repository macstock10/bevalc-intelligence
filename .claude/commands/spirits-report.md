# /spirits-report

Generate analysis articles from TTB distilled spirits production statistics.

## Description
Queries D1 for TTB distilled spirits statistics (production volumes, withdrawals, industry member counts) and generates articles with analysis. Data comes from TTB's monthly reports covering all US distilled spirits production.

## Usage
```
/spirits-report                      # Generate for latest available data
/spirits-report --monthly 2024 11    # Generate for specific month
/spirits-report --yearly 2024        # Generate annual analysis
/spirits-report --category whisky    # Generate category deep dive
/spirits-report --linkedin           # Generate short LinkedIn post
```

## Options
| Flag | Description |
|------|-------------|
| `--monthly YEAR MONTH` | Generate monthly recap for specific period |
| `--yearly YEAR` | Generate annual industry analysis |
| `--category NAME` | Generate category deep dive (whisky, vodka, rum, gin, brandy, cordials) |
| `--linkedin` | Generate short LinkedIn post instead of full article |
| `--status` | Show data sync status (latest data available) |

## Data Source

**TTB Distilled Spirits Statistics**
- URL: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics
- Update frequency: Monthly (45 days after month end), Yearly (60 days after year end)
- Data coverage: 2012 to present
- Sync schedule: Weekly (Wednesday 3am UTC via GitHub Action)

## Article Types

### 1. Monthly Recap
Production summary for a specific month with YoY comparisons.
```
/spirits-report --monthly 2024 11
```

Content includes:
- Total production (proof gallons)
- Category breakdown with YoY change
- Producer counts
- Notable movements

Output: `scripts/content-queue/spirits-monthly-2024-11.md`

### 2. Annual Analysis
Comprehensive year-end industry review.
```
/spirits-report --yearly 2024
```

Content includes:
- Total production and YoY change
- Category performance table
- Industry structure analysis
- 5-year trends

Output: `scripts/content-queue/spirits-yearly-2024.md`

### 3. Category Deep Dive
Focused analysis on a single spirits category.
```
/spirits-report --category whisky
```

Categories: whisky, vodka, rum, gin, brandy, cordials

Content includes:
- 5-year production trend
- Producer count analysis
- Market structure observations

Output: `scripts/content-queue/spirits-whisky-2024.md`

### 4. LinkedIn Post
Short-form content for social media.
```
/spirits-report --linkedin
```

Content includes:
- Lead number
- Top 5 categories
- Data source citation

Output: `scripts/content-queue/spirits-linkedin-2024-11.md`

## Database Tables

### ttb_spirits_stats
| Column | Type | Notes |
|--------|------|-------|
| year | INT | Year of data |
| month | INT | Month (NULL for yearly aggregates) |
| statistical_group | TEXT | Category group (e.g., "1-Distilled Spirits Production") |
| statistical_detail | TEXT | Specific category (e.g., "1-Whisky") |
| count_ims | INT | Number of industry members reporting |
| value | INT | Volume (proof gallons, pounds, or count) |
| is_redacted | INT | 1 if data was suppressed |

### ttb_stats_sync_log
Tracks data sync operations.

## Key Queries

### Production by Category
```sql
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2024 AND month = 11
AND statistical_group LIKE '1-Distilled Spirits Production%'
ORDER BY value DESC
```

### Multi-Year Trend
```sql
SELECT year, value, count_ims
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_detail = '1-Whisky'
AND year >= 2020
ORDER BY year
```

### Industry Member Count
```sql
SELECT year, value
FROM ttb_spirits_stats
WHERE statistical_detail = 'Number of Industry Members'
AND month IS NULL
ORDER BY year
```

## Writing Guidelines

**BANNED PHRASES:**
- "It's worth noting"
- "Interestingly"
- "Delve into"
- "The landscape"
- "In conclusion"
- Em dashes (use commas, periods, or parentheses)
- "Unprecedented"
- "Record-breaking" (unless actually a record)

**REQUIRED:**
- Every paragraph must contain at least one specific number
- All numbers must come from D1 queries
- Year-over-year comparisons for major categories
- Producer counts from count_ims field
- Source citation at end of article

**TONE:**
- Trade publication analyst, not press release
- Numbers-forward
- Confident but not hyperbolic
- Acknowledge limitations in data

## Example Session

```
User: /spirits-report --monthly 2024 11

Claude: Generating monthly spirits report for November 2024...

Querying D1 for production data...
- Total production: 98.4M proof gallons
- Whisky: 42.3M PG (-8% YoY)
- Vodka: 18.2M PG (-3% YoY)
- Brandy: 8.9M PG (+12% YoY)

Generating article...

**November 2024: Whisky Production Down 8% Year Over Year**

American distillers produced 98.4 million proof gallons in November 2024.
That is down 4.2% from November 2023...

[Full article content]

Saved to: scripts/content-queue/spirits-monthly-2024-11.md
```

## Automation

The TTB statistics system runs automatically via GitHub Action:

1. **Wednesday 3am UTC**: `ttb-statistics-sync.yml` runs
2. Downloads latest data from TTB
3. Syncs to D1 (INSERT OR REPLACE)
4. Generates articles for new data
5. Outputs to `scripts/content-queue/`

Manual trigger: GitHub Actions → TTB Statistics Sync → Run workflow

## Related Commands
- `/weekly-content` - Generate COLA-based LinkedIn content
- `/trend-report` - COLA filing trend analysis

## Scripts

- `scripts/sync_ttb_statistics.py` - Data sync
- `scripts/generate_spirits_articles.py` - Article generation
- `templates/spirits-*.md` - Article templates
