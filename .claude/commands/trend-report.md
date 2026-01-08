# /trend-report

Generate a trend analysis report for a category, time period, or phenomenon.

## Description
Analyzes filing trends in the D1 database, identifies patterns, and generates insights for content creation. Can focus on categories, time periods, seasonal patterns, or specific phenomena (e.g., "premium whiskey", "organic wines").

## Usage
```
/trend-report <topic>
/trend-report tequila
/trend-report "RTD cocktails" --period year
/trend-report --category whiskey --compare vodka
```

## Arguments
| Argument | Description |
|----------|-------------|
| `topic` | Category, phenomenon, or search term to analyze |

## Options
| Flag | Description |
|------|-------------|
| `--category` | Specific TTB category to analyze |
| `--period` | Time period: `week`, `month`, `quarter`, `year`, `5year` (default: year) |
| `--compare` | Compare to another category/topic |
| `--format` | Output: `report`, `blog`, `social`, `all` (default: all) |

## Analysis Types

### 1. Category Trend
Analyze a specific beverage category:
```
/trend-report --category tequila
```
- Filing volume over time
- Top filers in category
- New entrants
- Subcategory breakdown (Blanco, Reposado, Añejo)

### 2. Phenomenon Trend
Analyze a naming or product trend:
```
/trend-report "reserve"
/trend-report "organic"
/trend-report "small batch"
```
- Search for terms in brand_name or fanciful_name
- Track emergence over time
- Identify early adopters vs followers

### 3. Seasonal Analysis
Analyze filing patterns by season:
```
/trend-report --seasonal
```
- Monthly filing volumes
- Pre-holiday spikes
- Summer vs winter categories

### 4. Comparative Analysis
Compare two categories or topics:
```
/trend-report --category tequila --compare vodka
```
- Side-by-side metrics
- Growth rates
- Market share shifts

## Output Structure

```json
{
  "report_type": "category_trend",
  "topic": "Tequila",
  "period": "2025-01-01 to 2025-12-31",
  "generated_at": "2026-01-11T12:00:00Z",

  "summary": {
    "total_filings": 12456,
    "yoy_change": "+18%",
    "market_share": "8.2%",
    "rank_among_categories": 4
  },

  "time_series": [
    {"period": "2025-Q1", "count": 2890, "change": "+15%"},
    {"period": "2025-Q2", "count": 3124, "change": "+8%"},
    {"period": "2025-Q3", "count": 3356, "change": "+7%"},
    {"period": "2025-Q4", "count": 3086, "change": "-8%"}
  ],

  "top_filers": [
    {"company": "Diageo Americas Supply, Inc.", "count": 456, "share": "3.7%"},
    {"company": "Beam Suntory", "count": 389, "share": "3.1%"}
  ],

  "new_entrants": [
    {"company": "Craft Tequila LLC", "first_filing": "2025-03-15", "total": 23}
  ],

  "subcategories": [
    {"name": "Blanco", "count": 4567, "share": "36.7%"},
    {"name": "Reposado", "count": 3890, "share": "31.2%"},
    {"name": "Añejo", "count": 2345, "share": "18.8%"}
  ],

  "insights": [
    "Tequila filings up 18% YoY, outpacing spirits industry average of 7%",
    "Cristalino subcategory emerging as fastest-growing segment",
    "3 major acquisitions in 2025 drove consolidation"
  ],

  "content": {
    "blog_post": {
      "title": "Tequila's Unstoppable Rise: 2025 Filing Analysis",
      "body_markdown": "...",
      "word_count": 1456
    },
    "social": {
      "twitter_thread": [...],
      "linkedin_post": "..."
    },
    "data_visualization": {
      "chart_type": "line",
      "data_url": "charts/tequila-trend-2025.png"
    }
  }
}
```

## SQL Queries Used

### Category Volume Over Time
```sql
SELECT year, month, COUNT(*) as filings
FROM colas
WHERE class_type_code LIKE '%TEQUILA%'
GROUP BY year, month
ORDER BY year, month
```

### Phenomenon Search
```sql
SELECT
  year,
  COUNT(*) as count,
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM colas WHERE year = c.year) as pct
FROM colas c
WHERE brand_name LIKE '%reserve%' OR fanciful_name LIKE '%reserve%'
GROUP BY year
ORDER BY year
```

### New Entrants
```sql
SELECT company_name, MIN(approval_date) as first_filing, COUNT(*) as total
FROM colas
WHERE class_type_code LIKE '%TEQUILA%'
  AND approval_date >= date('now', '-365 days')
GROUP BY company_name
HAVING MIN(approval_date) >= date('now', '-365 days')
ORDER BY total DESC
LIMIT 10
```

## Example Session

```
User: /trend-report tequila

Claude: Analyzing tequila filing trends...

**Tequila Trend Report**
━━━━━━━━━━━━━━━━━━━━━━━

**2025 Overview**
- Total Filings: 12,456
- YoY Change: +18%
- Category Rank: #4 (behind Whiskey, Wine, Vodka)

**Quarterly Breakdown**
Q1: 2,890 (+15%)
Q2: 3,124 (+8%)
Q3: 3,356 (+7%)
Q4: 3,086 (-8% seasonal dip)

**Key Insights**
1. Cristalino subcategory grew 45% - fastest in spirits
2. 8 new craft distilleries entered the market
3. Diageo acquired 2 tequila brands (visible in filing transfers)

**Subcategory Mix**
Blanco: 36.7% ████████░░
Reposado: 31.2% ███████░░░
Añejo: 18.8% ████░░░░░░
Cristalino: 8.2% ██░░░░░░░░
Extra Añejo: 5.1% █░░░░░░░░░

**Generated Content**

📝 **Blog Post** (1,456 words)
"Tequila's Unstoppable Rise: 2025 Filing Analysis"

📊 **Chart Data**
[Line chart showing 5-year trend]

🐦 **Twitter Thread** (8 posts)
Starting with: "Tequila filings up 18% in 2025. Here's what's driving the boom..."

→ Saved to: content-queue/trend-tequila-2026-01-11.json
```

## Related Commands
- `/company-spotlight` - Deep dive on specific company
- `/weekly-content` - Include in weekly pipeline
