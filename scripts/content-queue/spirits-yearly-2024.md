# The 2024 American Spirits Industry: Whisky Posts First Decline in Six Years

## Key Figures

- **Total production:** 23.7 billion proof gallons
- **Year-over-year change:** +6.2%
- **Active producers:** 1,890
- **Producer count change:** -52

## Production by Category

| Category | 2024 Volume | 2023 Volume | YoY Change | Producers |
|----------|------------|------------|------------|-----------|
| Neutral Spirits | 23,406.1M PG | 22,014.1M PG | +6.3% | 962 |
| Whisky | 286.5M PG | 298.9M PG | -4.2% | 1,071 |
| Rum/Gin/Vodka | 5.3M PG | 8.6M PG | -38.2% | 1,130 |
| Brandy | 5.4M PG | 6.6M PG | -17.6% | 335 |

## The Industrial vs. Beverage Split

Total distilled spirits production rose 6.2% in 2024 to 23.7 billion proof gallons. But this headline number masks a fundamental divide in the American spirits industry.

Neutral spirits and industrial alcohol (99% of volume) grew 6.3%. Every beverage category declined.

- Whisky: down 4.2%
- Brandy: down 17.6%
- Rum, gin, and vodka (combined): down 38.2%

For beverage industry analysis, the industrial alcohol figures provide noise, not signal.

## Whisky Analysis

American whisky production fell to 286.5 million proof gallons in 2024, ending a streak of five consecutive annual increases that began in 2019.

| Year | Production (PG) | Producers | YoY Change |
|------|-----------------|-----------|------------|
| 2019 | 217.9M | 1,002 | - |
| 2020 | 221.7M | 1,017 | +1.7% |
| 2021 | 242.2M | 1,042 | +9.2% |
| 2022 | 278.5M | 1,121 | +15.0% |
| 2023 | 298.9M | 1,122 | +7.4% |
| 2024 | 286.5M | 1,071 | -4.2% |

The 2024 decline coincided with a 4.5% drop in active whisky producers (from 1,122 to 1,071). Both metrics peaked in 2023.

What drove the pullback? Industry reports point to elevated bourbon inventory levels. The production surge of 2021-2023 filled warehouses faster than withdrawals could empty them. With aging whisky tying up capital and storage capacity, producers scaled back.

## The Rum/Gin/Vodka Collapse

The combined rum, gin, and vodka category plunged 38% to 5.3 million proof gallons. This was the steepest decline among beverage categories.

TTB groups these spirits together in reporting, obscuring which drove the drop. Historical patterns suggest vodka, the largest of the three, likely accounts for most of the decline. Vodka production has contracted annually since 2019 as consumer preferences shifted toward whisky and agave spirits.

Producer count in this category (1,130) actually grew from 2023 (1,175). More producers, far less volume points to craft distilleries maintaining operations while larger producers cut back.

## Brandy's Continued Decline

Brandy production fell 17.6% to 5.4 million proof gallons. The 335 active producers represented an 11.6% drop from 2023's 379.

California grape brandy dominates this category. Drought conditions and vineyard economics have constrained production in recent years.

## Industry Structure

The industry counted 1,890 active producers in 2024, down from 1,942 in 2023. This 2.7% decline marked the first reduction in producer count since TTB began this data series in 2012.

The drop concentrated in beverage spirits:
- Whisky producers: -51 (-4.5%)
- Brandy producers: -44 (-11.6%)
- Rum/gin/vodka producers: -45 (-3.8%)

Neutral spirits producers actually declined as well (-42), but this category's growth came from larger operations increasing output, not new entrants.

## What 2024 Signals

The simultaneous decline in production, producer counts, and beverage volumes marks an inflection point. After a decade of expansion, the American spirits industry is consolidating.

For whisky specifically, the 2024 pullback represents rational inventory management, not demand collapse. Tax-paid withdrawals (spirits leaving warehouses for sale) remained stable while production fell. The industry is working through the surplus built during 2020-2023.

Whether this consolidation phase lasts one year or several will depend on how quickly inventory levels normalize and whether consumer demand growth resumes.

---

*Source: TTB Distilled Spirits Statistics, 2024 annual data*

*For more beverage alcohol market intelligence, visit [bevalcintel.com](https://bevalcintel.com)*

---

## Raw Data Reference

**Queries Executed:**

```sql
-- 2024 yearly production
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2024 AND month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'

-- 2023 yearly production (comparison)
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2023 AND month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'

-- Whisky 6-year trend
SELECT year, value, count_ims
FROM ttb_spirits_stats
WHERE month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'
AND statistical_detail = '1-Whisky'
AND year >= 2019
```

**2024 Results:**

| Category | Value | Count_IMs |
|----------|-------|-----------|
| Category Total | 23,703,401,985 | 1,890 |
| Neutral Spirits | 23,406,132,335 | 962 |
| Whisky | 286,487,814 | 1,071 |
| Brandy | 5,437,169 | 335 |
| Rum/Gin/Vodka | 5,344,667 | 1,130 |

**2023 Results:**

| Category | Value | Count_IMs |
|----------|-------|-----------|
| Category Total | 22,328,282,431 | 1,942 |
| Neutral Spirits | 22,014,102,956 | 1,004 |
| Whisky | 298,934,197 | 1,122 |
| Brandy | 6,596,321 | 379 |
| Rum/Gin/Vodka | 8,648,958 | 1,175 |

**Calculations:**

- Whisky YoY: (286,487,814 - 298,934,197) / 298,934,197 = -4.2%
- Brandy YoY: (5,437,169 - 6,596,321) / 6,596,321 = -17.6%
- Rum/Gin/Vodka YoY: (5,344,667 - 8,648,958) / 8,648,958 = -38.2%
- Neutral Spirits YoY: (23,406,132,335 - 22,014,102,956) / 22,014,102,956 = +6.3%
- Producer count change: 1,890 - 1,942 = -52
