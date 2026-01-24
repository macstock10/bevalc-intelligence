import React from "react";
import { Sequence } from "remotion";
import {
  TitleCard,
  ComparisonCard,
  StatsGrid,
  CategoryBreakdown,
  Leaderboard,
  EndCard,
} from "../scenes";
import type { VideoData } from "../types";

/**
 * LinkedIn Square Format (1080x1080)
 *
 * Optimized for LinkedIn feed - square takes up more space as users scroll.
 * Removed LineChart scene as it's harder to read in square format.
 * Shortened total duration for better engagement.
 */

// Scene durations in frames (at 30fps) - slightly shorter for square format
const SCENE_DURATION = {
  title: 75, // 2.5 seconds
  comparison: 90, // 3 seconds
  stats: 90, // 3 seconds
  categories: 110, // 3.7 seconds
  leaderboard: 100, // 3.3 seconds
  end: 75, // 2.5 seconds
};

interface WeeklyRecapSquareProps {
  data: VideoData;
}

export const WeeklyRecapSquare: React.FC<WeeklyRecapSquareProps> = ({ data }) => {
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
    end: {
      from: (currentFrame += SCENE_DURATION.leaderboard),
      duration: SCENE_DURATION.end,
    },
  };

  // Prepare data for scenes
  const topLaunchers = data.topLaunchers || [];
  // Show fewer categories in square format
  const categories = (data.categories || []).slice(0, 6);

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

      {/* 4. Category Breakdown - top 6 for square format */}
      {categories.length > 0 && (
        <Sequence from={sequences.categories.from} durationInFrames={sequences.categories.duration}>
          <CategoryBreakdown
            title="New Brands by Category"
            categories={categories}
            totalLabel="Total"
          />
        </Sequence>
      )}

      {/* 5. Top Brand Launchers - top 5 for square format */}
      {topLaunchers.length > 0 && (
        <Sequence
          from={sequences.leaderboard.from}
          durationInFrames={sequences.leaderboard.duration}
        >
          <Leaderboard
            title="Category Leaders"
            subtitle="Top launcher per category"
            entries={topLaunchers.slice(0, 5)}
            maxEntries={5}
            showValues={true}
          />
        </Sequence>
      )}

      {/* 6. End Card */}
      <Sequence from={sequences.end.from} durationInFrames={sequences.end.duration}>
        <EndCard ctaText="Track market activity at" />
      </Sequence>
    </>
  );
};

// Total duration: ~18 seconds
export const getWeeklyRecapSquareDuration = (): number => {
  return Object.values(SCENE_DURATION).reduce((sum, d) => sum + d, 0);
};
