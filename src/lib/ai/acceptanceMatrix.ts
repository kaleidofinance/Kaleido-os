import { CHAINS } from "@/constants/chains";
import {
  getCapabilitySnapshot,
  type CapabilitySurface,
  type CapabilityStatus,
} from "./capabilities";
import type { NetworkMode } from "./readTools";

export type AcceptanceState = "configured" | "not_configured" | "needs_live_check";

export interface AcceptanceCase {
  chainId: number;
  chainName: string;
  networkMode: NetworkMode;
  capabilityId: string;
  product: string;
  surface: CapabilitySurface;
  configuredStatus: CapabilityStatus;
  state: AcceptanceState;
  reason: string;
}

const LIVE_SURFACES: CapabilitySurface[] = ["read", "quote", "plan", "audit", "simulate", "execute"];

function stateFor(status: CapabilityStatus, surface: CapabilityStatus | undefined): AcceptanceState {
  if (status === "not_configured" || surface === "not_configured" || status === "unavailable") {
    return "not_configured";
  }
  return "needs_live_check";
}

/**
 * Build the evidence backlog for every registered chain/product surface.
 * Configuration is intentionally not treated as runtime acceptance: each
 * configured row still needs a live read/quote/plan check before Luca claims
 * that operation works in production.
 */
export function buildAcceptanceMatrix(networkMode: NetworkMode = "mainnet"): AcceptanceCase[] {
  return CHAINS.filter((chain) => chain.network === networkMode).flatMap((chain) => {
    const snapshot = getCapabilitySnapshot({ chainId: chain.id, networkMode });
    return snapshot.records.flatMap((record) =>
      LIVE_SURFACES.map((surface) => {
        const surfaceStatus = record.surfaces[surface];
        return {
          chainId: chain.id,
          chainName: chain.name,
          networkMode,
          capabilityId: record.id,
          product: record.product,
          surface,
          configuredStatus: surfaceStatus ?? record.status,
          state: stateFor(record.status, surfaceStatus),
          reason:
            stateFor(record.status, surfaceStatus) === "needs_live_check"
              ? "Configured in the canonical registry; live acceptance is still required."
              : record.reason ?? "No configured adapter or deployment for this surface.",
        } satisfies AcceptanceCase;
      }),
    );
  });
}

export function acceptanceSummary(matrix: readonly AcceptanceCase[]) {
  return matrix.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.state] += 1;
      return summary;
    },
    { total: 0, configured: 0, needs_live_check: 0, not_configured: 0 },
  );
}
