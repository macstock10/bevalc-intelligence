import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { TitleCardProps } from "../types";

export const TitleCard: React.FC<TitleCardProps> = ({
  headline,
  subheadline,
  dateRange,
}) => {
  const frame = useCurrentFrame();

  // Smoother fade in with easing
  const opacity = interpolate(frame, [0, timing.fadeIn + 10], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Gentle slide up
  const translateY = interpolate(frame, [0, timing.fadeIn + 10], [30, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Accent line grows smoothly
  const lineWidth = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + 30],
    [0, 180],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // Subtle scale for headline
  const headlineScale = interpolate(
    frame,
    [0, timing.fadeIn + 15],
    [0.97, 1],
    {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  return (
    <AbsoluteFill>
      <AnimatedBackground variant="default" />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xxl,
        }}
      >
        {/* Brand badge */}
        <div
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            marginBottom: spacing.xl,
            display: "flex",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: colors.accent,
              boxShadow: `0 0 20px ${colors.accentGlow}`,
            }}
          />
          <span
            style={{
              fontSize: fontSizes.body,
              color: colors.textMuted,
              letterSpacing: 4,
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            BevAlc Intelligence
          </span>
        </div>

        {/* Date range badge */}
        {dateRange && (
          <div
            style={{
              opacity: interpolate(frame, [8, timing.fadeIn + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              backgroundColor: colors.bgCard,
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderRadius: 10,
              marginBottom: spacing.lg,
              border: `1px solid ${colors.bgAccent}`,
            }}
          >
            <span
              style={{
                fontSize: fontSizes.body,
                color: colors.accent,
                fontWeight: 600,
              }}
            >
              {dateRange}
            </span>
          </div>
        )}

        {/* Accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
            borderRadius: 2,
            marginBottom: spacing.xl,
            boxShadow: `0 0 30px ${colors.accentGlow}`,
          }}
        />

        {/* Headline */}
        <h1
          style={{
            opacity,
            transform: `translateY(${translateY * 0.5}px) scale(${headlineScale})`,
            fontSize: fontSizes.h1,
            fontWeight: 700,
            color: colors.text,
            textAlign: "center",
            lineHeight: 1.1,
            maxWidth: "85%",
            margin: 0,
            letterSpacing: -2,
          }}
        >
          {headline}
        </h1>

        {/* Subheadline */}
        {subheadline && (
          <p
            style={{
              opacity: interpolate(
                frame,
                [timing.fadeIn + 5, timing.fadeIn + 20],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              ),
              fontSize: fontSizes.h3,
              color: colors.textMuted,
              textAlign: "center",
              marginTop: spacing.lg,
              fontWeight: 400,
            }}
          >
            {subheadline}
          </p>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
