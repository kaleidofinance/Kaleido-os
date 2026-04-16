"use client";
import React, { useMemo, useState, useEffect } from "react";

interface V3LiquidityChartProps {
  currentPrice: string;
  minPrice: string;
  maxPrice: string;
  onMinPriceChange: (val: string) => void;
  onMaxPriceChange: (val: string) => void;
  isFullRange: boolean;
}

export default function V3LiquidityChart({
  currentPrice,
  minPrice,
  maxPrice,
  onMinPriceChange,
  onMaxPriceChange,
  isFullRange
}: V3LiquidityChartProps) {
  const price = parseFloat(currentPrice) || 1;
  
  // Generate mock liquidity distribution (Normal distribution curve)
  const chartData = useMemo(() => {
    const points = [];
    const minX = price * 0.5;
    const maxX = price * 1.5;
    const step = (maxX - minX) / 100;

    for (let x = minX; x <= maxX; x += step) {
      // Gaussian distribution formula for a nice hump
      const exponent = -Math.pow(x - price, 2) / (2 * Math.pow(price * 0.2, 2));
      const y = Math.exp(exponent) * 80; // Scale height
      points.push({ x, y });
    }
    return points;
  }, [price]);

  // Convert price to SVG X coordinate
  const priceToX = (p: number) => {
    const minX = price * 0.5;
    const maxX = price * 1.5;
    return ((p - minX) / (maxX - minX)) * 100;
  };

  // Convert SVG X coordinate back to price
  const xToPrice = (x: number) => {
      const minX = price * 0.5;
      const maxX = price * 1.5;
      return minX + (x / 100) * (maxX - minX);
  };

  const currentX = priceToX(price);
  const minXVal = minPrice ? priceToX(parseFloat(minPrice)) : 0;
  const maxXVal = maxPrice ? priceToX(parseFloat(maxPrice)) : 100;

  // Interaction handlers
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);

  useEffect(() => {
    const handleGlobalMouseUp = () => setDragging(null);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging || isFullRange) return;
    
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newPriceVal = xToPrice(x);
    const newPrice = newPriceVal.toFixed(6);

    if (dragging === "min") {
      const maxP = parseFloat(maxPrice) || Infinity;
      if (newPriceVal < maxP) onMinPriceChange(newPrice);
    } else {
      const minP = parseFloat(minPrice) || 0;
      if (newPriceVal > minP) onMaxPriceChange(newPrice);
    }
  };

  return (
    <div className="relative w-full h-48 bg-black/40 rounded-2xl border border-[#00ff99]/10 overflow-hidden group">
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="grid grid-cols-10 h-full w-full">
            {[...Array(10)].map((_, i) => <div key={i} className="border-r border-[#00ff99]/30 h-full"></div>)}
        </div>
      </div>

      <svg 
        className="w-full h-full cursor-crosshair overflow-visible"
        viewBox="0 0 100 100" 
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        {/* Liquidity Area Gradient */}
        <defs>
          <linearGradient id="liquidityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00ff99" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#00ff99" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* The Liquidity Hump */}
        <path
          d={`M ${chartData[0].x} 100 ${chartData.map(p => `L ${priceToX(p.x)} ${100 - p.y}`).join(" ")} L ${priceToX(chartData[chartData.length-1].x)} 100 Z`}
          fill="url(#liquidityGradient)"
          className="transition-all duration-700 ease-out"
        />
        
        <path
          d={chartData.map((p, i) => `${i === 0 ? "M" : "L"} ${priceToX(p.x)} ${100 - p.y}`).join(" ")}
          stroke="#00ff99"
          strokeWidth="0.5"
          fill="none"
          strokeOpacity="0.6"
          filter="url(#glow)"
        />

        {/* Selection Range Overlay */}
        {!isFullRange && (
            <>
                {/* Out of range dimmers */}
                <rect x="0" y="0" width={minXVal} height="100" fill="rgba(0,0,0,0.4)" className="backdrop-blur-[2px]" />
                <rect x={maxXVal} y="0" width={100 - maxXVal} height="100" fill="rgba(0,0,0,0.4)" className="backdrop-blur-[2px]" />
                
                {/* Min Handle */}
                <g className="cursor-ew-resize" onMouseDown={() => setDragging("min")}>
                    <line x1={minXVal} y1="0" x2={minXVal} y2="100" stroke="#00ff99" strokeWidth="0.8" />
                    <circle cx={minXVal} cy="50" r="2.5" fill="#00ff99" className="animate-pulse shadow-[0_0_10px_#00ff99]" />
                </g>

                {/* Max Handle */}
                <g className="cursor-ew-resize" onMouseDown={() => setDragging("max")}>
                    <line x1={maxXVal} y1="0" x2={maxXVal} y2="100" stroke="#00ff99" strokeWidth="0.8" />
                    <circle cx={maxXVal} cy="50" r="2.5" fill="#00ff99" className="animate-pulse shadow-[0_0_10px_#00ff99]" />
                </g>
            </>
        )}

        {/* Current Price Indicator */}
        <g>
            <line 
                x1={currentX} y1="0" x2={currentX} y2="100" 
                stroke="white" strokeWidth="0.3" strokeDasharray="2,2" strokeOpacity="0.5"
            />
            <rect x={currentX - 5} y="2" width="10" height="4" rx="1" fill="white" fillOpacity="0.1" />
            <text x={currentX} y="5" fontSize="3" fill="white" fillOpacity="0.8" textAnchor="middle" fontWeight="bold">PRICE</text>
        </g>
      </svg>

      {/* Stats Overlay */}
      <div className="absolute bottom-2 left-4 px-3 py-1 bg-black/60 rounded-full border border-white/5 backdrop-blur-md">
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
            Efficiency: <span className="text-[#00ff99]">
                {isFullRange ? "1.0x" : (100 / Math.max(1, (maxXVal - minXVal))).toFixed(1) + "x"}
            </span>
        </p>
      </div>
    </div>
  );
}
