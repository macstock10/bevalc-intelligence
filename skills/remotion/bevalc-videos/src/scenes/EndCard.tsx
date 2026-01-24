import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";
import type { EndCardProps } from "../types";

export const EndCard: React.FC<EndCardProps> = ({
  ctaText = "Track market activity at",
  url = "bevalcintel.com",
}) => {
  const frame = useCurrentFrame();

  // Fade in with easing
  const opacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Scale in logo
  const logoScale = interpolate(
    frame,
    [0, timing.fadeIn + 5],
    [0.9, 1],
    {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // Accent line
  const lineWidth = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + 25],
    [0, 220],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // URL slide up
  const urlTranslateY = interpolate(
    frame,
    [timing.fadeIn + 12, timing.fadeIn + 28],
    [15, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );
  const urlOpacity = interpolate(
    frame,
    [timing.fadeIn + 12, timing.fadeIn + 28],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Subtle glow pulse
  const glowIntensity = interpolate(
    frame % 90,
    [0, 45, 90],
    [0.3, 0.5, 0.3],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <AnimatedBackground variant="vibrant" />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
        }}
      >
        {/* Brand name */}
        <div
          style={{
            opacity,
            transform: `scale(${logoScale})`,
            fontSize: fontSizes.h1,
            fontWeight: 700,
            color: colors.text,
            marginBottom: spacing.md,
            letterSpacing: -1,
          }}
        >
          BevAlc{" "}
          <span
            style={{
              color: colors.accent,
              textShadow: `0 0 40px rgba(0, 212, 170, ${glowIntensity})`,
            }}
          >
            Intelligence
          </span>
        </div>

        {/* Accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
            borderRadius: 2,
            marginBottom: spacing.xl,
            boxShadow: `0 0 30px rgba(0, 212, 170, ${glowIntensity})`,
          }}
        />

        {/* CTA text */}
        <div
          style={{
            opacity,
            fontSize: fontSizes.h3,
            color: colors.textMuted,
            marginBottom: spacing.lg,
          }}
        >
          {ctaText}
        </div>

        {/* URL */}
        <div
          style={{
            opacity: urlOpacity,
            transform: `translateY(${urlTranslateY}px)`,
            fontSize: fontSizes.h2,
            fontWeight: 600,
            color: colors.accent,
            backgroundColor: colors.bgCard,
            padding: `${spacing.md}px ${spacing.xl}px`,
            borderRadius: 14,
            border: `1px solid ${colors.bgAccent}`,
            boxShadow: `0 0 30px rgba(0, 212, 170, ${glowIntensity * 0.5})`,
          }}
        >
          {url}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
