import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { LeaderboardProps } from "../types";

export const Leaderboard: React.FC<LeaderboardProps> = ({
  title,
  entries,
  showValues = true,
  maxEntries = 5,
  subtitle,
}) => {
  const frame = useCurrentFrame();

  // Fade in title
  const titleOpacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const displayEntries = entries.slice(0, maxEntries);

  return (
    <AbsoluteFill>
      <AnimatedBackground variant="subtle" />

      <AbsoluteFill
        style={{
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
            marginBottom: subtitle ? spacing.sm : spacing.xl,
            textAlign: "center",
          }}
        >
          {title}
        </h2>

        {/* Subtitle */}
        {subtitle && (
          <p
            style={{
              opacity: titleOpacity,
              fontSize: fontSizes.body,
              color: colors.textMuted,
              marginBottom: spacing.xl,
              textAlign: "center",
            }}
          >
            {subtitle}
          </p>
        )}

        {/* Leaderboard entries */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.sm,
            width: "100%",
            maxWidth: 850,
          }}
        >
          {displayEntries.map((entry, index) => {
            // Stagger each entry's appearance
            const entryStartFrame = timing.fadeIn + index * timing.stagger;
            const entryOpacity = interpolate(
              frame,
              [entryStartFrame, entryStartFrame + 15],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );
            const entryTranslateX = interpolate(
              frame,
              [entryStartFrame, entryStartFrame + 15],
              [-40, 0],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              }
            );

            const isFirst = index === 0;

            return (
              <div
                key={index}
                style={{
                  opacity: entryOpacity,
                  transform: `translateX(${entryTranslateX}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: spacing.md,
                  backgroundColor: colors.bgCard,
                  borderRadius: 14,
                  padding: `${spacing.md}px ${spacing.lg}px`,
                  border: `1px solid ${isFirst ? colors.accent : colors.bgAccent}`,
                  boxShadow: isFirst
                    ? `0 0 20px ${colors.accentGlow}`
                    : "none",
                }}
              >
                {/* Rank */}
                <div
                  style={{
                    fontSize: fontSizes.h3,
                    fontWeight: 700,
                    color: isFirst ? colors.accent : colors.textMuted,
                    width: 50,
                    textAlign: "center",
                  }}
                >
                  {index + 1}
                </div>

                {/* Name */}
                <div
                  style={{
                    flex: 1,
                    fontSize: fontSizes.body,
                    color: colors.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isFirst ? 600 : 400,
                  }}
                >
                  {entry.name}
                </div>

                {/* Category badge (optional) */}
                {entry.category && (
                  <div
                    style={{
                      fontSize: fontSizes.small,
                      color: colors.textMuted,
                      backgroundColor: colors.bgAccent,
                      padding: `${spacing.xs}px ${spacing.sm}px`,
                      borderRadius: 8,
                      border: `1px solid ${colors.bgCardHover}`,
                    }}
                  >
                    {entry.category}
                  </div>
                )}

                {/* Value */}
                {showValues && (
                  <div
                    style={{
                      fontSize: fontSizes.h3,
                      fontWeight: 600,
                      color: isFirst ? colors.accent : colors.text,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {entry.value.toLocaleString()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
