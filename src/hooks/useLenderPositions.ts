"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getKaleidoContract } from "@/config/contracts";
import { READ_ONLY_CHAIN_ID, readOnlyProvider } from "@/config/provider";
import { MOCK_DATA } from "@/lib/mock";
import { mockListings, mockRequests } from "@/lib/mock/lending";

/**
 * The wallet's lender-side positions: offers it has posted, loans it has funded.
 *
 * /portfolio had a Borrowing half and no Lending half — `usePortfolio` read
 * collateral, debt, staking and LP, so a wallet whose entire activity was
 * lending saw an empty portfolio. This is the missing read.
 *
 * TWO SOURCES, AND THE SPLIT IS NOT ARBITRARY
 *
 * Funded loans come off the chain. `getServicedRequestByLender(address)` is a
 * real per-lender enumerator, so there is no reason to route the figure a
 * portfolio total depends on through an indexer that may be behind.
 *
 * Open offers come from the mirror, because the chain has no enumerator for
 * them: `getUserLoanListing` takes a listing id, not an author, so an on-chain
 * answer would mean sweeping `getListingId()`'s counter one call per id. The
 * mirror is also what /lend and /mylends already read (useDataFilterPanel.ts:210
 * filters `rawBorrowData.listings` by sender), so this agrees with those pages by
 * construction — if the indexer is behind, all three are behind together, and
 * that is better than /portfolio and /mylends disagreeing about how many offers
 * the same wallet has open.
 *
 * WHY THE ON-CHAIN CALL STILL FILTERS BY STATUS
 *
 * `getServicedRequestByLender` returns every request whose `lender` matches,
 * whatever its status (ProtocolFacet.sol:2884) — unlike `getUserActiveRequests`,
 * which filters to SERVICED on-chain. So a fully repaid loan comes back here and
 * has to be dropped client-side, otherwise a closed loan would keep counting
 * toward the wallet's lent total forever. Status 1 is SERVICED
 * (model/Protocol.sol:90).
 *
 * EVERYTHING BELOW IS THE READ CHAIN
 *
 * Both sources describe `READ_ONLY_CHAIN_ID`: the diamond call is made against
 * it, and the mirror mirrors it. So the token addresses returned here mean
 * nothing on any other chain, and a caller resolving them must resolve at the
 * read chain and not at the wallet's — the bug this hook's consumer had to fix.
 * `chainId` is exported on the result for exactly that reason.
 *
 * UNITS ARE BASE UNITS, deliberately unformatted. Both sources agree on that
 * (see lib/mock/lending.ts's header for the one place in this codebase where
 * they do not), and formatting here would mean resolving decimals twice — once
 * here and once wherever the row is priced. `interest` is BASIS POINTS on both
 * paths: 850 is 8.50%.
 */

/** An offer the wallet has posted and nobody has drawn on yet. */
export interface LenderOffer {
  listingId: number;
  tokenAddress: string;
  /** Base units, as text. The amount still on offer. */
  amount: string;
  /** Basis points. */
  interestBps: number;
  /** Unix seconds the offer's loans would be due. 0 when unset. */
  returnDate: number;
}

/** A loan the wallet has funded and is being repaid on. */
export interface FundedLoan {
  requestId: number;
  /** The borrower. */
  author: string;
  tokenAddress: string;
  /** Principal lent, base units as text. Never mutated by repayment. */
  principal: string;
  /** What is still owed, base units as text. Falls as the borrower repays. */
  outstanding: string;
  /** Basis points. */
  interestBps: number;
  /** Unix seconds the loan is due. */
  returnDate: number;
}

export interface LenderPositions {
  offers: LenderOffer[];
  loans: FundedLoan[];
  /** True until both reads have settled, success or failure. */
  loading: boolean;
  /** The chain both sets of addresses belong to. */
  chainId: number;
  refresh: () => void;
}

const EMPTY: { offers: LenderOffer[]; loans: FundedLoan[] } = {
  offers: [],
  loans: [],
};

/** SERVICED, per `enum Status { OPEN, SERVICED, CLOSED }`. */
const STATUS_SERVICED = 1;

export function useLenderPositions(): LenderPositions {
  const address = useActiveAccount()?.address;
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address) {
      setState(EMPTY);
      setLoading(false);
      return;
    }

    /* Demo mode, after the wallet check so the disconnected empty state still
       behaves. The fixture book's own filters are used rather than a filter
       written here, so a view that would come back empty against the live API
       comes back empty against the fixtures too. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setState({
        offers: mockListings(address, { sender: address, status: "OPEN" }).map(
          (l) => ({
            listingId: Number(l.listingId),
            tokenAddress: l.tokenAddress,
            amount: String(l.amount),
            interestBps: Number(l.interest),
            returnDate: Number(l.returnDate ?? 0),
          }),
        ),
        loans: mockRequests(address, {
          lender: address,
          status: "SERVICED",
        }).map((r) => ({
          requestId: Number(r.requestId),
          author: r.author,
          tokenAddress: r.tokenAddress,
          principal: String(r.amount),
          outstanding: String(r.totalRepayment),
          interestBps: Number(r.interest),
          returnDate: Number(r.returnDate),
        })),
      });
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    /* Positional reads on the Request tuple, matching useGetActiveRequest and
       lib/ai/planDeps: listingId 0, requestId 1, author 2, amount 3, interest 4,
       totalRepayment 5, returnDate 6, lender 7, loanRequestAddr 8, status 10.
       `interestAccrued` was appended after `status` precisely so these indices
       stay put (model/Protocol.sol:32). */
    const readLoans = async (): Promise<FundedLoan[]> => {
      try {
        const contract = getKaleidoContract(
          readOnlyProvider,
          READ_ONLY_CHAIN_ID,
        );
        const rows = await contract.getServicedRequestByLender(address);
        return (rows as unknown[])
          .map((row) => row as Record<number, unknown>)
          .filter((row) => Number(row[10]) === STATUS_SERVICED)
          .map((row) => ({
            requestId: Number(row[1]),
            author: String(row[2]),
            tokenAddress: String(row[8]),
            principal: String(row[3]),
            outstanding: String(row[5]),
            interestBps: Number(row[4]),
            returnDate: Number(row[6]),
          }));
      } catch (err) {
        /* A chain with no diamond throws from `getKaleidoContract`, and a dead
           endpoint throws from the call. Both mean "we could not read this",
           which the caller renders as an absent group rather than as zero. */
        console.warn(
          "[lender] funded loans unreadable:",
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    };

    const readOffers = async (): Promise<LenderOffer[]> => {
      try {
        const res = await fetch(
          `/api/listings?sender=${encodeURIComponent(address)}&status=OPEN`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok || !body?.success || !Array.isArray(body.data)) return [];
        return body.data.map((l: Record<string, unknown>) => ({
          listingId: Number(l.listingId),
          tokenAddress: String(l.tokenAddress ?? ""),
          amount: String(l.amount ?? "0"),
          interestBps: Number(l.interest ?? 0),
          returnDate: Number(l.returnDate ?? 0),
        }));
      } catch (err) {
        console.warn(
          "[lender] open offers unreadable:",
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    };

    /* Both at once: they share nothing, and one being slow should not hold the
       other's rows off the page. Neither rejects — each swallows its own
       failure — so there is no `catch` to write around this. */
    void Promise.all([readOffers(), readLoans()]).then(([offers, loans]) => {
      if (!live) return;
      setState({ offers, loans });
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [address, nonce]);

  return {
    offers: state.offers,
    loans: state.loans,
    loading,
    chainId: READ_ONLY_CHAIN_ID,
    refresh,
  };
}

export default useLenderPositions;
