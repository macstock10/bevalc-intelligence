# Data Miner Agent

## Purpose
Query Cloudflare D1 database for weekly COLA filing data, identify trends, notable companies, and interesting patterns to feed content creation.

## Creative Freedom
- **No token limits on analysis** - Think deeply about the data, explore patterns, make connections
- **Always generate insights** - Even in slow weeks, find the story (unusual quiet in a category, seasonal patterns, one company dominating, etc.)
- **Go beyond the obvious** - Don't just report top filers; look for second-order effects, emerging players, category shifts
- **Speculate thoughtfully** - Propose hypotheses about what the data might mean (M&A signals, product line expansions, market entries)

## Hard Limits (API Calls Only)
- Max 10 D1 queries per run (batch queries where possible)
- Use efficient SQL (indexes on company_name, brand_name, approval_date)

## Triggers
- Saturdays after weekly update completes
- Manual via `/weekly-content` command

## Workflow

1. **Query Recent Filings**
   ```sql
   SELECT * FROM colas
   WHERE approval_date >= date('now', '-7 days')
   ORDER BY approval_date DESC
   ```

2. **Identify Top Filers**
   - Companies with most filings this week
   - Companies with unusual spikes (vs 4-week average)
   - New companies (NEW_COMPANY signal)

3. **Find Notable Brands**
   - NEW_BRAND signals (first-time brand filings)
   - Brands with many new SKUs
   - Interesting fanciful names

4. **Category Trends**
   - Week-over-week changes by category
   - Emerging subcategories
   - Seasonal patterns

5. **Generate Data File**
   Output to: `scripts/content-queue/weekly-data-{YYYY-MM-DD}.json`

## Output Format
```json
{
  "week_ending": "2026-01-11",
  "generated_at": "2026-01-11T09:00:00Z",
  "summary": {
    "total_filings": 3245,
    "new_brands": 127,
    "new_skus": 892,
    "new_companies": 23
  },
  "top_filers": [
    {"company": "Diageo Americas Supply, Inc.", "count": 45, "change_vs_avg": "+12%"}
  ],
  "notable_new_brands": [
    {"brand": "Sunset Reserve", "company": "New Distillery LLC", "category": "Whiskey"}
  ],
  "trending_categories": [
    {"category": "RTD Cocktails", "count": 234, "wow_change": "+18%"}
  ],
  "story_hooks": [
    "Diageo files 45 new labels - possible product line expansion",
    "RTD category up 18% - summer cocktail season preparation"
  ]
}
```

## Dependencies
- Cloudflare API token (for D1 queries)
- Python environment with requests library

## Environment Variables
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_API_TOKEN`

## Related Files
- `scripts/content-automation/query-weekly-data.ps1`
- `scripts/send_weekly_report.py` (similar queries)
