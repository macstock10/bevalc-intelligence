import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { StatsGridProps } from "../types";

export const StatsGrid: React.FC<StatsGridProps> = ({ stats, title }) => {
  const frame = useCurrentFrame();

  // Title fade in
  const titleOpacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

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
        {/* Title */}
        {title && (
          <h2
            style={{
              opacity: titleOpacity,
              fontSize: fontSizes.h2,
              fontWeight: 600,
              color: colors.text,
              marginBottom: spacing.xl,
              textAlign: "center",
            }}
          >
            {title}
          </h2>
        )}

        {/* Stats grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, 1fr)`,
            gap: spacing.md,
            width: "100%",
            maxWidth: 950,
          }}
        >
          {stats.map((stat, index) => {
            // Stagger each stat
            const startFrame = timing.fadeIn + index * timing.stagger;
            const statOpacity = interpolate(
              frame,
              [startFrame, startFrame + 20],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );
            const statTranslateY = interpolate(
              frame,
              [startFrame, startFrame + 20],
              [25, 0],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );

            // Animate the number
            const animatedValue = interpolate(
              frame,
              [startFrame, startFrame + 40],
              [0, stat.value],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );

            // Subtle glow for highlighted stat
            const glowIntensity = stat.highlight
              ? interpolate(frame % 90, [0, 45, 90], [0.2, 0.4, 0.2])
              : 0;

            return (
              <div
                key={index}
                style={{
                  opacity: statOpacity,
                  transform: `translateY(${statTranslateY}px)`,
                  backgroundColor: colors.bgCard,
                  borderRadius: 16,
                  padding: spacing.lg,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  border: `1px solid ${stat.highlight ? colors.accent : colors.bgAccent}`,
                  boxShadow: stat.highlight
                    ? `0 0 40px rgba(0, 212, 170, ${glowIntensity})`
                    : "none",
                }}
              >
                {/* Value */}
                <div
                  style={{
                    fontSize: 56,
                    fontWeight: 700,
                    color: stat.highlight ? colors.accent : colors.text,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    textShadow: stat.highlight
                      ? `0 0 30px rgba(0, 212, 170, ${glowIntensity})`
                      : "none",
                  }}
                >
                  {Math.round(animatedValue).toLocaleString()}
                </div>

                {/* Label */}
                <div
                  style={{
                    fontSize: fontSizes.small,
                    color: colors.textMuted,
                    marginTop: spacing.sm,
                    textAlign: "center",
                    lineHeight: 1.3,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
