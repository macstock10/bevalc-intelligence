# Remotion Video Skill

## Overview
Generate weekly market activity videos for LinkedIn and social media using Remotion.

## When to Invoke
Automatically invoke this skill when the user:
- Asks to "create a video" for LinkedIn or social media
- Wants to generate weekly market activity visuals
- Mentions "Remotion" or video rendering
- Asks for animated data visualizations

## Quick Commands

```bash
cd skills/remotion/bevalc-videos

# Preview in browser
npm run dev

# Render LinkedIn square video (RECOMMENDED)
npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4

# Output location: skills/remotion/bevalc-videos/out/weekly-recap-square.mp4
```

## Available Compositions

| ID | Dimensions | Duration | Platform |
|----|------------|----------|----------|
| `WeeklyRecapSquare` | 1080x1080 | ~18s | **LinkedIn (recommended)** |
| `WeeklyRecap` | 1920x1080 | ~26s | YouTube, presentations |
| `WeeklyRecapVertical` | 1080x1920 | ~26s | Instagram Stories, TikTok |

## Video Content (WeeklyRecapSquare)

6 animated scenes:
1. **TitleCard** - "927 New Brands Entered the Market"
2. **ComparisonCard** - Current vs prior 2-week period
3. **StatsGrid** - New brands, new companies, new products
4. **CategoryBreakdown** - Horizontal bar chart by category
5. **Leaderboard** - Top brand launcher per category
6. **EndCard** - CTA to bevalcintel.com

## CRITICAL: Data Integrity

**ALL DATA MUST COME FROM D1 QUERIES - NEVER FABRICATE NUMBERS**

Before creating a video, run these queries and update `src/Root.tsx`:

```bash
# Signal breakdown (NEW_BRAND, NEW_COMPANY, NEW_SKU counts)
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 AND day >= 10 GROUP BY signal"

# Category breakdown
npx wrangler d1 execute bevalc-colas --remote --command="SELECT category, COUNT(*) as count FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 AND day >= 10 GROUP BY category ORDER BY count DESC"

# Top launcher per category
npx wrangler d1 execute bevalc-colas --remote --command="WITH ranked AS (SELECT company_name, category, COUNT(*) as cnt, ROW_NUMBER() OVER (PARTITION BY category ORDER BY COUNT(*) DESC) as rn FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 GROUP BY company_name, category) SELECT company_name, category, cnt FROM ranked WHERE rn = 1"
```

## Updating Video Data

Edit `src/Root.tsx` and update `defaultData`:

```typescript
const defaultData: VideoData = {
  weekEnding: "January 23, 2026",
  dateRange: "Jan 10-23",
  headline: "927 New Brands Entered the Market",
  stats: {
    newCompanies: 31,        // FROM D1 QUERY
    newBrands: 896,          // FROM D1 QUERY
    newProducts: 1293,       // FROM D1 QUERY
    priorNewCompanies: 34,
    priorNewBrands: 857,
    priorNewProducts: 1314,
    totalMarketEntries: 927,
    priorMarketEntries: 891,
  },
  categories: [/* FROM D1 QUERY */],
  topLaunchers: [/* FROM D1 QUERY */],
};
```

## Visual Style

- **Background**: Deep navy (#0a0f1a) with floating gradient orbs
- **Accent**: Teal (#00d4aa) with glow effects
- **Animations**: Smooth Easing.out(Easing.cubic)
- **Bars animate from 0, numbers count up, elements fade/slide in

## Workflow for Weekly Video

1. Query D1 for latest 2-week period data
2. Update `src/Root.tsx` with real numbers
3. Preview: `npm run dev`
4. Render: `npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4`
5. Upload to LinkedIn with caption from `/weekly-content`

## Troubleshooting

**Webpack cache warnings**: Safe to ignore
**Preview not loading**: `rm -rf node_modules/.cache && npm run dev`
**TypeScript errors**: `npx tsc --noEmit`

## File Structure

```
bevalc-videos/
├── src/
│   ├── Root.tsx              # DATA GOES HERE
│   ├── compositions/         # Video layouts
│   ├── scenes/               # Individual scenes
│   └── components/           # Reusable elements
├── out/                      # Rendered videos (gitignored)
└── package.json
```
