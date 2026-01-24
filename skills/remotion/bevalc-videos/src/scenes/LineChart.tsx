import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
} from "remotion";
import { colors, fontSizes, spacing, timing } from "../styles";
import { AnimatedBackground } from "../components";

export interface LineChartProps {
  title: string;
  data: Array<{ label: string; value: number }>;
  yAxisLabel?: string;
  showDots?: boolean;
  lineColor?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  title,
  data,
  yAxisLabel,
  showDots = true,
  lineColor = colors.accent,
}) => {
  const frame = useCurrentFrame();

  // Title fade in
  const titleOpacity = interpolate(frame, [0, timing.fadeIn], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Line draw animation
  const lineProgress = interpolate(
    frame,
    [timing.fadeIn, timing.fadeIn + 70],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  // Calculate chart dimensions
  const chartWidth = 950;
  const chartHeight = 380;
  const paddingLeft = 90;
  const paddingBottom = 70;
  const paddingTop = 30;
  const paddingRight = 50;

  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingBottom - paddingTop;

  // Calculate scales
  const maxValue = Math.max(...data.map((d) => d.value));
  const minValue = Math.min(...data.map((d) => d.value));
  const valueRange = maxValue - minValue || 1;
  const yPadding = valueRange * 0.15;

  const yMin = Math.max(0, minValue - yPadding);
  const yMax = maxValue + yPadding;

  // Generate points
  const points = data.map((d, i) => ({
    x: paddingLeft + (i / (data.length - 1)) * plotWidth,
    y: paddingTop + plotHeight - ((d.value - yMin) / (yMax - yMin)) * plotHeight,
    value: d.value,
    label: d.label,
  }));

  // Generate SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  // Calculate path length for animation
  const totalLength = points.reduce((acc, p, i) => {
    if (i === 0) return 0;
    const prev = points[i - 1];
    return acc + Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2);
  }, 0);

  // Generate Y axis ticks
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) =>
    Math.round(yMin + ((yMax - yMin) * i) / (yTicks - 1))
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
            backgroundColor: colors.bgCard,
            borderRadius: 20,
            padding: spacing.lg,
            border: `1px solid ${colors.bgAccent}`,
          }}
        >
          <svg width={chartWidth} height={chartHeight}>
            {/* Grid lines */}
            {yTickValues.map((tick, i) => {
              const y =
                paddingTop +
                plotHeight -
                ((tick - yMin) / (yMax - yMin)) * plotHeight;
              return (
                <line
                  key={`grid-${i}`}
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke={colors.bgAccent}
                  strokeWidth={1}
                  opacity={0.4}
                />
              );
            })}

            {/* Y axis */}
            <line
              x1={paddingLeft}
              y1={paddingTop}
              x2={paddingLeft}
              y2={chartHeight - paddingBottom}
              stroke={colors.bgAccent}
              strokeWidth={2}
            />

            {/* X axis */}
            <line
              x1={paddingLeft}
              y1={chartHeight - paddingBottom}
              x2={chartWidth - paddingRight}
              y2={chartHeight - paddingBottom}
              stroke={colors.bgAccent}
              strokeWidth={2}
            />

            {/* Y axis ticks and labels */}
            {yTickValues.map((tick, i) => {
              const y =
                paddingTop +
                plotHeight -
                ((tick - yMin) / (yMax - yMin)) * plotHeight;
              return (
                <g key={`y-${i}`}>
                  <text
                    x={paddingLeft - 15}
                    y={y + 5}
                    textAnchor="end"
                    fill={colors.textMuted}
                    fontSize={14}
                    fontFamily={colors.text}
                  >
                    {tick.toLocaleString()}
                  </text>
                </g>
              );
            })}

            {/* Y axis label */}
            {yAxisLabel && (
              <text
                x={25}
                y={chartHeight / 2}
                textAnchor="middle"
                fill={colors.textMuted}
                fontSize={14}
                transform={`rotate(-90, 25, ${chartHeight / 2})`}
              >
                {yAxisLabel}
              </text>
            )}

            {/* X axis labels */}
            {points.map((p, i) => (
              <text
                key={`x-${i}`}
                x={p.x}
                y={chartHeight - paddingBottom + 30}
                textAnchor="middle"
                fill={colors.textMuted}
                fontSize={13}
                opacity={interpolate(
                  frame,
                  [timing.fadeIn + i * 5, timing.fadeIn + i * 5 + 15],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                )}
              >
                {p.label}
              </text>
            ))}

            {/* Area fill under line */}
            <path
              d={`${pathD} L ${points[points.length - 1].x} ${
                chartHeight - paddingBottom
              } L ${paddingLeft} ${chartHeight - paddingBottom} Z`}
              fill={`url(#areaGradient)`}
              opacity={0.15 * lineProgress}
            />

            {/* Gradient definition */}
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.6" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Animated line */}
            <path
              d={pathD}
              fill="none"
              stroke={lineColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLength}
              strokeDashoffset={totalLength * (1 - lineProgress)}
              filter="url(#glow)"
            />

            {/* Dots */}
            {showDots &&
              points.map((p, i) => {
                const dotProgress = interpolate(
                  frame,
                  [
                    timing.fadeIn + 70 + i * 6,
                    timing.fadeIn + 70 + i * 6 + 12,
                  ],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );

                return (
                  <g key={`dot-${i}`}>
                    {/* Outer glow */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={10 * dotProgress}
                      fill={lineColor}
                      opacity={0.2}
                    />
                    {/* Inner dot */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={6 * dotProgress}
                      fill={lineColor}
                      stroke={colors.bgCard}
                      strokeWidth={2}
                    />
                    {/* Value label */}
                    <text
                      x={p.x}
                      y={p.y - 18}
                      textAnchor="middle"
                      fill={colors.text}
                      fontSize={13}
                      fontWeight={600}
                      opacity={dotProgress}
                    >
                      {p.value.toLocaleString()}
                    </text>
                  </g>
                );
              })}
          </svg>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
