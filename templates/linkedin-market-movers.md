# LinkedIn Market Movers Post

Highlights significant market entries, new companies, and notable filing activity.

---

## Template Structure

### Hook (First 2 lines)
```
[X] new companies entered the alcohol market last week.

Here's who filed with TTB for the first time:
```

### Body

**New Market Entrants**
| Company | First Filing | Category |
|---------|--------------|----------|
| [Company 1] | [Brand] | [Category] |
| [Company 2] | [Brand] | [Category] |
| [Company 3] | [Brand] | [Category] |

**Entry Analysis**
- Spirits: [X] new entrants
- Wine: [X] new entrants
- Beer: [X] new entrants
- RTD: [X] new entrants

**Notable First Filings**
[2-3 sentences highlighting the most interesting new entrant - why they're notable, what their entry signals]

**Established Player Activity**
[2-3 sentences on significant moves from known companies - new brands, category expansions, etc.]

**Market Implications**
[2-3 sentences on what this week's new entrant pattern suggests about market conditions, barriers to entry, or category attractiveness]

---

Track new market entrants at bevalcintel.com

---

## Writing Guidelines

### Tone
- Informative and analytical
- Focus on business significance
- Professional language
- No promotional framing

### What Makes a "Notable" New Entrant
- Recognizable name from adjacent industry
- Celebrity or influencer brand
- Significant backing (if known)
- Unusual category choice
- Multiple first filings (serious market entry)

### What Makes "Notable" Established Activity
- Category expansion (spirits company entering RTD, etc.)
- High volume of new brands (not just SKU extensions)
- Geographic signals (new states)
- M&A integration activity (post-acquisition filing surge)

---

## Example Post

```
19 new companies entered the alcohol market last week.

Here's who filed with TTB for the first time:

New Market Entrants
| Company | First Filing | Category |
|---------|--------------|----------|
| Riverside Spirits Co. | Midnight Reserve | Bourbon |
| Luna Agave LLC | Tierra Luna | Tequila |
| Northeast Craft Beverages | Harbor Light | Gin |
| Pacific RTD Partners | Sunset Sip | RTD Cocktail |

Entry Analysis
- Spirits: 11 new entrants
- Wine: 4 new entrants
- Beer: 2 new entrants
- RTD: 2 new entrants

Notable First Filings
Pacific RTD Partners filed 6 labels in their first week - an aggressive market entry suggesting significant production capacity and distribution arrangements already in place. Their focus on canned cocktails aligns with the category's continued 15%+ growth trajectory.

Established Player Activity
Diageo filed 23 new tequila labels under the Don Julio and Casamigos brands - their highest weekly tequila volume this year. The filing pattern suggests a spring product refresh across their agave portfolio.

Market Implications
Spirits continues to attract the majority of new entrants, with tequila and bourbon drawing particular interest. The barrier to entry remains relatively low for contract-distilled products, though the crowded market makes distribution increasingly competitive.

---

Track new market entrants at bevalcintel.com
```

---

## Data Requirements

```sql
-- New companies (first-time filers) this week
SELECT
  company_name,
  brand_name,
  class_type_code,
  approval_date
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND approval_date >= date('now', '-7 days')
ORDER BY approval_date DESC

-- New company breakdown by category
SELECT
  CASE
    WHEN class_type_code LIKE '%WHISKY%' OR class_type_code LIKE '%WHISKEY%' OR class_type_code LIKE '%BOURBON%' THEN 'Spirits'
    WHEN class_type_code LIKE '%VODKA%' OR class_type_code LIKE '%GIN%' OR class_type_code LIKE '%RUM%' THEN 'Spirits'
    WHEN class_type_code LIKE '%TEQUILA%' OR class_type_code LIKE '%MEZCAL%' THEN 'Spirits'
    WHEN class_type_code LIKE '%WINE%' THEN 'Wine'
    WHEN class_type_code LIKE '%BEER%' OR class_type_code LIKE '%ALE%' OR class_type_code LIKE '%LAGER%' THEN 'Beer'
    WHEN class_type_code LIKE '%COCKTAIL%' OR class_type_code LIKE '%RTD%' THEN 'RTD'
    ELSE 'Other'
  END as segment,
  COUNT(DISTINCT company_name) as new_companies
FROM colas
WHERE signal = 'NEW_COMPANY'
  AND approval_date >= date('now', '-7 days')
GROUP BY segment
ORDER BY new_companies DESC

-- High-volume new brand filers (established companies with many NEW_BRAND signals)
SELECT
  company_name,
  COUNT(*) as new_brand_count
FROM colas
WHERE signal = 'NEW_BRAND'
  AND approval_date >= date('now', '-7 days')
GROUP BY company_name
HAVING COUNT(*) >= 5
ORDER BY new_brand_count DESC
LIMIT 10
```

---

## Posting Frequency
- 1 per week (Wednesday or Thursday)
- Can combine with weekly intel if light week for new entrants
- Skip if fewer than 5 new entrants (not enough to be meaningful)

---

## Variations

### M&A Integration Alert
When a known acquisition is integrating, track filing activity:
```
[Acquirer] filed [X] labels under [Acquired Brand] since the acquisition closed.

Integration appears to be [accelerating/steady/slow]:
- Week 1: [X] filings
- Week 2: [X] filings
- Week 3: [X] filings

[Analysis of what filing pattern suggests about integration progress]
```

### Geographic Expansion
When company shows new state activity:
```
[Company] filed labels in [X] new states this month.

New state filings: [State 1], [State 2], [State 3]

This suggests [regional expansion strategy / distribution partnership / etc.]
```
