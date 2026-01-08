# /company-spotlight

Generate a detailed company profile and content piece.

## Description
Creates comprehensive content about a specific company, including filing analysis, brand portfolio, trends, and a polished article ready for publication.

## Usage
```
/company-spotlight <company-name>
/company-spotlight "Diageo Americas Supply, Inc."
/company-spotlight diageo --format blog
/company-spotlight diageo --format social
```

## Arguments
| Argument | Description |
|----------|-------------|
| `company-name` | Full or partial company name to spotlight |

## Options
| Flag | Description |
|------|-------------|
| `--format` | Output format: `blog`, `social`, `newsletter`, `all` (default: all) |
| `--timeframe` | Analysis period: `week`, `month`, `quarter`, `year`, `all` (default: quarter) |
| `--compare` | Compare to another company |

## Workflow

### 1. Company Lookup
Find company in D1 using fuzzy matching:
```sql
SELECT id, canonical_name, display_name
FROM companies
WHERE canonical_name LIKE '%diageo%'
   OR display_name LIKE '%diageo%'
```

### 2. Data Collection
Query D1 for company metrics:
- Total filings (all time)
- Recent filings (last 90 days)
- Brand portfolio (distinct brand names)
- Category breakdown
- Filing trend over time
- DBA names from company_aliases

### 3. Cross-Reference
Check external sources:
- Recent news mentions (from news-digest if available)
- Wikipedia/company website (manual reference)
- Industry publications

### 4. Content Generation
Generate multiple content pieces:
- **Blog Post** (800-1200 words) - Deep dive article
- **Social Posts** (5-10 posts) - Twitter thread, LinkedIn post
- **Newsletter Section** (200-300 words) - For weekly newsletter
- **SEO Enhancement** - Suggested meta description

## Output Structure

```json
{
  "company": {
    "id": 123,
    "canonical_name": "Diageo Americas Supply, Inc.",
    "display_name": "Diageo Americas Supply, Inc.",
    "slug": "diageo-americas-supply-inc",
    "dba_names": ["Don Julio Tequila Company", "Cascade Hollow Distilling Co."]
  },
  "metrics": {
    "total_filings": 15234,
    "recent_filings_90d": 456,
    "brand_count": 127,
    "top_category": "Whiskey",
    "filing_trend": "+12% vs last quarter",
    "first_filing": "1995-03-15",
    "latest_filing": "2026-01-10"
  },
  "top_brands": [
    {"name": "Crown Royal", "filings": 234},
    {"name": "Don Julio", "filings": 189}
  ],
  "content": {
    "blog_post": {
      "title": "Diageo's 2025 Label Strategy: What 456 New Filings Reveal",
      "meta_description": "Analysis of Diageo's recent TTB filings...",
      "body_markdown": "# Full article...",
      "word_count": 1024
    },
    "social": {
      "twitter_thread": ["Post 1...", "Post 2..."],
      "linkedin_post": "...",
      "instagram_caption": "..."
    },
    "newsletter_section": "..."
  },
  "seo_links": [
    {"text": "View all Diageo filings", "url": "/company/diageo-americas-supply-inc"}
  ]
}
```

## Example Session

```
User: /company-spotlight diageo

Claude: Let me analyze Diageo Americas Supply, Inc. for you...

**Company: Diageo Americas Supply, Inc.**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Overview**
- Total Filings: 15,234
- Brands: 127
- Also operates as: Don Julio Tequila Company, Cascade Hollow Distilling Co.

**Last 90 Days**
- New Filings: 456 (+12% vs Q3)
- New Brands: 8
- Top Category: Whiskey (178 filings)

**Top Brands by Filings**
1. Crown Royal (234 filings)
2. Don Julio (189 filings)
3. Tanqueray (145 filings)

**Generated Content**

📝 **Blog Post** (1,024 words)
"Diageo's 2025 Label Strategy: What 456 New Filings Reveal"

[Preview first paragraph...]

🐦 **Twitter Thread** (7 posts)
1/ "Diageo filed 456 new labels last quarter. Here's what we learned 🧵"
...

💼 **LinkedIn Post**
"An analysis of beverage industry leader Diageo's recent TTB filings..."

📧 **Newsletter Section** (287 words)
[Ready to drop into weekly newsletter]

→ All content saved to: content-queue/spotlight-diageo-2026-01-11.json
```

## Tips

### Finding Companies
If unsure of exact name:
```
/company-spotlight whiskey    # Will prompt with matches
/company-spotlight brown      # Shows Brown-Forman, Brown Estate, etc.
```

### Comparing Companies
```
/company-spotlight diageo --compare constellation
```
Generates side-by-side analysis.

### Updating SEO Page
After generating spotlight, consider updating the company's SEO page:
```
# Add generated description to worker.js company page rendering
```

## Related Commands
- `/trend-report` - Analyze category trends
- `/weekly-content` - Full weekly pipeline
