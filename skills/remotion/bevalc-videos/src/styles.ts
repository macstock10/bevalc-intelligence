// Design tokens for BevAlc Intelligence videos
// Sophisticated, professional, dark theme with subtle depth

export const colors = {
  // Background - deeper, richer darks
  bg: "#0a0f1a", // Deep navy
  bgAlt: "#0d1424", // Slightly lighter for depth
  bgCard: "#131c2e", // Card background
  bgCardHover: "#1a2540", // Card hover/accent
  bgAccent: "#243352", // Accent backgrounds

  // Text - refined hierarchy
  text: "#f1f5f9", // Primary text
  textMuted: "#8b9cb8", // Secondary text
  textDim: "#5a6a85", // Tertiary text

  // Accent - refined teal with glow potential
  accent: "#00d4aa", // Vibrant teal
  accentLight: "#4eebc9", // Light accent
  accentDark: "#00a88a", // Dark accent
  accentGlow: "rgba(0, 212, 170, 0.15)", // For glows

  // Semantic - slightly muted for sophistication
  positive: "#00c896", // Softer green
  negative: "#ff6b6b", // Softer red
  neutral: "#8b9cb8",

  // Gradient stops
  gradientStart: "#0a0f1a",
  gradientMid: "#0d1829",
  gradientEnd: "#0a1628",

  // Chart colors - more harmonious palette
  chart: [
    "#00d4aa", // Teal (primary)
    "#7c5cff", // Purple
    "#ff9f43", // Orange
    "#ff6b9d", // Pink
    "#00b8d4", // Cyan
    "#a3e635", // Lime
    "#f472b6", // Rose
    "#60a5fa", // Blue
  ],
};

export const fonts = {
  heading: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  body: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "JetBrains Mono, SF Mono, monospace",
};

export const fontSizes = {
  // Horizontal (1920x1080) - refined scale
  h1: 76,
  h2: 52,
  h3: 36,
  body: 26,
  small: 20,
  tiny: 16,

  // Vertical multiplier (for 1080x1920)
  verticalScale: 0.85,
};

export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
  xxl: 72,
};

// Common styles
export const baseStyles = {
  container: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.bg,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    fontFamily: fonts.body,
    color: colors.text,
    padding: spacing.xl,
  },

  card: {
    backgroundColor: colors.bgCard,
    borderRadius: 20,
    padding: spacing.lg,
    border: `1px solid ${colors.bgAccent}`,
  },

  headline: {
    fontSize: fontSizes.h1,
    fontWeight: 700,
    color: colors.text,
    textAlign: "center" as const,
    lineHeight: 1.15,
    letterSpacing: -1,
  },

  subheadline: {
    fontSize: fontSizes.h3,
    fontWeight: 400,
    color: colors.textMuted,
    textAlign: "center" as const,
  },

  accent: {
    color: colors.accent,
  },
};

// Animation timing - smoother, more deliberate
export const timing = {
  fadeIn: 20, // slightly longer fade
  stagger: 6, // tighter stagger for flow
  counterDuration: 50, // smoother counter
  holdDuration: 60,
};

// Animation easing presets (for use with Remotion's Easing)
export const easings = {
  smooth: [0.25, 0.1, 0.25, 1], // cubic-bezier for smooth motion
  bounce: [0.34, 1.56, 0.64, 1], // slight overshoot
  snappy: [0.4, 0, 0.2, 1], // quick start, smooth end
};
