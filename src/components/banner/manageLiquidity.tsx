import React from "react";
import BaseHeader from "../shared/BaseHeader";

// Managing Liquidity Banner Component
export function ManageLiquidityBanner() {
  return (
    <BaseHeader
      title="Manage Liquidity"
      description="Monitor, adjust, and optimize your liquidity positions on Abstract Chain's AMM protocol."
      showStats={false}
      backgroundImage="/banners/poolheaderbg.png"
      backgroundOverlay={false}
    />
  );
}
