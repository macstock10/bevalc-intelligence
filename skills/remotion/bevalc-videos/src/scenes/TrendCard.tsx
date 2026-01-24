import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import type { TrendCardProps } from "../types";

// Simple arrow icons as SVG
const ArrowUp = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 4L4 12H9V20H15V12H20L12 4Z"
      fill={colors.positive}
    />
  </svg>
);

const ArrowDown = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 20L20 12H15V4H9V12H4L12 20Z"
      fill={colors.negative}
    />
  </svg>
);

export const TrendCard: React.FC<TrendCardProps> = ({
  value,
  label,
  isPositive,
  comparison,
}) => {
  const frame = useCurrentFrame();

  // Fade in
  const opacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Slide up
  const translateY = interpolate(frame, [0, timing.fadeIn], [30, 0], {
    extrapolateRight: "clamp",
  });

  // Icon bounce
  const iconScale = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + 10, timing.fadeIn + 20],
    [0, 1.2, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const trendColor = isPositive ? colors.positive : colors.negative;
  const sign = isPositive ? "+" : "";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: spacing.lg,
          backgroundColor: colors.bgCard,
          borderRadius: 24,
          padding: spacing.xxl,
          minWidth: 400,
        }}
      >
        {/* Icon */}
        <div style={{ transform: `scale(${iconScale})` }}>
          {isPositive ? <ArrowUp /> : <ArrowDown />}
        </div>

        {/* Percentage */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: trendColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sign}{Math.abs(value)}%
        </div>

        {/* Label */}
        <div
          style={{
            fontSize: fontSizes.h3,
            color: colors.text,
            textAlign: "center",
          }}
        >
          {label}
        </div>

        {/* Comparison text */}
        {comparison && (
          <div
            style={{
              fontSize: fontSizes.body,
              color: colors.textMuted,
              textAlign: "center",
            }}
          >
            {comparison}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
