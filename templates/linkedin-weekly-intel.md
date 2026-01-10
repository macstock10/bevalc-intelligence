# LinkedIn Weekly Intelligence Brief

Professional weekly summary of TTB filing activity for LinkedIn distribution.

---

## Template Structure

### Hook (First 2 lines - visible before "See more")
```
[Number] alcohol labels filed with TTB this week.

Here's what the data shows:
```

### Body

**The Numbers**
- Total filings: [X]
- New brands: [X]
- New market entrants: [X]
- Category leader: [Category] at [X]%

**Top Filers**
1. [Company] - [X] filings
2. [Company] - [X] filings
3. [Company] - [X] filings

**Notable Activity**
- [1-2 sentences on most interesting pattern or outlier]
- [1-2 sentences on category trend if significant]

**What This Signals**
[2-3 sentences of professional analysis - what does this week's activity indicate about market conditions, competitive dynamics, or industry direction]

---

Database: bevalcintel.com
[X]M+ TTB filings. Updated weekly.

---

## Writing Guidelines

### Tone
- Professional and authoritative
- Data-forward, insight-driven
- No emojis
- No exclamation marks
- No casual phrases ("check this out", "you won't believe", etc.)
- No marketing language ("amazing", "incredible", "game-changing")

### Structure Rules
- Lead with the number (attention-grabbing but professional)
- Stats before analysis
- Analysis should add insight beyond the numbers
- End with clear CTA to database

### Length
- Target: 150-250 words
- Hook must fit in first 2 lines (before LinkedIn truncates)

### Frequency
- Post every Monday morning (covers prior week's filings)
- Consistent posting builds authority

---

## Example Post

```
3,247 alcohol labels filed with TTB last week.

Here's what the data shows:

The Numbers
- Total filings: 3,247 (down 8% from prior week)
- New brands: 412
- New market entrants: 23
- Category leader: Wine at 41%

Top Filers
1. Accolade Brands - 156 filings
2. Treasury Wine Estates - 89 filings
3. Constellation Brands - 67 filings

Notable Activity
Wine imports dominated, accounting for nearly half of all filings. Whiskey filings dropped 15% week-over-week after a strong December.

What This Signals
The post-holiday filing pattern is normalizing. Import activity suggests distributors are repositioning inventory for Q1. The whiskey pullback likely reflects saturation in the category after aggressive 2025 launches.

---

Database: bevalcintel.com
1.9M+ TTB filings. Updated weekly.
```

---

## Data Requirements

Query from D1:
- Total filings for week
- Signal breakdown (NEW_BRAND, NEW_SKU, NEW_COMPANY, REFILE)
- Category breakdown
- Top 5 filers by count
- Week-over-week comparison

SQL reference:
```sql
-- Total filings
SELECT COUNT(*) FROM colas
WHERE approval_date >= '[start]' AND approval_date <= '[end]'

-- Signal breakdown
SELECT signal, COUNT(*) FROM colas
WHERE approval_date >= '[start]' AND approval_date <= '[end]'
GROUP BY signal

-- Top filers (using normalized companies)
SELECT c.canonical_name, COUNT(*) as count
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
WHERE approval_date >= '[start]' AND approval_date <= '[end]'
GROUP BY c.id ORDER BY count DESC LIMIT 5
```
