import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { CategoryBreakdownProps } from "../types";

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({
  categories,
  title,
  totalLabel = "Total",
  totalValue,
}) => {
  const frame = useCurrentFrame();

  // Title fade in
  const titleOpacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Calculate total if not provided
  const total = totalValue ?? categories.reduce((sum, cat) => sum + cat.value, 0);

  // Sort categories by value descending
  const sortedCategories = [...categories].sort((a, b) => b.value - a.value);
  const maxValue = sortedCategories[0]?.value || 1;

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

        {/* Bar chart */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.md,
            width: "100%",
            maxWidth: 1000,
          }}
        >
          {sortedCategories.slice(0, 8).map((category, index) => {
            const startFrame = timing.fadeIn + index * timing.stagger;

            const barOpacity = interpolate(
              frame,
              [startFrame, startFrame + 15],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );

            const barWidth = interpolate(
              frame,
              [startFrame, startFrame + 35],
              [0, (category.value / maxValue) * 100],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );

            const labelOpacity = interpolate(
              frame,
              [startFrame, startFrame + 12],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }
            );

            const percentage = ((category.value / total) * 100).toFixed(1);
            const barColor = category.color || colors.chart[index % colors.chart.length];

            return (
              <div
                key={index}
                style={{
                  opacity: barOpacity,
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.md,
                }}
              >
                {/* Category label */}
                <div
                  style={{
                    opacity: labelOpacity,
                    width: 100,
                    minWidth: 80,
                    fontSize: fontSizes.small,
                    color: colors.text,
                    textAlign: "right",
                    fontWeight: 500,
                  }}
                >
                  {category.name}
                </div>

                {/* Bar container */}
                <div
                  style={{
                    flex: 1,
                    height: 44,
                    backgroundColor: colors.bgCard,
                    borderRadius: 10,
                    overflow: "hidden",
                    position: "relative",
                    border: `1px solid ${colors.bgAccent}`,
                  }}
                >
                  {/* Animated bar */}
                  <div
                    style={{
                      width: `${barWidth}%`,
                      height: "100%",
                      background: `linear-gradient(90deg, ${barColor}, ${barColor}dd)`,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      paddingRight: spacing.md,
                      boxShadow: index === 0 ? `0 0 20px ${barColor}40` : "none",
                    }}
                  >
                    {barWidth > 15 && (
                      <span
                        style={{
                          fontSize: fontSizes.small,
                          fontWeight: 600,
                          color: "#fff",
                          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                        }}
                      >
                        {category.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Percentage */}
                <div
                  style={{
                    opacity: labelOpacity,
                    width: 55,
                    fontSize: fontSizes.small,
                    color: colors.textMuted,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {percentage}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Total footer */}
        <div
          style={{
            opacity: interpolate(
              frame,
              [timing.fadeIn + sortedCategories.length * timing.stagger, timing.fadeIn + sortedCategories.length * timing.stagger + 15],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            ),
            marginTop: spacing.xl,
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
            backgroundColor: colors.bgCard,
            padding: `${spacing.sm}px ${spacing.lg}px`,
            borderRadius: 10,
            border: `1px solid ${colors.bgAccent}`,
          }}
        >
          <span style={{ fontSize: fontSizes.body, color: colors.textMuted }}>
            {totalLabel}:
          </span>
          <span
            style={{
              fontSize: fontSizes.h3,
              fontWeight: 700,
              color: colors.accent,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {total.toLocaleString()}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
