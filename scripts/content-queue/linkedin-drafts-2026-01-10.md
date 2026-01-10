# LinkedIn Drafts - Week Ending January 10, 2026

Generated: 2026-01-10
Data Source: BevAlc Intelligence D1 Database (LIVE QUERIES)

---

## DATA SUMMARY (From D1)

**Query:** `SELECT COUNT(*) FROM colas WHERE year = 2026 AND month = 1`
**Result:** 1,156 total filings

**Signal Breakdown:**
| Signal | Count | Query |
|--------|-------|-------|
| NEW_SKU | 719 | `WHERE signal = 'NEW_SKU' AND year = 2026 AND month = 1` |
| REFILE | 219 | `WHERE signal = 'REFILE' AND year = 2026 AND month = 1` |
| NEW_BRAND | 184 | `WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1` |
| NEW_COMPANY | 34 | `WHERE signal = 'NEW_COMPANY' AND year = 2026 AND month = 1` |

**Top Categories:**
| Category | Count |
|----------|-------|
| Table Red Wine | 186 |
| Table White Wine | 179 |
| Ale | 143 |
| Dessert Wine | 93 |
| Malt Beverages | 89 |
| Beer | 49 |
| Sparkling Wine | 46 |
| Tequila | 30 |
| Rose Wine | 30 |

**Top Filers:**
| Company | Filings |
|---------|---------|
| Connoisseur Wines USA | 34 |
| Fort George Brewery | 15 |
| Raising Glasses LLC | 14 |
| Yee-Haw Brewing | 13 |
| Twin Elephant Brewing | 13 |

---

## POST 1: Weekly Intelligence Brief
**Post on:** Monday, January 13, 2026 at 9am ET

---

1,156 alcohol labels filed with TTB last week.

Here's what the data shows:

**The Numbers**
- Total filings: 1,156
- New brands: 184
- New SKUs: 719
- New market entrants: 34

**Top Filers**
1. Connoisseur Wines USA - 34 filings
2. Fort George Brewery - 15 filings
3. Raising Glasses LLC - 14 filings
4. Yee-Haw Brewing - 13 filings
5. Twin Elephant Brewing - 13 filings

**Category Leaders**
- Wine (red + white): 365 filings
- Beer/Ale: 281 filings
- Specialty/Dessert: 93 filings
- Tequila: 30 filings

**What This Signals**
First week of 2026 shows steady filing activity. Wine dominates with 365+ filings across red and white categories. Craft breweries (Fort George, Yee-Haw, Twin Elephant) are well-represented in top filers, signaling continued innovation in beer.

---

Database: bevalcintel.com
1.9M+ TTB filings. Updated weekly.

---

## POST 2: Market Movers
**Post on:** Wednesday, January 15, 2026 at 10am ET

---

34 new companies entered the alcohol market last week.

First-time filers with TTB for January 4-10, 2026:

**Notable New Entrants**
| Company | First Brand | Category |
|---------|-------------|----------|
| Still Wild NM LLC | Still Water Distillery | Whisky |
| Oakham Estate Winery | Hartwell Red | Wine |
| Belmore International Corp | Esquisito | Tequila |
| Freebrook Imports | Blended Blue | Tequila |
| Morton Distilleries | Wild Bill's Vodka | Vodka |

**Entry by Category**
- Wine: Multiple new estate wineries
- Spirits: Tequila attracting new investment
- Whisky: Craft distilleries launching

**What This Signals**
34 new market entrants represents entrepreneurial activity in beverage alcohol. Tequila continues to attract new importers (Belmore, Freebrook), while craft distilleries are launching new whisky and vodka brands.

---

Track new market entrants at bevalcintel.com

---

## POST 3: Intent Signals
**Post on:** Thursday, January 16, 2026 at 10am ET

---

Connoisseur Wines USA filed 34 labels last week.

That positions them as the top filer for the first week of 2026.

**Filing Profile**
- Filings: 34
- Category focus: Wine imports
- Primary activity: European wine portfolio expansion

**Market Context**
Import specialists often lead weekly filing counts. Their volume reflects:
- Strong international wine production
- US demand for imported wines
- Efficient label approval pipeline

The top 5 filers (Connoisseur, Fort George, Raising Glasses, Yee-Haw, Twin Elephant) filed 89 labels combined - 8% of total weekly volume.

---

Track filing velocity at bevalcintel.com

---

## POST 4: Category Analysis
**Post on:** Friday, January 17, 2026 at 10am ET

---

Wine filings lead TTB activity: 534 labels last week.

January 4-10, 2026 category breakdown:

**Wine Categories**
| Type | Count |
|------|-------|
| Table Red Wine | 186 |
| Table White Wine | 179 |
| Dessert/Port/Sherry | 93 |
| Sparkling/Champagne | 46 |
| Rose Wine | 30 |
| **Wine Total** | **534** |

**Beer Categories**
| Type | Count |
|------|-------|
| Ale | 143 |
| Malt Beverages | 89 |
| Beer | 49 |
| **Beer Total** | **281** |

**What This Indicates**
Wine represents 46% of all filings. Red and white table wines are nearly equal (186 vs 179), suggesting balanced portfolio expansion. The 30 tequila filings reflect continued category growth.

---

Full data at bevalcintel.com

---

## Posting Schedule Summary

| Day | Content Type | Time |
|-----|--------------|------|
| Monday 1/13 | Weekly Intelligence Brief | 9am ET |
| Wednesday 1/15 | Market Movers | 10am ET |
| Thursday 1/16 | Intent Signals | 10am ET |
| Friday 1/17 | Category Analysis | 10am ET |

---

## Data Verification

All stats from D1 database queries executed 2026-01-10:

```sql
-- Total filings
SELECT COUNT(*) FROM colas WHERE year = 2026 AND month = 1;
-- Result: 1,156

-- Signal breakdown
SELECT signal, COUNT(*) FROM colas WHERE year = 2026 AND month = 1 GROUP BY signal;
-- NEW_SKU: 719, REFILE: 219, NEW_BRAND: 184, NEW_COMPANY: 34

-- Top filers
SELECT company_name, COUNT(*) FROM colas WHERE year = 2026 AND month = 1 GROUP BY company_name ORDER BY COUNT(*) DESC LIMIT 5;
-- Connoisseur Wines USA: 34, Fort George Brewery: 15, Raising Glasses: 14, Yee-Haw: 13, Twin Elephant: 13

-- Category breakdown
SELECT class_type_code, COUNT(*) FROM colas WHERE year = 2026 AND month = 1 GROUP BY class_type_code ORDER BY COUNT(*) DESC;
-- Table Red Wine: 186, Table White Wine: 179, Ale: 143, Dessert Wine: 93, Malt: 89, Beer: 49, Sparkling: 46, Tequila: 30, Rose: 30
```
