import React from "react";
import { Composition } from "remotion";
import { WeeklyRecap, getWeeklyRecapDuration } from "./compositions/WeeklyRecap";
import {
  WeeklyRecapSquare,
  getWeeklyRecapSquareDuration,
} from "./compositions/WeeklyRecapSquare";
import {
  WeeklyRecapVertical,
  getWeeklyRecapVerticalDuration,
} from "./compositions/WeeklyRecapVertical";
import {
  TitleCard,
  AnimatedCounter,
  Leaderboard,
  BarChart,
  EndCard,
  ComparisonCard,
  StatsGrid,
  CategoryBreakdown,
  LineChart,
} from "./scenes";
import type { VideoData, CategoryData } from "./types";
import type { LineChartProps } from "./scenes/LineChart";

/**
 * CRITICAL: ALL DATA MUST COME FROM D1 QUERIES - NEVER FABRICATE NUMBERS
 *
 * Data sources:
 * - New brands/companies: signal IN ('NEW_BRAND', 'NEW_COMPANY')
 * - Categories: GROUP BY category
 * - Top launchers: GROUP BY category, company_name with ROW_NUMBER()
 *
 * Last updated: Jan 24, 2026 from D1 queries
 */
const defaultData: VideoData = {
  weekEnding: "January 23, 2026",
  dateRange: "Jan 10-23",
  headline: "927 New Brands Entered the Market",
  stats: {
    // Current 2 weeks (Jan 10-23)
    newCompanies: 31,
    newBrands: 896,
    newProducts: 1293,
    // Prior 2 weeks (Dec 27 - Jan 9)
    priorNewCompanies: 34,
    priorNewBrands: 857,
    priorNewProducts: 1314,
    // Totals
    totalMarketEntries: 927,  // 31 + 896
    priorMarketEntries: 891,  // 34 + 857
  },
  categories: [
    { name: "Wine", value: 526, percentage: 56.7 },
    { name: "Beer", value: 224, percentage: 24.2 },
    { name: "Whiskey", value: 54, percentage: 5.8 },
    { name: "Vodka", value: 34, percentage: 3.7 },
    { name: "Tequila", value: 23, percentage: 2.5 },
    { name: "Rum", value: 18, percentage: 1.9 },
    { name: "Gin", value: 12, percentage: 1.3 },
    { name: "Other", value: 36, percentage: 3.9 },
  ],
  // Top launcher per category (from D1 query)
  topLaunchers: [
    { name: "Voila Wine", value: 28, category: "Wine" },
    { name: "Ska Brewing", value: 16, category: "Beer" },
    { name: "Bardstown Bourbon", value: 7, category: "Whiskey" },
    { name: "Consentio", value: 4, category: "Tequila" },
    { name: "Irokos Group", value: 4, category: "Rum" },
    { name: "American Thunder Distilling", value: 2, category: "Vodka" },
  ],
};

// CRITICAL: All data MUST come from D1 queries - NEVER fabricate numbers
// Time series data from D1 (2-week periods, NEW_BRAND + NEW_COMPANY signals)
const timeSeriesData = [
  { label: "Nov 1-14", value: 368 },
  { label: "Nov 15-28", value: 2368 },
  { label: "Dec 1-14", value: 1713 },
  { label: "Dec 15-28", value: 984 },
  { label: "Dec 29-Jan 9", value: 891 },
  { label: "Jan 10-23", value: 927 },
];

// Wrapper components that accept defaultProps properly
const WeeklyRecapWrapper: React.FC<{ data?: VideoData }> = ({
  data = defaultData
}) => <WeeklyRecap data={data} />;

const WeeklyRecapSquareWrapper: React.FC<{ data?: VideoData }> = ({
  data = defaultData
}) => <WeeklyRecapSquare data={data} />;

const WeeklyRecapVerticalWrapper: React.FC<{ data?: VideoData }> = ({
  data = defaultData
}) => <WeeklyRecapVertical data={data} />;

const TitleCardWrapper: React.FC<{
  headline?: string;
  subheadline?: string;
  dateRange?: string;
}> = ({
  headline = "927 New Brands Entered the Market",
  subheadline = "New brands entering the US market",
  dateRange = "Jan 10-23",
}) => <TitleCard headline={headline} subheadline={subheadline} dateRange={dateRange} />;

const AnimatedCounterWrapper: React.FC<{
  value?: number;
  label?: string;
  suffix?: string;
  prefix?: string;
}> = ({
  value = 927,
  label = "New Market Entries",
  suffix,
  prefix,
}) => <AnimatedCounter value={value} label={label} suffix={suffix} prefix={prefix} />;

