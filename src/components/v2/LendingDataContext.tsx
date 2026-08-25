"use client";

import { createContext, useContext, type ReactNode } from "react";
import useDataFiltersPanel from "@/hooks/useDataFilterPanel";
import { useBorrowV2 } from "@/hooks/v2/useBorrowV2";

type FiltersPanel = ReturnType<typeof useDataFiltersPanel>;
type BorrowV2 = ReturnType<typeof useBorrowV2>;

interface LendingData {
  filters: FiltersPanel;
  borrow: BorrowV2;
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
  const borrow = useBorrowV2();
  return (
    <LendingDataContext.Provider value={{ filters, borrow }}>
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
