import React from "react";
import { Sequence } from "remotion";
import {
  TitleCard,
  ComparisonCard,
  StatsGrid,
  CategoryBreakdown,
  Leaderboard,
  LineChart,
  EndCard,
} from "../scenes";
import type { VideoData } from "../types";

// Scene durations in frames (at 30fps)
const SCENE_DURATION = {
  title: 90, // 3 seconds
  comparison: 100, // 3.3 seconds
  stats: 100, // 3.3 seconds
  categories: 120, // 4 seconds
  leaderboard: 120, // 4 seconds
  trend: 150, // 5 seconds
  end: 90, // 3 seconds
};

interface WeeklyRecapProps {
  data: VideoData;
}

export const WeeklyRecap: React.FC<WeeklyRecapProps> = ({ data }) => {
  // Calculate sequence start frames
  let currentFrame = 0;

  const sequences = {
    title: { from: currentFrame, duration: SCENE_DURATION.title },
    comparison: {
      from: (currentFrame += SCENE_DURATION.title),
      duration: SCENE_DURATION.comparison,
    },
    stats: {
      from: (currentFrame += SCENE_DURATION.comparison),
      duration: SCENE_DURATION.stats,
    },
    categories: {
      from: (currentFrame += SCENE_DURATION.stats),
      duration: SCENE_DURATION.categories,
    },
    leaderboard: {
      from: (currentFrame += SCENE_DURATION.categories),
      duration: SCENE_DURATION.leaderboard,
    },
    trend: {
      from: (currentFrame += SCENE_DURATION.leaderboard),
      duration: SCENE_DURATION.trend,
    },
    end: {
      from: (currentFrame += SCENE_DURATION.trend),
      duration: SCENE_DURATION.end,
    },
  };

  // Prepare data for scenes
  const topLaunchers = data.topLaunchers || [];
  const categories = data.categories || [];

  // Time series data for trend chart
  // IMPORTANT: These values must come from D1 queries - NEVER fabricate data
  // Query: SELECT COUNT(*) FROM colas WHERE year=X AND month=Y AND day BETWEEN A AND B AND signal IN ('NEW_BRAND', 'NEW_COMPANY')
  const trendData = [
    { label: "Nov 1-14", value: 368 },
    { label: "Nov 15-28", value: 2368 },
    { label: "Dec 1-14", value: 1713 },
    { label: "Dec 15-28", value: 984 },
    { label: "Dec 29-Jan 9", value: 891 },
    { label: "Jan 10-23", value: 927 },
  ];

  return (
    <>
      {/* 1. Title Card */}
      <Sequence from={sequences.title.from} durationInFrames={sequences.title.duration}>
        <TitleCard
          headline={data.headline}
          subheadline="New brands entering the US market"
          dateRange={data.dateRange}
        />
      </Sequence>

      {/* 2. Comparison to Prior Period */}
      <Sequence from={sequences.comparison.from} durationInFrames={sequences.comparison.duration}>
        <ComparisonCard
          value={data.stats.totalMarketEntries}
          comparisonValue={data.stats.priorMarketEntries}
          label="New Market Entries"
          comparisonLabel="Prior 2 Weeks"
        />
      </Sequence>

      {/* 3. Key Stats Grid */}
      <Sequence from={sequences.stats.from} durationInFrames={sequences.stats.duration}>
        <StatsGrid
          title="Market Activity"
          stats={[
            { value: data.stats.newBrands, label: "New Brands", highlight: true },
            { value: data.stats.newCompanies, label: "New Companies" },
            { value: data.stats.newProducts, label: "New Products" },
          ]}
        />
      </Sequence>

      {/* 4. Category Breakdown */}
      {categories.length > 0 && (
        <Sequence from={sequences.categories.from} durationInFrames={sequences.categories.duration}>
          <CategoryBreakdown
            title="New Brands by Category"
            categories={categories}
            totalLabel="Total"
          />
        </Sequence>
      )}

      {/* 5. Top Brand Launchers by Category */}
      {topLaunchers.length > 0 && (
        <Sequence
          from={sequences.leaderboard.from}
          durationInFrames={sequences.leaderboard.duration}
        >
          <Leaderboard
            title="Category Leaders"
            subtitle="Top launcher per category"
            entries={topLaunchers}
            maxEntries={6}
            showValues={true}
          />
        </Sequence>
      )}

      {/* 6. Trend Chart */}
      <Sequence from={sequences.trend.from} durationInFrames={sequences.trend.duration}>
        <LineChart
          title="New Brand Launches Over Time"
          data={trendData}
          yAxisLabel="New Brands"
          showDots={true}
        />
      </Sequence>

      {/* 7. End Card */}
      <Sequence from={sequences.end.from} durationInFrames={sequences.end.duration}>
        <EndCard ctaText="Track market activity at" />
      </Sequence>
    </>
  );
};

// Total duration calculation helper
export const getWeeklyRecapDuration = (): number => {
  return Object.values(SCENE_DURATION).reduce((sum, d) => sum + d, 0);
};
