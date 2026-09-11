"use client";

import { useMemo } from "react";
import { ethers } from "ethers";

import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { isNativeSentinel } from "@/constants/registry";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";

/**
 * The lender's own four figures, computed once for everything that shows them.
 *
 * WHY IT IS A HOOK RATHER THAN FOUR EXPRESSIONS. These were inline in
 * BorrowBookView, feeding the "Your position" card on /mylends. The page header
 * strip above that card now shows them too — on a phone the sidebar stacks
 * under the whole table, so the strip is the only place a lender's position can
 * be seen without scrolling past the book. Two readers means the pricing has to
 * live in one place: a second copy would be a second answer to the same
 * question, and this particular calculation has already been wrong twice in
 * ways a copy would silently reintroduce.
 *
 * BOTH OF THOSE BUGS ARE WHY THE COMMENTS BELOW ARE LONG. `funded` used to
 * filter LISTINGS for status SERVICED, and a listing is only ever OPEN or
 * CLOSED on chain, so Funded and Outstanding read 0 / $0.00 however much the
 * user had lent. And the native-asset branch used to test a flat table of
 * Abstract addresses that matched nothing after the address cutover, so every
 * row priced at the dollar rate — a native-denominated listing valued at a
 * dollar a token.
 */
export interface LenderPosition {
  /** Still on offer, not everything ever posted — the cursor asks for OPEN. */
  openValueUsd: number;
  myOpenCount: number;
  fundedCount: number;
  /** Principal PLUS interest: what the borrowers owe back. */
  outstandingUsd: number;
}

/** The row shape both books return; only the fields priced here are required. */
interface PricedRow {
  tokenAddress: string;
  amount: string;
  status?: string;
  totalRepayment?: string;
}

interface PositionSource {
  myListings?: unknown[];
  myFundedLoans?: unknown[];
  etherPrice?: unknown;
  usdcPrice?: unknown;
}

export function useLenderPosition(
  filters: PositionSource | null | undefined,
): LenderPosition {
  const myListings = (filters?.myListings ?? []) as PricedRow[];
  const myFundedLoans = (filters?.myFundedLoans ?? []) as PricedRow[];
  const etherPrice = filters?.etherPrice;
  const usdcPrice = filters?.usdcPrice;

  return useMemo(() => {
    const usdValue = (tokenAddress: string, baseUnits: string | undefined) => {
      try {
        const amt =
          Number(
            ethers.formatUnits(
              baseUnits ?? "0",
              getTokenDecimals(READ_ONLY_CHAIN_ID, tokenAddress),
            ),
          ) || 0;
        /*
         * The native asset takes the native price, everything else the dollar
         * one — and `etherPrice` is misnamed rather than ETH-specific: it is
         * `getUsdValue(NATIVE_SENTINEL.lending, 1, 0)` off the diamond
         * (useGetValueAndHealth.ts:545), so it is BNB's price on BSC and USDC's
         * on Arc. Testing the sentinel is therefore correct on all five chains.
         */
        const price = isNativeSentinel(tokenAddress, "lending")
          ? Number(etherPrice ?? 0)
          : Number(usdcPrice ?? 1);
        return amt * price;
      } catch {
        return 0;
      }
    };

    /* A funded loan is a REQUEST row with `lender` set, which is what
       myFundedLoans already filtered for; SERVICED is what separates a live
       loan from one still open for funding. */
    const funded = myFundedLoans.filter(
      (r) => String(r.status).toUpperCase() === "SERVICED",
    );

    return {
      openValueUsd: myListings.reduce(
        (sum, li) => sum + usdValue(li.tokenAddress, li.amount),
        0,
      ),
      myOpenCount: myListings.length,
      fundedCount: funded.length,
      outstandingUsd: funded.reduce(
        (sum, r) =>
          sum + usdValue(r.tokenAddress, r.totalRepayment ?? r.amount),
        0,
      ),
    };
  }, [myListings, myFundedLoans, etherPrice, usdcPrice]);
}
