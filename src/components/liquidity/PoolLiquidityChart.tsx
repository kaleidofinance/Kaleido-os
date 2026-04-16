"use client";
import React, { useMemo } from "react";
import StandardChart, { ChartDataPoint } from "@/components/shared/StandardChart";

interface PoolLiquidityChartProps {
  currentLiquidity: string | number;
  timeframe: string;
  className?: string;
}

export default function PoolLiquidityChart({
  currentLiquidity,
  timeframe,
  className = "",
}: PoolLiquidityChartProps) {
  const liquidityValue = typeof currentLiquidity === "string" 
    ? parseFloat(currentLiquidity.replace(/[$,]/g, "")) 
    : currentLiquidity;

  const data = useMemo(() => {
    if (isNaN(liquidityValue) || liquidityValue <= 0) return [];

    const now = Date.now();
    let duration = 30 * 60 * 1000; // 30m default
    if (timeframe === "1h") duration = 60 * 60 * 1000;
    if (timeframe === "2h") duration = 2 * 60 * 60 * 1000;
    if (timeframe === "1d") duration = 24 * 60 * 60 * 1000;
    if (timeframe === "1M") duration = 30 * 24 * 60 * 60 * 1000;

    const points = 30;
    const step = duration / points;
    
    // Slight volatility for the TVL chart (usually moves less than price)
    const volatility = 0.005; 

    const chartPoints: ChartDataPoint[] = Array(points + 1)
      .fill(0)
      .map((_, i) => {
        const t = now - (points - i) * step;
        // Generate a smooth-ish random walk
        const randomFactor = Math.sin(i * 0.4) * 0.5 + (Math.random() - 0.5) * 0.2;
        const wave = randomFactor * (liquidityValue * volatility);
        
        // Final point must be exactly the current value
        const price = i === points ? liquidityValue : liquidityValue + wave;

        return {
          timestamp: t,
          value: price,
        };
      });

    return chartPoints;
  }, [liquidityValue, timeframe]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 font-mono text-sm">
        No liquidity data available
      </div>
    );
  }

  return (
    <StandardChart 
      data={data} 
      className={className} 
      height={250}
    />
  );
}
