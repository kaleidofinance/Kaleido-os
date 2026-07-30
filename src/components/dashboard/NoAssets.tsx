"use client";

import { useState } from "react";
import DepositModal from "@/components/shared/DepositModal";

const NoAssets = () => {
  const [showDepositModal, setShowDepositModal] = useState(false);

  return (
    <div className="custom-corner-header w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-surface py-5 transition-colors hover:border-edge-strong sm:py-6">
      <div className="mb-3 px-4 sm:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.1em] text-content-muted">
          Deposited collateral
        </h3>
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-edge px-6 py-10 text-center">
        <p className="text-sm text-content-secondary">
          You haven&apos;t deposited any collateral yet.
        </p>
        <p className="max-w-[42ch] text-xs text-content-muted">
          Deposit an asset to start borrowing against it. Your wallet balances
          are listed below.
        </p>
        <button
          onClick={() => setShowDepositModal(true)}
          className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-content-onAccent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Deposit collateral
        </button>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
        action="deposit"
      />
    </div>
  );
};

export default NoAssets;
