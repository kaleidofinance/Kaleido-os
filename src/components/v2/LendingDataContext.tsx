"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import useDataFiltersPanel from "@/hooks/useDataFilterPanel";
import { useBorrowV2 } from "@/hooks/v2/useBorrowV2";
import {
  useLendingAssetsAcrossChains,
  type LendingAssetsAcrossChains,
} from "@/hooks/useLendingAssets";

type FiltersPanel = ReturnType<typeof useDataFiltersPanel>;
type BorrowV2 = ReturnType<typeof useBorrowV2>;

/**
 * Which tab the Collateral modal should open on, and on which asset.
 *
 * A CTA can want either side: a borrower with no collateral is sent to Deposit,
 * while one blocked because the loan asset IS their collateral is sent to
 * Withdraw, on that exact token. `symbol` is optional because the plain header
 * button has no asset in mind and lets the modal pick its own default.
 */
export type CollateralIntent = {
  mode: "deposit" | "withdraw";
  symbol?: string;
};

interface LendingData {
  filters: FiltersPanel;
  borrow: BorrowV2;
  /**
   * Every lending chain's registered sets at once, each asset tagged with its
   * chain — the option source for the multichain post pickers. The book sweeps
   * every chain's rows; the forms sweep every chain's assets the same way, so a
   * user connected to one chain can post on any of them.
   */
  assetsAcrossChains: LendingAssetsAcrossChains;
  /**
   * The chain the open form is acting ON, or `undefined` for the connected one.
   *
   * A picker choosing an asset on another chain sets this, and the single shared
   * `useBorrowV2(formChainId)` re-reads that market's fees, holdings and health —
   * the Aave-V3 model of one isolated market per chain, selected by the asset
   * rather than by switching the wallet first. The forms reset it to `undefined`
   * on close, so the header behind them (which reads the same `borrow`) returns
   * to the connected chain.
   */
  formChainId: number | undefined;
  setFormChainId: (id: number | undefined) => void;
  /**
   * The Collateral modal, shared rather than local.
   *
   * The modal is rendered from the (lending) layout header, but the buttons that
   * open it are not only there: TakeLoanModal and PostRequestModal, deep inside
   * BorrowBookView, send a borrower to Deposit (no collateral) or to Withdraw
   * (the loan asset is their collateral) rather than letting them pay gas to
   * learn the diamond reverts. Both live under this one provider, so the state
   * lives here too — the same reason the book itself is one shared instance.
   *
   * `intent` rides alongside `open` so the opener also says which tab and asset
   * the modal lands on; `setOpen(false)` is the shared close.
   */
  collateral: {
    open: boolean;
    intent: CollateralIntent | null;
    setOpen: (open: boolean) => void;
    openDeposit: () => void;
    openWithdraw: (symbol: string) => void;
  };
}

const LendingDataContext = createContext<LendingData | null>(null);

/**
 * Instantiates the borrow/lend data hooks ONCE for the whole (lending) section.
 *
 * useDataFiltersPanel keeps its fetched rows in per-instance useState — only the
 * filter inputs are shared jotai atoms — so calling it in both the layout and
 * BorrowBookView produced two independent copies of the book. A Post/Collateral
 * modal's onDone refresh hit the layout's copy while the table rendered the
 * view's, so a freshly posted offer never appeared until the table happened to
 * refetch on its own. One provider, one instance, shared by the header modals
 * and the table.
 */
export function LendingDataProvider({ children }: { children: ReactNode }) {
  const filters = useDataFiltersPanel();
  /* The chain the open form acts on; a picker sets it, forms reset it on close. */
  const [formChainId, setFormChainId] = useState<number | undefined>(undefined);
  const borrow = useBorrowV2(formChainId);
  const assetsAcrossChains = useLendingAssetsAcrossChains();
  const [collateralOpen, setCollateralOpen] = useState(false);
  const [collateralIntent, setCollateralIntent] =
    useState<CollateralIntent | null>(null);
  const collateral = useMemo(
    () => ({
      open: collateralOpen,
      intent: collateralIntent,
      setOpen: setCollateralOpen,
      openDeposit: () => {
        setCollateralIntent({ mode: "deposit" });
        setCollateralOpen(true);
      },
      openWithdraw: (symbol: string) => {
        setCollateralIntent({ mode: "withdraw", symbol });
        setCollateralOpen(true);
      },
    }),
    [collateralOpen, collateralIntent],
  );
  return (
    <LendingDataContext.Provider
      value={{
        filters,
        borrow,
        assetsAcrossChains,
        formChainId,
        setFormChainId,
        collateral,
      }}
    >
      {children}
    </LendingDataContext.Provider>
  );
}

export function useLendingData(): LendingData {
  const ctx = useContext(LendingDataContext);
  if (!ctx) {
    throw new Error("useLendingData must be used within a LendingDataProvider");
  }
  return ctx;
}
