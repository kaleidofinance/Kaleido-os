"use client";
import React, { Suspense } from "react";
import RemovePoolHeader from "@/components/pool/RemovePoolHeader";
import RemoveLiquidity from "@/components/liquidity/removeLiquidity";
import Loading from "@/components/ui/loading";

function RemoveLiquidityPageContent() {
  return (
    <div className="flex flex-col space-y-16 pt-6">
      <RemovePoolHeader />
      <div className="w-full sm:px-3 lg:px-0">
        <RemoveLiquidity style={false} />
      </div>
    </div>
  );
}

export default function RemoveLiquidityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RemoveLiquidityPageContent />
    </Suspense>
  );
}
