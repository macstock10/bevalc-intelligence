import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { ComparisonCardProps } from "../types";

export const ComparisonCard: React.FC<ComparisonCardProps> = ({
  value,
  comparisonValue,
  label,
  comparisonLabel,
}) => {
  const frame = useCurrentFrame();

  // Calculate percentage difference
  const percentDiff = comparisonValue > 0
    ? ((value - comparisonValue) / comparisonValue) * 100
    : 0;

  const isAbove = percentDiff >= 0;
  const absPercent = Math.abs(Math.round(percentDiff));

  // Smoother animations
  const opacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const counterDuration = 50;
  const animatedValue = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + counterDuration],
    [0, value],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  const animatedComparison = interpolate(
    frame,
    [timing.fadeIn + 15, timing.fadeIn + counterDuration + 15],
    [0, comparisonValue],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // Badge animation with subtle bounce
  const badgeOpacity = interpolate(
    frame,
    [timing.fadeIn + counterDuration, timing.fadeIn + counterDuration + 20],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const badgeScale = interpolate(
    frame,
    [timing.fadeIn + counterDuration, timing.fadeIn + counterDuration + 15, timing.fadeIn + counterDuration + 25],
    [0.8, 1.05, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Subtle glow pulse
  const glowIntensity = interpolate(
    frame % 60,
    [0, 30, 60],
    [0.3, 0.5, 0.3],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <AnimatedBackground variant="subtle" />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xxl,
        }}
      >
        {/* Label */}
        <div
          style={{
            opacity,
            fontSize: fontSizes.h3,
            color: colors.textMuted,
            marginBottom: spacing.lg,
            textTransform: "uppercase",
            letterSpacing: 3,
            fontWeight: 500,
          }}
        >
          {label}
        </div>

        {/* Main value with glow */}
        <div
          style={{
            opacity,
            fontSize: 130,
            fontWeight: 700,
            color: colors.text,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            marginBottom: spacing.xl,
            textShadow: `0 0 60px rgba(0, 212, 170, ${glowIntensity})`,
          }}
        >
          {Math.round(animatedValue).toLocaleString()}
        </div>

        {/* Comparison section */}
        <div
          style={{
            opacity,
            display: "flex",
            alignItems: "center",
            gap: spacing.xl,
            backgroundColor: colors.bgCard,
            padding: `${spacing.lg}px ${spacing.xl}px`,
            borderRadius: 20,
            border: `1px solid ${colors.bgAccent}`,
          }}
        >
          {/* Comparison value */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: fontSizes.h2,
                fontWeight: 600,
                color: colors.textMuted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(animatedComparison).toLocaleString()}
            </span>
            <span
              style={{
                fontSize: fontSizes.small,
                color: colors.textDim,
                marginTop: spacing.xs,
              }}
            >
              {comparisonLabel}
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 2,
              height: 60,
              background: `linear-gradient(180deg, transparent, ${colors.bgAccent}, transparent)`,
            }}
          />

          {/* Percentage badge */}
          <div
            style={{
              opacity: badgeOpacity,
              transform: `scale(${badgeScale})`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              {/* Arrow */}
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                style={{
                  transform: isAbove ? "rotate(0deg)" : "rotate(180deg)",
                  filter: `drop-shadow(0 0 8px ${isAbove ? colors.positive : colors.negative})`,
                }}
              >
                <path
                  d="M12 4L4 12H9V20H15V12H20L12 4Z"
                  fill={isAbove ? colors.positive : colors.negative}
                />
              </svg>
              <span
                style={{
                  fontSize: fontSizes.h2,
                  fontWeight: 700,
                  color: isAbove ? colors.positive : colors.negative,
                }}
              >
                {absPercent}%
              </span>
            </div>
            <span
              style={{
                fontSize: fontSizes.small,
                color: colors.textDim,
                marginTop: spacing.xs,
              }}
            >
              {isAbove ? "above" : "below"} prior
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
