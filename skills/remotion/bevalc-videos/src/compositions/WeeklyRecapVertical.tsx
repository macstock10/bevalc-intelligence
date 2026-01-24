import React from "react";
import { Sequence } from "remotion";
import {
  TitleCard,
  ComparisonCard,
  StatsGrid,
  Leaderboard,
  EndCard,
} from "../scenes";
import type { VideoData } from "../types";

// Scene durations in frames (at 30fps) - optimized for vertical/short-form
const SCENE_DURATION = {
  title: 75, // 2.5 seconds
  comparison: 90, // 3 seconds
  stats: 90, // 3 seconds
  leaderboard: 105, // 3.5 seconds
  end: 75, // 2.5 seconds
};

interface WeeklyRecapVerticalProps {
  data: VideoData;
}

export const WeeklyRecapVertical: React.FC<WeeklyRecapVerticalProps> = ({
  data,
}) => {
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
    leaderboard: {
      from: (currentFrame += SCENE_DURATION.stats),
      duration: SCENE_DURATION.leaderboard,
    },
    end: {
      from: (currentFrame += SCENE_DURATION.leaderboard),
      duration: SCENE_DURATION.end,
    },
  };

  const topLaunchers = data.topLaunchers || [];

  return (
    <>
      {/* 1. Title Card */}
      <Sequence from={sequences.title.from} durationInFrames={sequences.title.duration}>
        <TitleCard
          headline={data.headline}
          subheadline="New brands entering the market"
          dateRange={data.dateRange}
        />
      </Sequence>

      {/* 2. Comparison to Prior Period */}
      <Sequence from={sequences.comparison.from} durationInFrames={sequences.comparison.duration}>
        <ComparisonCard
          value={data.stats.totalMarketEntries}
          comparisonValue={data.stats.priorMarketEntries}
          label="Market Entries"
          comparisonLabel="Prior Period"
        />
      </Sequence>

      {/* 3. Key Stats */}
      <Sequence from={sequences.stats.from} durationInFrames={sequences.stats.duration}>
        <StatsGrid
          stats={[
            { value: data.stats.newBrands, label: "New Brands", highlight: true },
            { value: data.stats.newCompanies, label: "New Companies" },
          ]}
        />
      </Sequence>

      {/* 4. Top Brand Launchers */}
      {topLaunchers.length > 0 && (
        <Sequence
          from={sequences.leaderboard.from}
          durationInFrames={sequences.leaderboard.duration}
        >
          <Leaderboard
            title="Top Launchers"
            entries={topLaunchers}
            maxEntries={4}
            showValues={true}
          />
        </Sequence>
      )}

      {/* 5. End Card */}
      <Sequence from={sequences.end.from} durationInFrames={sequences.end.duration}>
        <EndCard ctaText="Track activity at" />
      </Sequence>
    </>
  );
};

// Total duration calculation helper
export const getWeeklyRecapVerticalDuration = (): number => {
  return Object.values(SCENE_DURATION).reduce((sum, d) => sum + d, 0);
};
