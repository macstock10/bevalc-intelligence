import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import type { CounterProps } from "../types";

export const AnimatedCounter: React.FC<CounterProps> = ({
  value,
  label,
  suffix = "",
  prefix = "",
  duration = timing.counterDuration,
}) => {
  const frame = useCurrentFrame();

  // Fade in the container
  const opacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Animate the number
  const animatedValue = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + duration],
    [0, value],
    {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // Scale pulse when number completes
  const scale = interpolate(
    frame,
    [timing.fadeIn + duration - 5, timing.fadeIn + duration, timing.fadeIn + duration + 10],
    [1, 1.05, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Format the number with commas
  const formattedValue = Math.round(animatedValue).toLocaleString();

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
      {/* Label above */}
      <div
        style={{
          opacity,
          fontSize: fontSizes.h3,
          color: colors.textMuted,
          marginBottom: spacing.md,
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {label}
      </div>

      {/* Big number */}
      <div
        style={{
          opacity,
          transform: `scale(${scale})`,
          display: "flex",
          alignItems: "baseline",
          gap: spacing.sm,
        }}
      >
        {prefix && (
          <span
            style={{
              fontSize: fontSizes.h2,
              color: colors.textMuted,
            }}
          >
            {prefix}
          </span>
        )}
        <span
          style={{
            fontSize: 140,
            fontWeight: 700,
            color: colors.accent,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formattedValue}
        </span>
        {suffix && (
          <span
            style={{
              fontSize: fontSizes.h2,
              color: colors.textMuted,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};
