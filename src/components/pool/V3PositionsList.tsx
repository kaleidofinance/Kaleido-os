"use client";
import React from "react";
import { useV3Positions } from "@/hooks/dex/useV3Positions";
import V3PositionCard from "./V3PositionCard";
import Loading from "@/components/ui/loading";
import { Plus } from "lucide-react";
import Link from "next/link";
import Button from "@/components/shared/Button";

export default function V3PositionsList() {
  const { positions, loading, collectFees, removeLiquidity } = useV3Positions();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm">
        <Loading />
        <p className="text-gray-400 mt-4 animate-pulse uppercase tracking-widest text-xs font-bold">Summoning your positions...</p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm transition-all text-center">
        <div className="w-20 h-20 bg-[#00ff99]/10 rounded-full flex items-center justify-center mb-6 border border-[#00ff99]/20 shadow-[0_0_30px_rgba(0,255,153,0.1)]">
            <Plus className="w-10 h-10 text-[#00ff99]" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">No V3 Positions Found</h3>
        <p className="text-gray-400 max-w-sm mb-8">You haven't concentrated your liquidity yet. Start earning higher fees by providing liquidity in custom ranges.</p>
        <Link href="/create-pool">
            <Button variant="primary" className="bg-[#00ff99] text-black hover:shadow-[0_0_20px_rgba(0,255,153,0.4)]">
                Create First V3 Position
            </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {positions.map((pos) => (
        <V3PositionCard 
            key={pos.tokenId} 
            position={pos} 
            onCollectFees={collectFees}
            onRemoveLiquidity={removeLiquidity}
        />
      ))}
    </div>
  );
}