const ComparisonCardWrapper: React.FC<{
  value?: number;
  comparisonValue?: number;
  label?: string;
  comparisonLabel?: string;
}> = ({
  value = 927,
  comparisonValue = 891,
  label = "New Market Entries",
  comparisonLabel = "Prior 2 Weeks",
}) => (
  <ComparisonCard
    value={value}
    comparisonValue={comparisonValue}
    label={label}
    comparisonLabel={comparisonLabel}
  />
);

const StatsGridWrapper: React.FC<{
  title?: string;
  stats?: Array<{ value: number; label: string; highlight?: boolean }>;
}> = ({
  title = "Market Activity",
  stats = [
    { value: 896, label: "New Brands", highlight: true },
    { value: 31, label: "New Companies" },
    { value: 1293, label: "New Products" },
  ],
}) => <StatsGrid title={title} stats={stats} />;

const CategoryBreakdownWrapper: React.FC<{
  title?: string;
  categories?: CategoryData[];
  totalLabel?: string;
  totalValue?: number;
}> = ({
  title = "New Brands by Category",
  categories = defaultData.categories,
  totalLabel = "Total",
  totalValue,
}) => (
  <CategoryBreakdown
    title={title}
    categories={categories}
    totalLabel={totalLabel}
    totalValue={totalValue}
  />
);

const LeaderboardWrapper: React.FC<{
  title?: string;
  entries?: Array<{ name: string; value: number; category?: string }>;
  showValues?: boolean;
  maxEntries?: number;
  subtitle?: string;
}> = ({
  title = "Category Leaders",
  entries = defaultData.topLaunchers,
  showValues = true,
  maxEntries = 6,
  subtitle = "Top launcher per category",
}) => <Leaderboard title={title} entries={entries} showValues={showValues} maxEntries={maxEntries} subtitle={subtitle} />;

const BarChartWrapper: React.FC<{
  title?: string;
  data?: Array<{ name: string; value: number }>;
  maxBars?: number;
}> = ({
  title = "New Brands by Category",
  data = defaultData.categories.map(c => ({ name: c.name, value: c.value })),
  maxBars,
}) => <BarChart title={title} data={data} maxBars={maxBars} />;

const LineChartWrapper: React.FC<Partial<LineChartProps>> = ({
  title = "New Brand Launches Over Time",
  data = timeSeriesData,
  yAxisLabel = "New Brands",
  showDots = true,
}) => <LineChart title={title} data={data} yAxisLabel={yAxisLabel} showDots={showDots} />;

const EndCardWrapper: React.FC<{
  ctaText?: string;
  url?: string;
}> = ({ ctaText = "Track market activity at", url }) => <EndCard ctaText={ctaText} url={url} />;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main compositions */}
      {/* Main compositions */}
      <Composition
        id="WeeklyRecap"
        component={WeeklyRecapWrapper}
        durationInFrames={getWeeklyRecapDuration()}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* RECOMMENDED FOR LINKEDIN - Square format takes up more feed space */}
      <Composition
        id="WeeklyRecapSquare"
        component={WeeklyRecapSquareWrapper}
        durationInFrames={getWeeklyRecapSquareDuration()}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="WeeklyRecapVertical"
        component={WeeklyRecapVerticalWrapper}
        durationInFrames={getWeeklyRecapVerticalDuration()}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />

      {/* Individual scene previews for testing */}
      <Composition
        id="TitleCard"
        component={TitleCardWrapper}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="AnimatedCounter"
        component={AnimatedCounterWrapper}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="ComparisonCard"
        component={ComparisonCardWrapper}
        durationInFrames={100}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="StatsGrid"
        component={StatsGridWrapper}
        durationInFrames={100}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="CategoryBreakdown"
        component={CategoryBreakdownWrapper}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="Leaderboard"
        component={LeaderboardWrapper}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="BarChart"
        component={BarChartWrapper}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="LineChart"
        component={LineChartWrapper}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="EndCard"
        component={EndCardWrapper}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Square format scene previews (1080x1080 for LinkedIn) */}
      <Composition
        id="TitleCardSquare"
        component={TitleCardWrapper}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="StatsGridSquare"
        component={StatsGridWrapper}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="CategoryBreakdownSquare"
        component={CategoryBreakdownWrapper}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="LeaderboardSquare"
        component={LeaderboardWrapper}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="EndCardSquare"
        component={EndCardWrapper}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
};
