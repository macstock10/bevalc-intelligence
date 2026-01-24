import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../styles";

interface AnimatedBackgroundProps {
  variant?: "default" | "subtle" | "vibrant";
}

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  variant = "default",
}) => {
  const frame = useCurrentFrame();

  // Slow-moving gradient orbs
  const orb1X = interpolate(frame, [0, 300], [0, 100], {
    extrapolateRight: "clamp",
  });
  const orb1Y = interpolate(frame, [0, 400], [0, 50], {
    extrapolateRight: "clamp",
  });
  const orb2X = interpolate(frame, [0, 350], [100, 0], {
    extrapolateRight: "clamp",
  });
  const orb2Y = interpolate(frame, [0, 450], [50, 0], {
    extrapolateRight: "clamp",
  });

  // Subtle pulse for orbs
  const pulse = interpolate(
    frame % 120,
    [0, 60, 120],
    [1, 1.1, 1],
    { extrapolateRight: "clamp" }
  );

  const orbOpacity = variant === "subtle" ? 0.03 : variant === "vibrant" ? 0.08 : 0.05;
  const orbSize = variant === "vibrant" ? 800 : 600;

  return (
    <AbsoluteFill>
      {/* Base gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 0%, ${colors.bgAlt} 0%, ${colors.bg} 70%)`,
        }}
      />

      {/* Animated orb 1 - top left, teal */}
      <div
        style={{
          position: "absolute",
          top: `${-20 + orb1Y * 0.3}%`,
          left: `${-10 + orb1X * 0.2}%`,
          width: orbSize,
          height: orbSize,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colors.accent} 0%, transparent 70%)`,
          opacity: orbOpacity * pulse,
          filter: "blur(80px)",
          transform: `scale(${pulse})`,
        }}
      />

      {/* Animated orb 2 - bottom right, purple */}
      <div
        style={{
          position: "absolute",
          bottom: `${-20 + orb2Y * 0.3}%`,
          right: `${-10 + orb2X * 0.2}%`,
          width: orbSize * 0.8,
          height: orbSize * 0.8,
          borderRadius: "50%",
          background: `radial-gradient(circle, #7c5cff 0%, transparent 70%)`,
          opacity: orbOpacity * 0.8,
          filter: "blur(100px)",
        }}
      />

      {/* Animated orb 3 - center, subtle teal */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${1 + (pulse - 1) * 0.5})`,
          width: orbSize * 1.5,
          height: orbSize * 1.5,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colors.accentGlow} 0%, transparent 60%)`,
          opacity: orbOpacity * 0.5,
          filter: "blur(120px)",
        }}
      />

      {/* Subtle noise texture overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.015,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%, transparent 40%, ${colors.bg} 100%)`,
          opacity: 0.4,
        }}
      />
    </AbsoluteFill>
  );
};
