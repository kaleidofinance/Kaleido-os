"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { useActiveAccount } from "thirdweb/react";
import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider } from "@/config/provider";
import { isDeployed } from "@/constants/registry";
import {
  readLendingAssets,
  type CollateralHolding,
  type LendingAsset,
} from "@/lib/lending/assets";
import { LENDING_CHAIN_ID } from "@/lib/lending/chain";
import { MOCK_COLLATERAL, MOCK_DATA, MOCK_LENDING_ASSETS } from "@/lib/mock";

/**
 * What the lending diamond accepts, and what this account has deposited.
 *
 * Replaces `borrowCurrencies(READ_ONLY_CHAIN_ID)` as the source for the borrow
 * modals' pickers. That helper lists what the UI *offers* — derived from address
 * existence in the deployment registry — and on every one of the five deployed
 * chains it disagreed with what the diamond will *accept*. See the header of
 * src/lib/lending/assets.ts for the measured per-chain gap; the short version is
 * that kfUSD was offered everywhere and registered nowhere, the native asset was
 * offered as a loan currency everywhere and is loanable nowhere, and the wrapped
 * native was registered everywhere and offered nowhere.
 *
 * Two separate lists, deliberately. `collateral` is what may be deposited to back
 * a loan; `loanable` is what may be borrowed or lent. Merging them would be wrong
 * for one of the two questions on four of the five chains.
 *
 * **Fails closed.** A failed read returns empty lists plus an `error`, and the
 * modals disable their CTA on that rather than falling back to the offered list.
 * The alternative — showing the registry's list when the chain cannot be reached
 * — is precisely the behaviour being removed: options the protocol will reject,
 * presented as though it would accept them, costing the user gas to find out.
 * `MOCK_DATA` is the one exception, and only because the fixture surface has no
 * chain to ask.
 */
export interface LendingAssets {
  collateral: LendingAsset[];
  loanable: LendingAsset[];
  /** Deposited balances, display units, zero-balance assets dropped. */
  holdings: CollateralHolding[];
  /** Registered addresses neither the registry nor the token could name. */
  unnamed: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Under MOCK_DATA both lists are the fixture's registered set.
 *
 * `MOCK_LENDING_ASSETS`, not `MOCK_COLLATERAL` mapped: the deposited set is three
 * of the four tokens the fixture book is denominated in, and deriving the picker
 * from it left USDT listings unusable — the same class of mismatch this hook
 * exists to remove. It also had to infer each entry's decimals from its symbol to
 * do it.
 */
const MOCK_ASSETS: LendingAsset[] = MOCK_LENDING_ASSETS;

export function useLendingAssets(): LendingAssets {
  const account = useActiveAccount();
  const address = account?.address;

  const [sets, setSets] = useState<{
    collateral: LendingAsset[];
    loanable: LendingAsset[];
    unnamed: string[];
  }>({ collateral: [], loanable: [], unnamed: [] });
  const [holdings, setHoldings] = useState<CollateralHolding[]>([]);
  const [loading, setLoading] = useState(!MOCK_DATA);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /* The registered sets. No wallet needed — this is protocol configuration, so
     it loads for a visitor who has not connected one. */
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

    readLendingAssets(readOnlyProvider, LENDING_CHAIN_ID)
      .then((result) => {
        if (!live) return;
        setSets(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setSets({ collateral: [], loanable: [], unnamed: [] });
        setError(
          `Couldn't read the registered assets: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [nonce]);

  /* Deposited balances, one read per registered collateral asset.
   *
   * Keyed off the diamond's own collateral list rather than a fixed set of
   * atoms. useGetValueAndHealth reads four — native, USDC, kfUSD, USDT — which
   * misses the wrapped native that is registered collateral on all five chains
   * and includes kfUSD, which is registered on none. So a user who deposited
   * WETH had no row for it and could not withdraw it from this surface. */
  useEffect(() => {
    if (MOCK_DATA) return;
    if (!address || sets.collateral.length === 0) {
      setHoldings([]);
      return;
    }

    let live = true;
    const diamond = getKaleidoContract(readOnlyProvider, LENDING_CHAIN_ID);

    Promise.all(
      sets.collateral.map(async (asset) => {
        try {
          const raw: bigint = await diamond.gets_addressToCollateralDeposited(
            address,
            asset.address,
          );
          return {
            symbol: asset.symbol,
            address: asset.address,
            amount: Number(ethers.formatUnits(raw, asset.decimals)),
          };
        } catch {
          /* One unreadable asset must not blank the whole list, and a zero here
             would assert a balance nobody measured — so it is dropped instead,
             which the `amount > 0` filter below does anyway. */
          return null;
        }
      }),
    ).then((rows) => {
      if (!live) return;
      setHoldings(
        rows.filter(
          (r): r is CollateralHolding => r !== null && r.amount > 0,
        ),
      );
    });

    return () => {
      live = false;
    };
  }, [address, sets.collateral, nonce]);

  if (MOCK_DATA) {
    return {
      collateral: MOCK_ASSETS,
      loanable: MOCK_ASSETS,
      holdings: MOCK_COLLATERAL,
      unnamed: [],
      loading: false,
      error: null,
      refresh,
    };
  }

  return { ...sets, holdings, loading, error, refresh };
}

export default useLendingAssets;
