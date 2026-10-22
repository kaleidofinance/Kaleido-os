"use client";

import { createContext, useContext } from "react";

export interface PositionSummary {
  positions: number | null;
  liquidityUsd: number | null;
  feesUsd: number | null;
  networks: number | null;
}

export const PositionSummaryContext = createContext<{
  summary: PositionSummary | null;
  setSummary: (summary: PositionSummary | null) => void;
}>({ summary: null, setSummary: () => {} });

export const usePositionSummaryContext = () => useContext(PositionSummaryContext);
