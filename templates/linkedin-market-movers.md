# LinkedIn Market Movers Post

Highlights new companies entering the alcohol market and significant brand launches.

---

## Template Structure

### Hook (First 2 lines)
```
[X] new companies entered the alcohol market in the past two weeks.

Here's who launched their first brand:
```

### Body

**New Market Entrants**
| Company | First Brand | Category |
|---------|-------------|----------|
| [Company 1] | [Brand] | [Category] |
| [Company 2] | [Brand] | [Category] |
| [Company 3] | [Brand] | [Category] |
| [Company 4] | [Brand] | [Category] |

**Where They're Entering**
- Spirits: [X] new entrants
- Wine: [X] new entrants
- Beer: [X] new entrants
- RTD: [X] new entrants

**Year-Over-Year Context**
Same period last year: [X] new entrants
2025 full year: [X] new companies entered market
[1-2 sentences on whether market entry is accelerating or decelerating]

**Notable Launches**
[2-3 sentences highlighting the most interesting new entrant - why they're notable, what their entry signals. Could be celebrity-backed, unusual category, aggressive launch with multiple brands, etc.]

**Established Player Activity**
[2-3 sentences on significant moves from known companies - new brand launches (not just SKU extensions), category expansions, etc.]

**What This Signals**
[2-3 sentences on what this period's new entrant pattern suggests about market conditions, barriers to entry, or category attractiveness]

---

Track new market entrants at bevalcintel.com

---

## Writing Guidelines

### Tone
- Informative and analytical
- Focus on business significance
- Professional language
- No promotional framing

### Language Rules
- Say "entered the market" not "filed for the first time"
- Say "launched their first brand" not "received label approval"
- Say "new market entrant" not "first-time filer"
- Focus on business activity, not regulatory process

### What Makes a "Notable" New Entrant
- Recognizable name from adjacent industry
- Celebrity or influencer brand
- Significant backing (if known from public sources)
- Unusual category choice
- Multiple first brands (aggressive market entry)
- Geographic expansion from international player

### What Makes "Notable" Established Activity
- Category expansion (spirits company entering RTD, etc.)
- High volume of new brand launches (not just SKU extensions)
- Geographic signals (new states)
- M&A integration activity (post-acquisition brand launches)

---

## Example Post

```
31 new companies entered the alcohol market in the past two weeks.

Here's who launched their first brand:

New Market Entrants
| Company | First Brand | Category |
|---------|-------------|----------|
| Riverside Spirits Co. | Midnight Reserve | Bourbon |
| Luna Agave LLC | Tierra Luna | Tequila |
| Northeast Craft | Harbor Light | Gin |
| Pacific RTD Partners | Sunset Sip | RTD Cocktail |

Where They're Entering
- Spirits: 18 new entrants
- Wine: 7 new entrants
- Beer: 4 new entrants
- RTD: 2 new entrants

Year-Over-Year Context
Same period last year: 34 new entrants
2025 full year: 847 new companies entered market
Market entry remains robust, though slightly below the 2-year average pace of 35 per two-week period.

Notable Launches
Pacific RTD Partners launched 6 different brands in their first week - an aggressive market entry suggesting significant production capacity and distribution arrangements already in place. Their focus on canned cocktails aligns with the category's continued double-digit growth.

Established Player Activity
Diageo launched 3 new tequila brands under previously unused trademarks - a signal of product development beyond their core Don Julio and Casamigos lines. This represents their most significant tequila brand creation activity in 18 months.

What This Signals
Spirits continues to attract the majority of new entrants (58% this period), with tequila and bourbon drawing particular interest. The barrier to entry remains accessible for contract-distilled products, though the increasingly crowded market means distribution and shelf space become the real competitive battleground.

---

Track new market entrants at bevalcintel.com
```

---

## Data Requirements

```sql
-- New companies entering market this period
SELECT company_name, brand_name, category, approval_date
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND year = 2026 AND month = 1 AND day >= 10
ORDER BY approval_date DESC

-- New company breakdown by category
SELECT category, COUNT(DISTINCT company_name) as new_companies
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND year = 2026 AND month = 1 AND day >= 10
GROUP BY category
ORDER BY new_companies DESC

-- Year-over-year comparison
SELECT COUNT(DISTINCT company_name) as new_companies
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND year = 2025 AND month = 1 AND day >= 10

-- Full year new entrant trend
SELECT year, COUNT(DISTINCT company_name) as new_companies
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND year >= 2023
GROUP BY year
ORDER BY year DESC

-- Companies with multiple first brands (aggressive entry)
SELECT company_name, COUNT(*) as first_brands
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND year = 2026 AND month = 1 AND day >= 10
GROUP BY company_name
HAVING COUNT(*) >= 3
ORDER BY first_brands DESC

-- High-volume new brand launches from established companies
SELECT company_name, COUNT(*) as new_brands
FROM colas
WHERE signal = 'NEW_BRAND'
  AND year = 2026 AND month = 1 AND day >= 10
GROUP BY company_name
HAVING COUNT(*) >= 5
ORDER BY new_brands DESC
LIMIT 10
```

---

## Posting Frequency
- 1 per week (Wednesday or Thursday)
- Can combine with weekly intel if light week for new entrants
- Skip if fewer than 10 new entrants (not enough to be meaningful)

---

## Variations

### M&A Integration Tracking
When a known acquisition is integrating, track brand launch activity:
```
[Acquirer] launched [X] brands under [Acquired Company] since closing.

Integration pace:
- Month 1: [X] brands
- Month 2: [X] brands
- Month 3: [X] brands

[Analysis of what brand launch pattern suggests about integration progress]
```

### Geographic Expansion
When company shows new market signals:
```
[Company] is expanding distribution footprint.

New state activity this quarter: [State 1], [State 2], [State 3]

This suggests [regional expansion strategy / distribution partnership / etc.]
```

---

## CRITICAL: Data Verification

Before posting, verify:
1. New entrant count matches D1 query result
2. Category breakdown adds up correctly
3. Year-over-year comparison uses identical date ranges
4. Company names are accurate (no typos from query results)
