# LinkedIn Weekly Intelligence Brief

Professional weekly summary of brand creation and market activity for LinkedIn distribution.

---

## Template Structure

### Hook (First 2 lines - visible before "See more")
```
[Number] new alcohol brands launched in the past two weeks.

Here's what the market data shows:
```

### Body

**Brand Creation Activity**
- New brands launched: [X] ([+/-X]% vs prior period)
- New companies entering market: [X]
- New products (SKU extensions): [X]
- Category leader: [Category] at [X]% of new launches

**Most Active Brand Launchers**
1. [Company] - [X] new brands ([Category])
2. [Company] - [X] new brands ([Category])
3. [Company] - [X] new brands ([Category])

**Year-Over-Year Context**
Same period last year: [X] new brands
Change: [+/-X]%
[1-2 sentences on what this trend indicates]

**Category Breakdown**
- Wine: [X]% of new brands
- Spirits: [X]%
- Beer: [X]%
- RTD: [X]%

**What This Signals**
[2-3 sentences of professional analysis - what does this period's brand creation activity indicate about market conditions, category momentum, or industry direction. Reference multi-year trends if relevant.]

---

Database: bevalcintel.com
Track [X]M+ TTB records. Updated daily.

---

## Writing Guidelines

### Tone
- Professional and authoritative
- Data-forward, insight-driven
- No emojis
- No exclamation marks
- No casual phrases ("check this out", "you won't believe", etc.)
- No marketing language ("amazing", "incredible", "game-changing")

### Language Rules
- Say "brands launched" not "filings submitted"
- Say "companies entering market" not "first-time filers"
- Say "product innovation" not "filing activity"
- Focus on creation, not administration

### Structure Rules
- Lead with brand creation number (attention-grabbing but professional)
- Always include year-over-year context
- Stats before analysis
- Analysis should connect to industry trends and patterns
- End with clear CTA to database

### Length
- Target: 150-250 words
- Hook must fit in first 2 lines (before LinkedIn truncates)

### Frequency
- Post every Monday morning (covers prior two-week period)
- Consistent posting builds authority

---

## Example Post

```
896 new alcohol brands launched in the past two weeks.

Here's what the market data shows:

Brand Creation Activity
- New brands launched: 896 (+5% vs prior period)
- New companies entering market: 31
- New products (SKU extensions): 1,293
- Category leader: Wine at 34% of new launches

Most Active Brand Launchers
1. Voila Wine - 28 new brands (Wine)
2. Ska Brewing - 16 new brands (Beer)
3. Bardstown Bourbon - 7 new brands (Whiskey)

Year-Over-Year Context
Same period last year: 812 new brands
Change: +10.3%
Brand creation continues to outpace 2025 levels across most categories.

Category Breakdown
- Wine: 34% of new brands
- Beer: 28%
- Spirits: 24%
- RTD/Cocktails: 14%

What This Signals
January brand launches are tracking 10% ahead of last year, suggesting continued optimism despite broader economic headwinds. Wine's dominant share reflects ongoing premiumization trends. The 31 new market entrants - slightly below the 2-year average of 35 - indicates the barrier to entry remains accessible but competition is intensifying.

---

Database: bevalcintel.com
Track 2.6M+ TTB records. Updated daily.
```

---

## Data Requirements

Query from D1:
- Signal breakdown for current period (NEW_BRAND, NEW_SKU, NEW_COMPANY)
- Signal breakdown for prior period (2 weeks earlier)
- Signal breakdown for same period last year
- Category breakdown of new brands
- Top brand launchers by company

SQL reference:
```sql
-- New brands for period
SELECT COUNT(*) as new_brands FROM colas
WHERE signal = 'NEW_BRAND'
  AND year = 2026 AND month = 1 AND day >= 10

-- Year-over-year comparison
SELECT COUNT(*) as new_brands FROM colas
WHERE signal = 'NEW_BRAND'
  AND year = 2025 AND month = 1 AND day >= 10

-- Top brand launchers
SELECT company_name, COUNT(*) as new_brands, category
FROM colas
WHERE signal = 'NEW_BRAND'
  AND year = 2026 AND month = 1 AND day >= 10
GROUP BY company_name, category
ORDER BY new_brands DESC
LIMIT 10

-- Category breakdown
SELECT category, COUNT(*) as count
FROM colas
WHERE signal = 'NEW_BRAND'
  AND year = 2026 AND month = 1 AND day >= 10
GROUP BY category
ORDER BY count DESC
```

---

## CRITICAL: Data Verification

Before posting, verify:
1. Every number traces to a D1 query result
2. Every percentage calculation is documented
3. Year-over-year comparisons use identical date ranges
4. No numbers are fabricated or estimated
