"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStablecoin } from "@/hooks/useStablecoin";

/**
 * Single instance of useStablecoin for the whole Stable surface.
 *
 * useStablecoin fetches balances/stats/rewards on mount, so calling it in both
 * the layout chrome and each mode page would double every request. The layout
 * mounts this provider once; chrome and pages read from context. It also acts
 * as the v2 bridge — the clean shape the pages consume, not the raw hook.
 */
type Stable = ReturnType<typeof useStablecoin>;

const StableCtx = createContext<Stable | null>(null);

export function StableProvider({ children }: { children: ReactNode }) {
  const stable = useStablecoin();
  return <StableCtx.Provider value={stable}>{children}</StableCtx.Provider>;
}

export function useStable(): Stable {
  const ctx = useContext(StableCtx);
  if (!ctx) throw new Error("useStable must be used within StableProvider");
  return ctx;
}
