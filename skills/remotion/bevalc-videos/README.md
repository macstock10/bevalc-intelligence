# BevAlc Intelligence Video Generator

Programmatic video generation for the BevAlc Intelligence newsletter using [Remotion](https://remotion.dev).

## Quick Start

```bash
# Install dependencies
npm install

# Start the Remotion Studio (preview)
npm run dev

# Render videos
npm run render:horizontal  # 1920x1080
npm run render:vertical    # 1080x1920
npm run render:all         # Both formats
```

## Data Input Structure

Videos are driven by a `VideoData` object:

```typescript
interface VideoData {
  // Header info
  weekEnding: string;      // "January 23, 2026"
  headline: string;        // "610 Labels Filed This Week"

  // Core stats
  stats: {
    totalFilings: number;
    topCategory: string;
    percentChange: number;  // Week-over-week change
    newBrands: number;
    newCompanies: number;
  };

  // Leaderboard data
  topFilers: Array<{
    name: string;
    value: number;
    category?: string;
  }>;

  topCategories: Array<{
    name: string;
    value: number;
  }>;

  // Optional: Individual filings
  filings?: Array<{
    brandName: string;
    filer: string;
    spiritType: string;
    filingDate: string;
  }>;

  // Optional: Time series for charts
  timeSeries?: Array<{
    date: string;
    value: number;
    label?: string;
  }>;
}
```

## Available Scenes

All scenes are modular and can be composed:

| Scene | Description | Duration |
|-------|-------------|----------|
| `TitleCard` | Headline with subheadline | 3s |
| `AnimatedCounter` | Number ticking up with label | 3s |
| `Leaderboard` | Names revealing one by one | 4s |
| `BarChart` | Animated horizontal bars | 4s |
| `TrendCard` | Percentage with up/down arrow | 3s |
| `EndCard` | CTA with bevalcintel.com | 3s |

## Compositions

### WeeklyRecap (Horizontal - 1920x1080)
Full weekly recap with all scenes:
1. Title Card
2. Total Filings Counter
3. Week-over-Week Trend
4. Top Filers Leaderboard
5. Category Breakdown Chart
6. End Card

**Total Duration:** ~20 seconds

### WeeklyRecapVertical (1080x1920)
Condensed version for social stories:
1. Title Card
2. Total Filings Counter
3. Week-over-Week Trend
4. Top Filers (4 entries)
5. End Card

**Total Duration:** ~13.5 seconds

## Rendering with Custom Data

```bash
# Render with a JSON data file
npx remotion render WeeklyRecap out/video.mp4 --props=path/to/data.json

# Render with inline props
npx remotion render WeeklyRecap out/video.mp4 --props='{"data":{"headline":"Custom Headline",...}}'
```

## Design System

- **Background:** Slate 900 (#0f172a)
- **Cards:** Slate 800 (#1e293b)
- **Accent:** Teal 500 (#14b8a6) - matches bevalcintel.com
- **Text:** Slate 50 (#f8fafc)
- **Font:** Inter (system fallback)

### Color Tokens

```typescript
colors = {
  bg: "#0f172a",
  bgCard: "#1e293b",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  accent: "#14b8a6",
  positive: "#22c55e",  // Green for up trends
  negative: "#ef4444",  // Red for down trends
}
```

## Creating Custom Scenes

```tsx
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";

export const MyScene: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <h1 style={{ opacity, color: colors.text }}>{title}</h1>
    </AbsoluteFill>
  );
};
```

## Project Structure

```
bevalc-videos/
├── src/
│   ├── index.ts          # Entry point
│   ├── Root.tsx          # Composition registration
│   ├── types.ts          # TypeScript interfaces
│   ├── styles.ts         # Design tokens
│   ├── scenes/           # Modular scene components
│   │   ├── TitleCard.tsx
│   │   ├── AnimatedCounter.tsx
│   │   ├── Leaderboard.tsx
│   │   ├── BarChart.tsx
│   │   ├── TrendCard.tsx
│   │   └── EndCard.tsx
│   ├── compositions/     # Full video compositions
│   │   ├── WeeklyRecap.tsx
│   │   └── WeeklyRecapVertical.tsx
│   └── data/
│       └── sample.json   # Sample data for testing
├── out/                  # Rendered videos
├── package.json
├── tsconfig.json
└── remotion.config.ts
```

## Integration with BevAlc Pipeline

To generate videos from the weekly content pipeline:

```bash
# 1. Generate data from D1 (run from scripts/)
python generate_video_data.py --week 2026-01-23 --output ../skills/remotion/bevalc-videos/src/data/this-week.json

# 2. Render videos
cd skills/remotion/bevalc-videos
npm run render:all
```
