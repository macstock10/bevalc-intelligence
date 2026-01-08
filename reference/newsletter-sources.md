# Newsletter & News Sources Reference

This document lists industry newsletters, news sources, and alerts to monitor for BevAlc Intelligence content creation.

## Tier 1: Daily Must-Read

### Shanken News Daily
- **Type:** Email newsletter
- **Frequency:** Daily
- **Focus:** Spirits, wine industry news
- **Publisher:** M. Shanken Communications
- **Value:** Breaking news, M&A, executive moves
- **Search terms:** "acquisition", "launch", "appoint"

### Beverage Dynamics
- **Type:** Email newsletter + website
- **Frequency:** Daily digest
- **Focus:** Beverage alcohol retail and distribution
- **URL:** beveragedynamics.com
- **Value:** Retail trends, distributor news

### The Drinks Business
- **Type:** Email newsletter + website
- **Frequency:** Daily
- **Focus:** Global drinks industry
- **URL:** thedrinksbusiness.com
- **Value:** International perspective, wine focus

## Tier 2: Weekly Deep Dives

### Wine Spectator
- **Type:** Magazine + email
- **Frequency:** Weekly/monthly
- **Focus:** Wine ratings, features
- **Value:** Wine industry trends, major producer news

### Whisky Advocate
- **Type:** Magazine + email
- **Frequency:** Quarterly + email updates
- **Focus:** Whiskey and spirits
- **Value:** Spirits trends, new releases

### Beer Business Daily
- **Type:** Email newsletter
- **Frequency:** Daily
- **Focus:** Beer industry
- **Value:** Beer industry trends, if we expand coverage

## Tier 3: Press Releases

### PR Newswire - Food & Beverage
- **Type:** Press release feed
- **URL:** prnewswire.com/news-releases/food-beverages-latest-news/
- **Filter by:** "beverage alcohol", "spirits", "distillery"
- **Value:** Official company announcements

### Business Wire - Food & Beverage
- **Type:** Press release feed
- **URL:** businesswire.com
- **Filter by:** Similar terms
- **Value:** Company announcements

## Google Alerts to Set Up

### Company Alerts
Set up for top 20 filers:
- "Diageo" + "new product" OR "acquisition"
- "Constellation Brands" + "new" OR "launch"
- "E. & J. Gallo" + announcement
- [Continue for top companies]

### Category Alerts
- "tequila industry"
- "craft spirits"
- "RTD cocktails"
- "whiskey launch"
- "new vodka brand"

### Regulatory Alerts
- "TTB" + "regulation" OR "rule"
- "alcohol labeling" + "requirement"
- "FDA" + "beverage alcohol"

### Trend Alerts
- "celebrity alcohol brand"
- "non-alcoholic spirits"
- "sustainable distillery"
- "organic wine"

## Industry Publications (Monthly Check)

### IWSR
- **Type:** Research reports
- **Focus:** Market data, forecasts
- **Value:** Big-picture trends (expensive, use public summaries)

### Nielsen/IRI
- **Type:** Sales data
- **Value:** Retail sales trends (use press releases)

### Impact Databank
- **Type:** Market research
- **Publisher:** M. Shanken
- **Value:** Brand rankings, market shares

## Competitor Monitoring

### LabelingFacts.com
- **What to watch:** New features, pricing, content
- **Frequency:** Weekly check
- **Why:** Competitive intelligence

### TTB Online
- **What to watch:** System changes, new search features
- **URL:** ttbonline.gov
- **Why:** Our data source, affects our product

## Company Newsrooms

### Major Producers to Monitor
| Company | Newsroom URL |
|---------|--------------|
| Diageo | diageo.com/en/news |
| Constellation | cbrands.com/news |
| Brown-Forman | brown-forman.com/media |
| Pernod Ricard | pernod-ricard.com/en/media |
| Beam Suntory | beamsuntory.com/news |
| Bacardi | bacardilimited.com/media |
| LVMH (Moët Hennessy) | lvmh.com/news-documents |
| William Grant | williamgrant.com/news |
| Campari Group | camparigroup.com/en/news |
| Rémy Cointreau | remy-cointreau.com/en/press |

## Email Filtering Strategy

### Zoho Mail Folder Structure
```
Inbox/
├── Industry News/
│   ├── Shanken
│   ├── Beverage Dynamics
│   ├── Drinks Business
│   └── Other Newsletters
├── Press Releases/
│   ├── PR Newswire
│   └── Business Wire
├── Google Alerts/
│   ├── Companies
│   ├── Categories
│   └── Trends
└── Company Newsrooms/
```

### Auto-Filter Rules
1. From @shankennewsdaily.com → Industry News/Shanken
2. From @beveragedynamics.com → Industry News/Beverage Dynamics
3. From @prnewswire.com → Press Releases/PR Newswire
4. Subject contains "Google Alert" → Google Alerts/
5. From corporate domains → Company Newsrooms/

## Cross-Reference with D1

When processing news:
1. Extract company names mentioned
2. Query D1 for recent filing activity
3. Note correlation (news + filing spike = story)
4. Flag for content creation if interesting

### Correlation Query
```sql
SELECT company_name, COUNT(*) as filings_7d
FROM colas
WHERE company_name LIKE '%[company from news]%'
  AND approval_date >= date('now', '-7 days')
GROUP BY company_name
```
