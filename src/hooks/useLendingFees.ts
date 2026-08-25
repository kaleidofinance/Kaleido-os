"use client";

import { useCallback, useEffect, useState } from "react";
import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider } from "@/config/provider";
import { isDeployed } from "@/constants/registry";
import { LENDING_CHAIN_ID } from "@/lib/lending/chain";
import type { LendingFeeRates } from "@/lib/lending/fees";
import { MOCK_DATA, MOCK_LENDING_FEES } from "@/lib/mock";

/**
 * The protocol's two lending fees, read from the diamond that charges them.
 *
 * `getBPS()` is the protocol's cut of loan interest and `getLiquidityBPS()` is the
 * liquidation penalty. Both are owner-set storage, both are live on all five
 * deployed chains, and until now **nothing in `src/` called either reader** — so
 * every rate on the order book was presented as though the lender received all of
 * it, and the cost of being liquidated appeared nowhere at all.
 *
 * Protocol configuration, not per-account state, so it loads without a wallet —
 * the same reason `useLendingAssets` reads its registered sets unconditionally.
 * Pinned to `LENDING_CHAIN_ID` for the same reason every other lending read is:
 * the fee shown has to belong to the diamond the position is in.
 *
 * **Fails closed to `null`, never to 0.** A zero here would not read as "no fee":
 * `setBPS` rejects 0, and both `repayLoan` and `liquidateUserRequest` revert when
 * either value is 0, so on-chain a zero means "never configured" — the opposite of
 * a waiver. Callers render "—" and suppress any figure derived from it.
 */
export interface LendingFees extends LendingFeeRates {
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLendingFees(): LendingFees {
  const [rates, setRates] = useState<LendingFeeRates>({
    interestFeeBps: null,
    liquidationPenaltyBps: null,
  });
  const [loading, setLoading] = useState(!MOCK_DATA);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (MOCK_DATA) return;

    if (!isDeployed(LENDING_CHAIN_ID)) {
      setLoading(false);
      setError(`No lending deployment on chain ${LENDING_CHAIN_ID}.`);
      return;
    }

    let live = true;
    setLoading(true);
    setError(null);

    const diamond = getKaleidoContract(readOnlyProvider, LENDING_CHAIN_ID);

    /* Both or neither. The two are shown together and derived figures depend on
       one each, so a half-read state would put a real percentage next to a dash
       and leave the user to guess which fee was which. */
    Promise.all([diamond.getBPS(), diamond.getLiquidityBPS()])
      .then(([interest, penalty]: [bigint, bigint]) => {
        if (!live) return;
        setRates({
          interestFeeBps: Number(interest),
          liquidationPenaltyBps: Number(penalty),
        });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRates({ interestFeeBps: null, liquidationPenaltyBps: null });
        setError(`Couldn't read the protocol fees: ${(err as Error).message}`);
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [nonce]);

  if (MOCK_DATA) {
    return { ...MOCK_LENDING_FEES, loading: false, error: null, refresh };
  }

  return { ...rates, loading, error, refresh };
}

export default useLendingFees;
