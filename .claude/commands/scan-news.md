# /scan-news

Scan email and competitor sites for industry news.

## Description
Runs the email-scanner and site-monitor agents to gather recent industry news, press releases, and competitor updates. Cross-references mentions with D1 data.

## Usage
```
/scan-news
/scan-news --email-only
/scan-news --sites-only
/scan-news --days 3
```

## Options
| Flag | Description |
|------|-------------|
| `--email-only` | Only scan Zoho Mail inbox |
| `--sites-only` | Only check competitor/news sites |
| `--days N` | Look back N days (default: 1) |
| `--verbose` | Show all found items, not just relevant |

## Email Sources

### Automatically Scanned (from Zoho Mail)
| Source | Type | Frequency |
|--------|------|-----------|
| Shanken News Daily | Newsletter | Daily |
| Wine Spectator | Newsletter | Weekly |
| Beverage Dynamics | Newsletter | Weekly |
| The Drinks Business | Newsletter | Daily |
| Google Alerts | Alerts | As triggered |
| PR Newswire (Beverage) | Press releases | Daily |

### Search Patterns
- Subject contains: "acquisition", "launch", "new brand", "TTB", "label"
- From domains: @shankennewsdaily.com, @prnewswire.com, etc.
- Flagged as "Industry" in Zoho

## Site Monitoring

### Sites Checked
| Site | What We Look For |
|------|------------------|
| ttb.gov/news | Policy updates, rule changes |
| labelingfacts.com | Feature updates, pricing |
| beveragedaily.com | Industry articles |
| thedrinksbusiness.com | News, launches |
| diageo.com/news | Major player announcements |
| constellation.com/news | Major player announcements |

### Change Detection
- Hash-based comparison vs previous scan
- New article detection via sitemap/RSS
- Price/feature page monitoring

## Output Format

```json
{
  "scan_date": "2026-01-11",
  "scan_type": "full",
  "lookback_days": 1,

  "email_results": {
    "emails_scanned": 23,
    "relevant_found": 5,
    "items": [
      {
        "source": "Shanken News Daily",
        "subject": "Diageo Expands Tequila Portfolio with $500M Acquisition",
        "date": "2026-01-10",
        "summary": "Diageo has announced the acquisition of...",
        "companies_mentioned": ["Diageo Americas Supply, Inc."],
        "brands_mentioned": ["Don Julio", "New Brand"],
        "category": "M&A",
        "d1_correlation": {
          "has_recent_filings": true,
          "filing_count_7d": 23,
          "related_signals": ["filing spike +45%"]
        }
      }
    ]
  },

  "site_results": {
    "sites_checked": 8,
    "changes_detected": 2,
    "items": [
      {
        "site": "ttb.gov/news",
        "type": "new_article",
        "title": "TTB Updates COLA Application Requirements",
        "url": "https://ttb.gov/news/...",
        "date": "2026-01-10",
        "relevance": "high",
        "summary": "TTB announced new requirements..."
      }
    ]
  },

  "aggregated_insights": [
    {
      "headline": "Diageo acquisition correlates with TTB filing spike",
      "news_source": "Shanken News Daily",
      "d1_evidence": "23 new filings this week, +45% vs average",
      "story_potential": "high"
    }
  ],

  "suggested_content": [
    {
      "type": "company_spotlight",
      "target": "Diageo Americas Supply, Inc.",
      "angle": "M&A activity visible in filings"
    },
    {
      "type": "trend_report",
      "target": "tequila",
      "angle": "Consolidation driving category growth"
    }
  ]
}
```

## Example Session

```
User: /scan-news

Claude: Scanning for industry news...

**Email Scan**
━━━━━━━━━━━━━
Scanned: 23 emails from last 24 hours
Relevant: 5 items

📰 **Shanken News Daily** (Jan 10)
"Diageo Expands Tequila Portfolio with $500M Acquisition"
→ D1 Correlation: 23 filings from Diageo this week (+45%)

📰 **Beverage Dynamics** (Jan 10)
"RTD Cocktails Continue Double-Digit Growth in 2025"
→ D1 Correlation: RTD category up 34% in Q4

📰 **PR Newswire** (Jan 10)
"New Craft Distillery Opens in Kentucky"
→ D1 Correlation: First TTB filing detected 01/08

**Site Monitor**
━━━━━━━━━━━━━━
Checked: 8 sites
Changes: 2 detected

🔔 **ttb.gov/news** - NEW ARTICLE
"TTB Updates COLA Application Requirements"
Relevance: HIGH - May impact our guidance content

🔔 **labelingfacts.com** - PRICE CHANGE
Enterprise tier now $499/mo (was $399)
Note: Competitive intelligence

**Story Opportunities**
━━━━━━━━━━━━━━━━━━━━
1. Diageo M&A + filing spike → Company Spotlight
2. RTD growth trend → Trend Report
3. New craft distillery → New Entrant feature

→ Saved to: content-queue/news-digest-2026-01-11.json
```

## Zoho Mail Setup

### First-Time Configuration
Run the setup script:
```powershell
.\scripts\content-automation\zoho-email-config.ps1
```

### Required Environment Variables
```
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token
ZOHO_ACCOUNT_ID=your_account_id
```

### Getting Zoho API Credentials
1. Go to https://api-console.zoho.com/
2. Create a "Self Client" application
3. Generate refresh token with scope: `ZohoMail.messages.READ`
4. Store credentials in `.env`

## Related Commands
- `/weekly-content` - Full weekly pipeline (includes scan)
- `/company-spotlight` - Follow up on company mentions
- `/trend-report` - Follow up on trend mentions
