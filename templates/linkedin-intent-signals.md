# LinkedIn Intent Signals Post

Highlights companies showing unusual brand launch velocity - "heating up" indicators.

---

## Template Structure

### Hook (First 2 lines)
```
[Company] launched [X] new brands in [timeframe].

That's [X]x their typical rate.
```

### Body

**Launch Velocity**
- Recent period: [X] new brands
- Prior period average: [X] new brands
- Increase: [X]%

**What They're Launching**
- [Category 1]: [X] new brands
- [Category 2]: [X] new brands
- [Notable brand names or patterns]

**Historical Context**
[Company]'s brand launch history:
- 2025 total: [X] new brands
- 2024 total: [X] new brands
- This period represents [X]% of their typical annual output

**Why This Matters**
[2-3 sentences explaining the business implication - expansion, new product line, acquisition integration, market entry strategy, etc.]

**What to Watch**
[1-2 sentences on what this could signal for the market or what to monitor next]

---

Track brand launch velocity at bevalcintel.com

---

## Writing Guidelines

### Tone
- Analytical and objective
- Present data, suggest implications, avoid speculation presented as fact
- Professional language appropriate for executives and analysts
- No emojis or casual language

### Language Rules
- Say "brand launches" not "filings"
- Say "launch velocity" not "filing rate"
- Say "product innovation" not "label approvals"
- Focus on business activity, not regulatory process

### What Constitutes an "Intent Signal"
- 2x+ brand launch rate vs. prior period
- Burst of new brand activity (not just SKU extensions)
- New category entry (company launching brands in category they haven't been in)
- Geographic expansion signals
- Post-acquisition integration activity

### Caution
- Avoid definitive claims about company strategy
- Use language like "suggests", "indicates", "may signal"
- Acknowledge when data could have multiple interpretations
- Always provide historical context

---

## Example Post

```
Brown-Forman launched 47 new brands last month.

That's 3x their typical monthly rate.

Launch Velocity
- Last month: 47 new brands
- 12-month average: 15/month
- Increase: 213%

What They're Launching
- Whiskey: 31 new brands (Jack Daniel's and Woodford Reserve lines)
- RTD: 12 new brands (canned cocktail expansion)
- Tequila: 4 new brands (Herradura extensions)

Historical Context
Brown-Forman's brand launch history:
- 2025 total: 187 new brands
- 2024 total: 156 new brands
- This month represents 25% of their typical annual output

Why This Matters
This burst suggests a significant product refresh across their portfolio. The RTD launches are particularly notable - Brown-Forman has been relatively quiet in the ready-to-drink category compared to competitors like Diageo and Beam Suntory.

What to Watch
The spirits industry is projecting 8% RTD growth in 2026. Brown-Forman may be positioning to capture share in a category they've historically underweighted. Watch for distribution announcements in coming months.

---

Track brand launch velocity at bevalcintel.com
```

---

## Finding Intent Signals

### SQL Queries

```sql
-- Companies with unusual brand launch velocity (recent vs. baseline)
WITH recent AS (
  SELECT company_name, COUNT(*) as recent_count
  FROM colas
  WHERE signal = 'NEW_BRAND'
    AND year = 2026 AND month = 1 AND day >= 10
  GROUP BY company_name
),
baseline AS (
  SELECT company_name, COUNT(*) / 4.0 as avg_biweekly
  FROM colas
  WHERE signal = 'NEW_BRAND'
    AND ((year = 2025 AND month = 12) OR (year = 2026 AND month = 1 AND day < 10))
  GROUP BY company_name
)
SELECT
  r.company_name,
  r.recent_count as new_brands,
  ROUND(b.avg_biweekly, 1) as avg_biweekly,
  ROUND(r.recent_count / b.avg_biweekly, 1) as velocity_multiple
FROM recent r
JOIN baseline b ON r.company_name = b.company_name
WHERE b.avg_biweekly >= 3  -- Exclude tiny launchers
  AND r.recent_count >= b.avg_biweekly * 2  -- At least 2x normal
ORDER BY velocity_multiple DESC
LIMIT 10

-- New category entry (company launching brands in category for first time)
WITH recent AS (
  SELECT DISTINCT company_name, category
  FROM colas
  WHERE signal = 'NEW_BRAND'
    AND year = 2026 AND month = 1 AND day >= 10
),
historical AS (
  SELECT DISTINCT company_name, category
  FROM colas
  WHERE signal = 'NEW_BRAND'
    AND (year < 2026 OR (year = 2026 AND month = 1 AND day < 10))
)
SELECT r.company_name, r.category as new_category
FROM recent r
LEFT JOIN historical h
  ON r.company_name = h.company_name
  AND r.category = h.category
WHERE h.company_name IS NULL

-- Company historical context
SELECT year, COUNT(*) as new_brands
FROM colas
WHERE signal = 'NEW_BRAND'
  AND company_name = '[COMPANY_NAME]'
  AND year >= 2023
GROUP BY year
ORDER BY year DESC
```

---

## Posting Frequency
- 1-2 per week when significant signals detected
- Can skip weeks with no notable velocity changes
- Prioritize recognizable company names for engagement

---

## CRITICAL: Data Verification

Before posting, verify:
1. Velocity calculations are accurate (recent / baseline)
2. Historical context numbers match D1 queries
3. Category breakdown adds up to total
4. All percentage changes are calculated correctly
