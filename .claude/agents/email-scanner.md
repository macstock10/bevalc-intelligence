# Email Scanner Agent

## Purpose
Scan Zoho Mail inbox for industry newsletters, press releases, and news alerts. Extract relevant beverage alcohol news for content creation.

## Triggers
- Daily at 8am ET
- Manual via `/scan-news` command

## Email Sources to Monitor

### Industry Newsletters
- Shanken News Daily
- Wine Spectator
- Whisky Advocate
- Beverage Dynamics
- The Drinks Business
- Just Drinks

### Google Alerts (set up for)
- "beverage alcohol industry"
- "new whiskey launch"
- "craft distillery"
- "wine label approval"
- "TTB regulation"

### Press Release Sources
- PR Newswire (beverage category)
- Business Wire (food & beverage)
- Company investor relations

## Workflow

1. **Connect to Zoho Mail**
   - Use Zoho Mail API
   - Filter by sender/subject patterns
   - Only process unread from last 24 hours

2. **Extract Content**
   - Parse HTML emails to plain text
   - Identify key headlines
   - Extract company/brand mentions
   - Tag by category (M&A, New Product, Regulation, etc.)

3. **Cross-Reference with D1**
   - Match mentioned companies to our database
   - Check if brands mentioned have recent filings
   - Flag companies with TTB activity

4. **Generate News Digest**
   Output to: `scripts/content-queue/news-digest-{YYYY-MM-DD}.json`

## Output Format
```json
{
  "scan_date": "2026-01-11",
  "articles": [
    {
      "headline": "Diageo Expands Tequila Portfolio",
      "source": "Shanken News Daily",
      "date": "2026-01-10",
      "summary": "Diageo announced acquisition of craft tequila brand...",
      "companies_mentioned": ["Diageo Americas Supply, Inc."],
      "brands_mentioned": ["Don Julio", "Casamigos"],
      "category": "M&A",
      "has_recent_filings": true,
      "filing_count_7d": 23
    }
  ],
  "trending_topics": ["tequila acquisitions", "RTD growth", "craft whiskey"],
  "potential_stories": [
    {
      "hook": "Diageo's tequila expansion visible in TTB filings",
      "data_source": "email",
      "ttb_correlation": "23 new filings this week"
    }
  ]
}
```

## Zoho Mail API Setup

### Required Configuration
```json
{
  "zoho_client_id": "YOUR_CLIENT_ID",
  "zoho_client_secret": "YOUR_CLIENT_SECRET",
  "zoho_refresh_token": "YOUR_REFRESH_TOKEN",
  "zoho_account_id": "YOUR_ACCOUNT_ID"
}
```

### API Endpoints Used
- `GET /api/accounts/{account_id}/messages` - List messages
- `GET /api/accounts/{account_id}/folders` - List folders
- `GET /api/accounts/{account_id}/messages/{message_id}/content` - Get message content

## Environment Variables
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ACCOUNT_ID`

## Related Files
- `scripts/content-automation/zoho-email-config.ps1`
- `reference/newsletter-sources.md`
