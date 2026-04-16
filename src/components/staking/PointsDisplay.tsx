"use client";
import React from "react";
import { formatPoints } from "@/utils/pointsUtils";
import { TrendingUp, Star, Clock } from "lucide-react";

interface PointsDisplayProps {
  totalPoints: string | number | bigint;
  unclaimedPoints?: string | number | bigint;
  multiplier?: number;
  className?: string;
  showDetails?: boolean;
}

export default function PointsDisplay({
  totalPoints,
  unclaimedPoints = "0",
  multiplier = 1,
  className = "",
  showDetails = false,
}: PointsDisplayProps) {
  const formattedTotalPoints = formatPoints(totalPoints);
  const formattedUnclaimedPoints = formatPoints(unclaimedPoints);
  const hasUnclaimedPoints = Number(unclaimedPoints) > 0;

  return (
    <div className={`bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/20 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Star className="w-5 h-5 text-orange-400" />
          <span className="text-orange-400 font-medium">Points Earned</span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">{formattedTotalPoints}</p>
          {hasUnclaimedPoints && (
            <p className="text-sm text-orange-300">+{formattedUnclaimedPoints} unclaimed</p>
          )}
        </div>
      </div>
      
      {showDetails && (
        <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-orange-500/20">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 text-orange-400" />
            <div>
              <p className="text-xs text-gray-400">Multiplier</p>
              <p className="text-sm font-medium text-orange-400">×{multiplier.toFixed(1)}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-orange-400" />
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <p className="text-sm font-medium text-green-400">
                {hasUnclaimedPoints ? "Earning" : "Staked"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
