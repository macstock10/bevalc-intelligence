import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import type { BarChartProps } from "../types";

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  maxBars = 6,
}) => {
  const frame = useCurrentFrame();

  // Fade in title
  const titleOpacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
  });

  const displayData = data.slice(0, maxBars);
  const maxValue = Math.max(...displayData.map((d) => d.value));

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
      {/* Title */}
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

      {/* Chart container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.md,
          width: "100%",
          maxWidth: 1000,
        }}
      >
        {displayData.map((item, index) => {
          // Stagger bar animations
          const barStartFrame = timing.fadeIn + index * timing.stagger;
          const barProgress = interpolate(
            frame,
            [barStartFrame, barStartFrame + 30],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            }
          );

          const barWidth = (item.value / maxValue) * 100 * barProgress;
          const labelOpacity = interpolate(
            frame,
            [barStartFrame, barStartFrame + 10],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          const barColor = colors.chart[index % colors.chart.length];

          return (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              {/* Label */}
              <div
                style={{
                  opacity: labelOpacity,
                  width: 200,
                  fontSize: fontSizes.body,
                  color: colors.text,
                  textAlign: "right",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.name}
              </div>

              {/* Bar container */}
              <div
                style={{
                  flex: 1,
                  height: 40,
                  backgroundColor: colors.bgCard,
                  borderRadius: 8,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {/* Animated bar */}
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: "100%",
                    backgroundColor: barColor,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: spacing.sm,
                  }}
                >
                  {barProgress > 0.5 && (
                    <span
                      style={{
                        fontSize: fontSizes.small,
                        fontWeight: 600,
                        color: colors.bg,
                        opacity: interpolate(barProgress, [0.5, 0.8], [0, 1]),
                      }}
                    >
                      {item.value.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
