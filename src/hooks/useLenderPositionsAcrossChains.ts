"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getKaleidoContract } from "@/config/contracts";
import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { lendingChains } from "@/lib/lending/chain";
import { readBookRows } from "@/lib/lending/book";
import { MOCK_DATA } from "@/lib/mock";
import { mockListings, mockRequests } from "@/lib/mock/lending";
import type { LenderOffer, FundedLoan } from "@/hooks/useLenderPositions";

/**
 * The wallet's lender-side positions on EVERY lending chain at once.
 *
 * The cross-chain twin of `useLenderPositions`, which reads only
 * `READ_ONLY_CHAIN_ID`. The portfolio sweeps every chain the way the lending book
 * does, so a lender with offers on one chain and funded loans on another sees
 * both. Each row is tagged with its chain, because a token address means nothing
 * without one — the portfolio resolves the symbol/decimals against `chainId`.
 *
 * Same two sources and the same rules as the single-chain hook, applied per
 * chain: funded loans from `getServicedRequestByLender` (status-filtered to
 * SERVICED client-side), open offers from the book mirror filtered by sender.
 * Each chain's read swallows its own failure — a chain with no diamond or a dead
 * endpoint contributes nothing rather than emptying the rest.
 */
export interface ChainLenderOffer extends LenderOffer {
  chainId: number;
}
export interface ChainFundedLoan extends FundedLoan {
  chainId: number;
}

export interface LenderPositionsAcrossChains {
  offers: ChainLenderOffer[];
  loans: ChainFundedLoan[];
  loading: boolean;
  refresh: () => void;
}

/** SERVICED, per `enum Status { OPEN, SERVICED, CLOSED }`. */
const STATUS_SERVICED = 1;

export function useLenderPositionsAcrossChains(): LenderPositionsAcrossChains {
  const address = useActiveAccount()?.address;
  const chains = useMemo(() => lendingChains(), []);
  const [state, setState] = useState<{
    offers: ChainLenderOffer[];
    loans: ChainFundedLoan[];
  }>({ offers: [], loans: [] });
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address) {
      setState({ offers: [], loans: [] });
      setLoading(false);
      return;
    }

    /* Demo mode: the single-chain fixture, tagged with the read chain. Delete
       with src/lib/mock. */
    if (MOCK_DATA) {
      setState({
        offers: mockListings(address, { sender: address, status: "OPEN" }).map(
          (l) => ({
            listingId: Number(l.listingId),
            tokenAddress: l.tokenAddress,
            amount: String(l.amount),
            interestBps: Number(l.interest),
            returnDate: Number(l.returnDate ?? 0),
            chainId: READ_ONLY_CHAIN_ID,
          }),
        ),
        loans: mockRequests(address, { lender: address, status: "SERVICED" }).map(
          (r) => ({
            requestId: Number(r.requestId),
            author: r.author,
            tokenAddress: r.tokenAddress,
            principal: String(r.amount),
            outstanding: String(r.totalRepayment),
            interestBps: Number(r.interest),
            returnDate: Number(r.returnDate),
            chainId: READ_ONLY_CHAIN_ID,
          }),
        ),
      });
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    /* Positional reads on the Request tuple, matching useLenderPositions:
       requestId 1, author 2, amount 3, interest 4, totalRepayment 5,
       returnDate 6, loanRequestAddr 8, status 10. */
    const readLoans = async (chainId: number): Promise<ChainFundedLoan[]> => {
      const provider = providerForChain(chainId);
      if (!provider) return [];
      try {
        const contract = getKaleidoContract(provider, chainId);
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
            chainId,
          }));
      } catch {
        return [];
      }
    };

    const readOffers = async (chainId: number): Promise<ChainLenderOffer[]> => {
      try {
        const rows = await readBookRows(chainId, "listings");
        if (!rows) return [];
        return rows
          .filter(
            (l) =>
              l.status === "OPEN" &&
              l.sender.toLowerCase() === address.toLowerCase(),
          )
          .map((l) => ({
            listingId: l.listingId,
            tokenAddress: l.tokenAddress,
            amount: l.amount,
            interestBps: l.interest,
            returnDate: l.returnDate,
            chainId,
          }));
      } catch {
        return [];
      }
    };

    void Promise.all(
      chains.map(async (c) => ({
        offers: await readOffers(c),
        loans: await readLoans(c),
      })),
    ).then((perChain) => {
      if (!live) return;
      const offers: ChainLenderOffer[] = [];
      const loans: ChainFundedLoan[] = [];
      for (const r of perChain) {
        offers.push(...r.offers);
        loans.push(...r.loans);
      }
      setState({ offers, loans });
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [address, chains, nonce]);

  return { offers: state.offers, loans: state.loans, loading, refresh };
}

export default useLenderPositionsAcrossChains;
