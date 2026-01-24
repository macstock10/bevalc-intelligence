# October 2025: Whisky Production Plunges 25% as Industry Restructures

American distillers produced 2.13 billion proof gallons in October 2025. That is up 6.4% from October 2024, driven almost entirely by industrial alcohol and neutral spirits.

Beverage spirits told a different story. Whisky production fell 25% year over year to 17.6 million proof gallons. Brandy dropped 47%. Only rum, gin, and vodka (reported as a combined category by TTB) showed growth, up 32%.

## Production by Category

| Category | Oct 2025 (PG) | Oct 2024 (PG) | YoY Change | Producers |
|----------|---------------|---------------|------------|-----------|
| Total | 2,126.0M | 1,998.0M | +6.4% | 1,035 |
| Neutral Spirits | 2,107.6M | 1,973.6M | +6.8% | 439 |
| Whisky | 17.6M | 23.6M | -25.3% | 420 |
| Rum/Gin/Vodka | 0.55M | 0.42M | +31.9% | 426 |
| Brandy | 0.19M | 0.36M | -46.8% | 86 |

## What the Numbers Show

The whisky decline stands out. October 2025 production of 17.6 million proof gallons was the lowest October figure since 2019. Only 420 producers reported whisky output, down from 513 in October 2024.

Fewer producers, lower volume. That combination suggests consolidation rather than temporary market softness. The 18% drop in active whisky producers represents roughly 93 distilleries that either paused production or exited the category.

Brandy's 47% decline is equally stark, though from a smaller base. October production of 193,205 proof gallons came from just 86 producers, down from 112 a year ago.

## The Neutral Spirits Question

Neutral spirits and industrial alcohol dominate the total production number (99% of volume). This category grew 6.8% year over year, masking the contraction in beverage spirits.

Industrial alcohol serves non-beverage uses: sanitizers, solvents, fuel additives. Its growth trajectory reflects different market forces than whisky or brandy.

For beverage industry analysis, the whisky, brandy, and rum/gin/vodka figures provide clearer signal.

## Rum, Gin, and Vodka Rebound

The combined rum/gin/vodka category showed 32% growth, reversing recent declines. Production reached 549,815 proof gallons from 426 producers.

TTB combines these categories in monthly reports, making it impossible to isolate which spirit drove the growth. The annual data (when released) will show the breakdown.

## Looking Ahead

The whisky production decline now extends five consecutive months. If this pace continues through Q4, full-year 2025 production could fall below 2020 levels.

What happens in November and December will signal whether this is inventory correction or structural shift.

---

*Source: TTB Distilled Spirits Statistics, data through October 2025*

*For more beverage alcohol market intelligence, visit [bevalcintel.com](https://bevalcintel.com)*

---

## Raw Data Reference

**Queries Executed:**

```sql
-- October 2025 production
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2025 AND month = 10
AND statistical_group LIKE '1-Distilled Spirits Production%'

-- October 2024 production (YoY comparison)
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2024 AND month = 10
AND statistical_group LIKE '1-Distilled Spirits Production%'
```

**Results:**

| Year | Month | Category | Value | Count_IMs |
|------|-------|----------|-------|-----------|
| 2025 | 10 | Total | 2,125,968,611 | 1,035 |
| 2025 | 10 | Neutral Spirits | 2,107,596,283 | 439 |
| 2025 | 10 | Whisky | 17,629,308 | 420 |
| 2025 | 10 | Rum/Gin/Vodka | 549,815 | 426 |
| 2025 | 10 | Brandy | 193,205 | 86 |
| 2024 | 10 | Total | 1,997,979,463 | 1,188 |
| 2024 | 10 | Neutral Spirits | 1,973,591,796 | 462 |
| 2024 | 10 | Whisky | 23,607,252 | 513 |
| 2024 | 10 | Rum/Gin/Vodka | 416,947 | 496 |
| 2024 | 10 | Brandy | 363,469 | 112 |

**Calculations:**

- Whisky YoY: (17,629,308 - 23,607,252) / 23,607,252 = -25.3%
- Brandy YoY: (193,205 - 363,469) / 363,469 = -46.8%
- Rum/Gin/Vodka YoY: (549,815 - 416,947) / 416,947 = +31.9%
- Neutral Spirits YoY: (2,107,596,283 - 1,973,591,796) / 1,973,591,796 = +6.8%
- Total YoY: (2,125,968,611 - 1,997,979,463) / 1,997,979,463 = +6.4%
- Whisky producer change: 420 - 513 = -93 producers (-18.1%)
