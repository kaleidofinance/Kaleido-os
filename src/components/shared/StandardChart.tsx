"use client";
import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

interface StandardChartProps {
  data: ChartDataPoint[];
  height?: number;
  width?: number;
  color?: string;
  showGrid?: boolean;
  className?: string;
  valuePrefix?: string;
  valueSuffix?: string;
}

export default function StandardChart({
  data,
  height = 300,
  width = 600,
  color = "#00ff99",
  showGrid = true,
  className = "",
  valuePrefix = "",
  valueSuffix = "",
}: StandardChartProps) {
  if (data.length === 0) return null;

  const padding = 6;
  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal || 1;
  const valPadding = range * 0.1;

  const scaleX = (index: number) =>
    padding + (index / (data.length - 1)) * (width - 2 * padding);
  const scaleY = (val: number) =>
    height -
    ((val - minVal + valPadding) / (range + 2 * valPadding)) *
      height;

  const pathData = data
    .map((point, index) => {
      const x = scaleX(index);
      const y = scaleY(point.value);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const firstVal = data[0].value;
  const lastVal = data[data.length - 1].value;
  const change = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className={`relative w-full overflow-hidden ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={color} stopOpacity="0.2" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showGrid && (
          <g className="grid-lines" opacity="0.1">
            {[0, 1, 2, 3, 4].map((i) => {
              const y = padding + (i * (height - 2 * padding)) / 4;
              return (
                <line
                  key={i}
                  x1={padding}
                  y1={y}
                  x2={width - padding}
                  y2={y}
                  stroke={color}
                  strokeWidth="0.5"
                />
              );
            })}
          </g>
        )}

        {/* Area fill */}
        <path
          d={`${pathData} L ${scaleX(data.length - 1)} ${height} L ${scaleX(0)} ${height} Z`}
          fill="url(#chartGradient)"
        />

        {/* Main Line */}
        <path
          d={pathData}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow)"
        />

        {/* End pulse indicator */}
        <circle
          cx={scaleX(data.length - 1)}
          cy={scaleY(lastVal)}
          r="4"
          fill={color}
          filter="url(#glow)"
        />
      </svg>
    </div>
  );
}
