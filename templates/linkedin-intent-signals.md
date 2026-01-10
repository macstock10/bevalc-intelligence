# LinkedIn Intent Signals Post

Highlights companies showing unusual filing velocity - "heating up" indicators.

---

## Template Structure

### Hook (First 2 lines)
```
[Company] filed [X] labels in [timeframe].

That's [X]x their typical rate.
```

### Body

**Filing Velocity**
- [Timeframe] filings: [X]
- Prior period average: [X]
- Increase: [X]%

**What They're Filing**
- [Category 1]: [X] filings
- [Category 2]: [X] filings
- [Brand focus or new brand launches if relevant]

**Why This Matters**
[2-3 sentences explaining the business implication - expansion, new product launch, acquisition integration, market entry, etc.]

**Context**
[1-2 sentences of relevant background - recent news, M&A activity, market conditions]

---

Track filing velocity at bevalcintel.com

---

## Writing Guidelines

### Tone
- Analytical and objective
- Present data, suggest implications, avoid speculation presented as fact
- Professional language appropriate for executives and analysts
- No emojis or casual language

### What Constitutes "Intent Signal"
- 2x+ filing rate vs. prior period
- 50+ filings in a week from typically moderate filer
- New category entry (company filing in category they haven't filed in before)
- Geographic expansion signals (new states appearing)
- Burst of NEW_BRAND signals from established company

### Caution
- Avoid definitive claims about company strategy
- Use language like "suggests", "indicates", "may signal"
- Acknowledge when data could have multiple interpretations

---

## Example Post

```
Brown-Forman filed 47 labels last week.

That's 3x their typical weekly rate.

Filing Velocity
- Last week: 47 filings
- 4-week average: 15
- Increase: 213%

What They're Filing
- Whiskey: 31 filings (Jack Daniel's variants)
- RTD: 12 filings (new ready-to-drink line)
- Tequila: 4 filings (Herradura extensions)

Why This Matters
This filing burst suggests a significant product refresh across their portfolio. The RTD filings are particularly notable - Brown-Forman has been relatively quiet in the ready-to-drink category compared to competitors.

Context
The spirits industry is projecting 8% RTD growth in 2026. Brown-Forman may be positioning to capture share in a category they've historically underweighted.

---

Track filing velocity at bevalcintel.com
```

---

## Finding Intent Signals

### SQL Queries

```sql
-- Companies with unusual filing velocity (last 7 days vs prior 28-day avg)
WITH recent AS (
  SELECT company_name, COUNT(*) as recent_count
  FROM colas
  WHERE approval_date >= date('now', '-7 days')
  GROUP BY company_name
),
baseline AS (
  SELECT company_name, COUNT(*) / 4.0 as avg_weekly
  FROM colas
  WHERE approval_date >= date('now', '-35 days')
    AND approval_date < date('now', '-7 days')
  GROUP BY company_name
)
SELECT
  r.company_name,
  r.recent_count,
  ROUND(b.avg_weekly, 1) as avg_weekly,
  ROUND(r.recent_count / b.avg_weekly, 1) as velocity_multiple
FROM recent r
JOIN baseline b ON r.company_name = b.company_name
WHERE b.avg_weekly >= 5  -- Exclude tiny filers
  AND r.recent_count >= b.avg_weekly * 2  -- At least 2x normal
ORDER BY velocity_multiple DESC
LIMIT 10
```

```sql
-- New category entry (company filing in category for first time)
WITH this_week AS (
  SELECT DISTINCT company_name, class_type_code
  FROM colas
  WHERE approval_date >= date('now', '-7 days')
),
historical AS (
  SELECT DISTINCT company_name, class_type_code
  FROM colas
  WHERE approval_date < date('now', '-7 days')
)
SELECT tw.company_name, tw.class_type_code
FROM this_week tw
LEFT JOIN historical h
  ON tw.company_name = h.company_name
  AND tw.class_type_code = h.class_type_code
WHERE h.company_name IS NULL
```

---

## Posting Frequency
- 1-2 per week when significant signals detected
- Can skip weeks with no notable velocity changes
- Prioritize recognizable company names for engagement
