# BevAlc Intelligence Video Generation

Remotion-based video generation for LinkedIn and social media content.

## Quick Start

```bash
cd skills/remotion/bevalc-videos

# Install dependencies
npm install

# Preview in browser
npm run dev

# Render LinkedIn square video (recommended)
npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4

# Render 16:9 widescreen
npx remotion render WeeklyRecap out/weekly-recap.mp4

# Render vertical (Stories/TikTok)
npx remotion render WeeklyRecapVertical out/weekly-recap-vertical.mp4
```

## Available Compositions

| ID | Dimensions | Duration | Best For |
|----|------------|----------|----------|
| `WeeklyRecapSquare` | 1080x1080 | ~18s | LinkedIn feed (recommended) |
| `WeeklyRecap` | 1920x1080 | ~26s | YouTube, presentations |
| `WeeklyRecapVertical` | 1080x1920 | ~26s | Instagram Stories, TikTok |

## Video Structure

The WeeklyRecapSquare video contains 6 scenes:

1. **TitleCard** (2.5s) - Headline with animated background
2. **ComparisonCard** (3s) - Current vs prior period comparison
3. **StatsGrid** (3s) - New brands, new companies, new products
4. **CategoryBreakdown** (3.7s) - Horizontal bar chart by category
5. **Leaderboard** (3.3s) - Top brand launcher per category
6. **EndCard** (2.5s) - CTA with bevalcintel.com

## Data Requirements

**CRITICAL: ALL DATA MUST COME FROM D1 QUERIES - NEVER FABRICATE NUMBERS**

Before rendering, update `src/Root.tsx` with real data from D1:

```bash
# Get signal breakdown for current 2-week period
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 AND day >= 10 GROUP BY signal"

# Get category breakdown of new brands
npx wrangler d1 execute bevalc-colas --remote --command="SELECT category, COUNT(*) as count FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 AND day >= 10 GROUP BY category ORDER BY count DESC"

# Get top launcher per category
npx wrangler d1 execute bevalc-colas --remote --command="WITH ranked AS (SELECT company_name, category, COUNT(*) as cnt, ROW_NUMBER() OVER (PARTITION BY category ORDER BY COUNT(*) DESC) as rn FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 GROUP BY company_name, category) SELECT company_name, category, cnt FROM ranked WHERE rn = 1 ORDER BY cnt DESC"

# Get prior period for comparison
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE (year = 2025 AND month = 12 AND day >= 27) OR (year = 2026 AND month = 1 AND day < 10) GROUP BY signal"
```

## Updating Video Data

Edit `src/Root.tsx` and update the `defaultData` object:

```typescript
const defaultData: VideoData = {
  weekEnding: "January 23, 2026",
  dateRange: "Jan 10-23",
  headline: "927 New Brands Entered the Market",
  stats: {
    newCompanies: 31,      // From D1: signal = 'NEW_COMPANY'
    newBrands: 896,        // From D1: signal = 'NEW_BRAND'
    newProducts: 1293,     // From D1: signal = 'NEW_SKU'
    priorNewCompanies: 34, // Prior period
    priorNewBrands: 857,
    priorNewProducts: 1314,
    totalMarketEntries: 927,   // newCompanies + newBrands
    priorMarketEntries: 891,
  },
  categories: [
    { name: "Wine", value: 526, percentage: 56.7 },
    // ... from D1 category query
  ],
  topLaunchers: [
    { name: "Voila Wine", value: 28, category: "Wine" },
    // ... from D1 top launcher query
  ],
};
```

## Project Structure

```
bevalc-videos/
├── src/
│   ├── Root.tsx              # Composition definitions + default data
│   ├── types.ts              # TypeScript interfaces
│   ├── styles.ts             # Colors, fonts, spacing, timing
│   ├── compositions/
│   │   ├── WeeklyRecap.tsx        # 16:9 widescreen
│   │   ├── WeeklyRecapSquare.tsx  # 1:1 LinkedIn
│   │   └── WeeklyRecapVertical.tsx # 9:16 Stories
│   ├── scenes/
│   │   ├── TitleCard.tsx
│   │   ├── ComparisonCard.tsx
│   │   ├── StatsGrid.tsx
│   │   ├── CategoryBreakdown.tsx  # Horizontal bar chart
│   │   ├── Leaderboard.tsx
│   │   ├── LineChart.tsx          # Time series (16:9 only)
│   │   ├── EndCard.tsx
│   │   └── index.ts
│   └── components/
│       ├── AnimatedBackground.tsx  # Floating gradient orbs
│       └── index.ts
├── package.json
├── remotion.config.ts
└── tsconfig.json
```

## Visual Style

- **Background**: Deep navy (#0a0f1a) with animated gradient orbs
- **Accent**: Teal (#00d4aa) with glow effects
- **Cards**: Semi-transparent dark cards with subtle borders
- **Animations**: Smooth easing (Easing.out(Easing.cubic))
- **Typography**: Clean, professional, tabular numbers

## Posting to LinkedIn

1. Render the square video: `npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4`
2. Upload to LinkedIn as native video
3. Add caption from `/weekly-content` generated posts
4. Best posting times: Monday 9am, Wednesday 10am

## Troubleshooting

**Webpack cache errors**: Safe to ignore, just cache warnings
```
[webpack.cache.PackFileCacheStrategy] Caching failed for pack...
```

**Preview not loading**: Try clearing node_modules/.cache:
```bash
rm -rf node_modules/.cache && npm run dev
```

**TypeScript errors**: Run type check:
```bash
npx tsc --noEmit
```
