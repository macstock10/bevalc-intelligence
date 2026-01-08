# Site Monitor Agent

## Purpose
Monitor competitor websites, industry publications, and regulatory sites for changes and new content relevant to beverage alcohol label approvals.

## Triggers
- Daily at 6am ET
- Manual when investigating specific company/topic

## Sites to Monitor

### Competitor/Similar Services
| Site | What to Watch |
|------|---------------|
| ttbonline.gov | New COLA search features, system changes |
| labelingfacts.com | New features, pricing changes |
| beveragealcoholresource.com | Content updates, new tools |

### Regulatory
| Site | What to Watch |
|------|---------------|
| ttb.gov/news | Policy updates, rule changes |
| ttb.gov/labeling | Labeling guidance updates |
| federalregister.gov | Proposed TTB rules |

### Industry News
| Site | What to Watch |
|------|---------------|
| thedrinksbuisness.com | Daily articles |
| beveragedaily.com | Industry trends |
| distillerytrail.com | Craft distillery news |

### Company Newsrooms
| Company | URL Pattern |
|---------|-------------|
| Diageo | diageo.com/en/news |
| Constellation | cbrands.com/news |
| Brown-Forman | brown-forman.com/news |
| Pernod Ricard | pernod-ricard.com/en/media |

## Workflow

1. **Fetch Page Content**
   - Use headless browser or simple fetch
   - Respect robots.txt
   - Rate limit: max 1 request per 10 seconds per domain

2. **Detect Changes**
   - Hash page content
   - Compare to previous day's hash
   - Store hashes in `scripts/content-automation/site-hashes.json`

3. **Extract New Content**
   - Parse changed pages
   - Identify new articles/announcements
   - Extract headlines and summaries

4. **Cross-Reference**
   - Match companies to D1 database
   - Check for related COLA filings
   - Flag potential story opportunities

5. **Generate Report**
   Output to: `scripts/content-queue/site-changes-{YYYY-MM-DD}.json`

## Output Format
```json
{
  "scan_date": "2026-01-11",
  "changes_detected": [
    {
      "site": "ttb.gov/news",
      "type": "new_article",
      "title": "TTB Updates COLA Application Requirements",
      "url": "https://ttb.gov/news/...",
      "date": "2026-01-10",
      "summary": "TTB announced new requirements for...",
      "relevance": "high",
      "action_needed": "Update guidance content"
    }
  ],
  "competitor_updates": [
    {
      "competitor": "labelingfacts.com",
      "change_type": "feature",
      "description": "Added new bulk export feature",
      "our_response": "Consider similar feature for Pro users"
    }
  ],
  "company_news": [
    {
      "company": "Diageo",
      "headline": "Diageo Launches New Sustainability Initiative",
      "relevance_to_filings": "May explain increase in 'organic' label filings"
    }
  ]
}
```

## Configuration
```json
{
  "rate_limit_ms": 10000,
  "respect_robots": true,
  "user_agent": "BevAlcIntel-Monitor/1.0 (+https://bevalcintel.com)",
  "max_pages_per_run": 50
}
```

## Storage
- `scripts/content-automation/site-hashes.json` - Previous content hashes
- `scripts/content-automation/site-monitor-log.json` - Scan history

## Related Files
- `reference/sites-to-monitor.md` - Full site list with selectors
