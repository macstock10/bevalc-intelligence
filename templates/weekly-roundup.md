# Weekly Roundup Template

---
**Meta:**
- Target length: 500-800 words
- SEO title: BevAlc Intelligence Weekly: [Month Day-Day, Year]
- Meta description: [X] TTB label approvals this week. Top filers, trending categories, and notable new brands.
---

# BevAlc Intelligence Weekly: [Month Day-Day, Year]

*[X] filings this week. Here's what you need to know.*

## The Numbers

| This Week | Value | vs Last Week |
|-----------|-------|--------------|
| Total Filings | [X] | [+/- X%] |
| New Brands | [X] | [+/- X%] |
| New SKUs | [X] | [+/- X%] |
| New Companies | [X] | [+/- X] |

## Top Filers This Week

| Company | Filings | Notable |
|---------|---------|---------|
| [Company 1] | [X] | [Brief note] |
| [Company 2] | [X] | [Brief note] |
| [Company 3] | [X] | [Brief note] |
| [Company 4] | [X] | [Brief note] |
| [Company 5] | [X] | [Brief note] |

[View all companies →](/database)

## Category Breakdown

```
[Category 1]  ████████████████ [X] ([X]%)
[Category 2]  ████████████ [X] ([X]%)
[Category 3]  ████████ [X] ([X]%)
[Category 4]  ██████ [X] ([X]%)
[Category 5]  ████ [X] ([X]%)
```

**Trending:** [Category] up [X]% vs 4-week average

## Notable New Brands

### [Brand Name 1]
**Filed by:** [Company] | **Category:** [Category]
[One sentence about why this is notable]

### [Brand Name 2]
**Filed by:** [Company] | **Category:** [Category]
[One sentence about why this is notable]

### [Brand Name 3]
**Filed by:** [Company] | **Category:** [Category]
[One sentence about why this is notable]

## New Market Entrants

[X] companies filed with TTB for the first time this week:

- **[Company 1]** - [Category], [Location if known]
- **[Company 2]** - [Category], [Location if known]

## Industry News Tie-In

*[Optional section if news correlates with filing data]*

[Brief mention of relevant industry news and how it connects to this week's filing data]

## What We're Watching

- **[Trend 1]:** [Brief description of something to monitor]
- **[Trend 2]:** [Brief description]
- **[Trend 3]:** [Brief description]

---

**Explore this week's filings:** [View database →](/database?date_from=[start]&date_to=[end]&signal=NEW_BRAND,NEW_SKU)

---

## Template Usage Notes

### Required Sections
- [ ] The Numbers (4 key stats)
- [ ] Top Filers (5 companies)
- [ ] Category Breakdown (5 categories)
- [ ] Notable New Brands (3 minimum)

### Optional Sections
- [ ] New Market Entrants (if any)
- [ ] Industry News Tie-In (if relevant)
- [ ] What We're Watching (for variety)

### Data Sources
- Total filings: COUNT(*) for week
- New brands: COUNT(*) WHERE signal = 'NEW_BRAND'
- Top filers: GROUP BY company, ORDER BY count
- Categories: Use category mapping SQL

### Social Posts to Generate

**Twitter Thread Opener:**
"[X] new labels approved by TTB this week. Here's what caught our eye 🧵"

**LinkedIn Post:**
"Weekly BevAlc Intelligence: [X] new TTB label approvals..."

**Key Stats for Social:**
- Lead stat (most interesting number)
- Top filer name and count
- Trending category and % change
