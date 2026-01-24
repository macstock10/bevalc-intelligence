// Data types for BevAlc Intelligence videos

export interface LeaderboardEntry {
  name: string;
  value: number;
  category?: string;
}

export interface CategoryData {
  name: string;
  value: number;
  percentage: number;
  color?: string;
}

// Market activity stats (2-week period)
export interface MarketStats {
  // Core creation metrics
  newCompanies: number;
  newBrands: number;
  newProducts: number;  // SKUs

  // Comparison to prior period
  priorNewCompanies: number;
  priorNewBrands: number;
  priorNewProducts: number;

  // Computed totals
  totalMarketEntries: number;  // newCompanies + newBrands
  priorMarketEntries: number;
}

export interface VideoData {
  // Header info
  weekEnding: string;
  dateRange: string;  // "Jan 10-23"
  headline: string;

  // Core stats
  stats: MarketStats;

  // Category breakdown (for new brands)
  categories: CategoryData[];

  // Leaderboard data
  topLaunchers: LeaderboardEntry[];  // Companies launching most new brands

  // Optional
  topBrands?: LeaderboardEntry[];
}

// Scene props
export interface TitleCardProps {
  headline: string;
  subheadline?: string;
  dateRange?: string;
  accentColor?: string;
}

export interface CounterProps {
  value: number;
  label: string;
  suffix?: string;
  prefix?: string;
  subtext?: string;
  duration?: number;
}

export interface ComparisonCardProps {
  value: number;
  comparisonValue: number;
  label: string;
  comparisonLabel: string;
}

export interface StatsGridProps {
  stats: Array<{
    value: number;
    label: string;
    highlight?: boolean;
  }>;
  title?: string;
}

export interface CategoryBreakdownProps {
  categories: CategoryData[];
  title?: string;
  totalLabel?: string;
  totalValue?: number;
}

export interface LeaderboardProps {
  title: string;
  entries: LeaderboardEntry[];
  showValues?: boolean;
  maxEntries?: number;
  subtitle?: string;
}

export interface EndCardProps {
  ctaText?: string;
  url?: string;
}

export interface BarChartProps {
  title: string;
  data: Array<{ name: string; value: number }>;
  maxBars?: number;
}

export interface TrendCardProps {
  value: number;
  label: string;
  isPositive: boolean;
  comparison?: string;
}
