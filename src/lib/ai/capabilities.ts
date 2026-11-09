import { CHAINS, getChainMeta } from "@/constants/chains";
import {
  getContracts,
  hasOrders,
  hasStaking,
  hasStablecoin,
  registeredLendingAssets,
} from "@/constants/registry";
import { chainTokens } from "@/constants/tokens";
import {
  aggregatorIntegrations,
  launchpadIntegrations,
} from "./integrationCatalog";
import type { NetworkMode } from "./readTools";

/** Status is deliberately more precise than a boolean. A registry entry is
 * not proof that its contracts, provider, liquidity or keeper are healthy. */
export type CapabilityStatus =
  | "available"
  | "unavailable"
  | "not_configured"
  | "degraded"
  | "unknown";

export type CapabilitySurface =
  | "read"
  | "quote"
  | "plan"
  | "audit"
  | "simulate"
  | "execute";

export interface CapabilityRecord {
  id: string;
  product: string;
  status: CapabilityStatus;
  surfaces: Partial<Record<CapabilitySurface, CapabilityStatus>>;
  chainId?: number;
  chainName?: string;
  networkMode: NetworkMode;
  source: string;
  reason?: string;
}

export interface CapabilitySnapshot {
  version: 1;
  networkMode: NetworkMode;
  chainId?: number;
  chainName?: string;
  generatedAt: string;
  records: CapabilityRecord[];
}

const FULL_SURFACES: CapabilitySurface[] = [
  "read",
  "quote",
  "plan",
  "audit",
  "simulate",
  "execute",
];

function surfaces(
  status: CapabilityStatus,
  overrides: Partial<Record<CapabilitySurface, CapabilityStatus>> = {},
): Partial<Record<CapabilitySurface, CapabilityStatus>> {
  return Object.fromEntries(
    FULL_SURFACES.map((surface) => [surface, overrides[surface] ?? status]),
  ) as Partial<Record<CapabilitySurface, CapabilityStatus>>;
}

function record(
  snapshot: Pick<CapabilitySnapshot, "networkMode" | "chainId" | "chainName">,
  value: Omit<CapabilityRecord, "networkMode" | "chainId" | "chainName">,
): CapabilityRecord {
  return {
    ...value,
    ...snapshot,
  };
}

function unknownSnapshot(
  chainId: number | undefined,
  networkMode: NetworkMode,
): CapabilitySnapshot {
  return {
    version: 1,
    networkMode,
    ...(chainId === undefined ? {} : { chainId }),
    generatedAt: new Date().toISOString(),
    records: [
      {
        id: "chain",
        product: "chain scope",
        status: "unknown",
        surfaces: surfaces("unknown"),
        ...(chainId === undefined ? {} : { chainId }),
        networkMode,
        source: "canonical chain registry",
        reason:
          "The requested chain is not registered; no product capability is inferred.",
      },
    ],
  };
}

const STATUS_RANK: Record<CapabilityStatus, number> = {
  unknown: 0,
  not_configured: 1,
  unavailable: 2,
  degraded: 3,
  available: 4,
};

function strongestStatus(statuses: CapabilityStatus[]): CapabilityStatus {
  return statuses.reduce(
    (best, status) =>
      STATUS_RANK[status] > STATUS_RANK[best] ? status : best,
    "unknown" as CapabilityStatus,
  );
}

function aggregateSnapshot(networkMode: NetworkMode): CapabilitySnapshot {
  const perChain = CHAINS.filter((chain) => chain.network === networkMode).map(
    (chain) => getCapabilitySnapshot({ chainId: chain.id, networkMode }),
  );
  const ids = Array.from(
    new Set(perChain.flatMap((snapshot) => snapshot.records.map((item) => item.id))),
  );
  const records = ids.map((id) => {
    const matches = perChain
      .map((snapshot) => snapshot.records.find((item) => item.id === id))
      .filter((item): item is CapabilityRecord => Boolean(item));
    const availableOn = matches
      .filter((item) => item.status === "available")
      .map((item) => item.chainName)
      .filter((name): name is string => Boolean(name));
    const first = matches[0];
    const surfaceNames = FULL_SURFACES.reduce(
      (out, surface) => {
        const status = strongestStatus(
          matches
            .map((item) => item.surfaces[surface])
            .filter((item): item is CapabilityStatus => Boolean(item)),
        );
        out[surface] = status;
        return out;
      },
      {} as Partial<Record<CapabilitySurface, CapabilityStatus>>,
    );
    return {
      id,
      product: first?.product ?? id,
      status: strongestStatus(matches.map((item) => item.status)),
      surfaces: surfaceNames,
      networkMode,
      source: first?.source ?? "canonical capability registry",
      reason:
        availableOn.length > 0
          ? `Configured on: ${availableOn.join(", ")}. Other active-mode chains may differ.`
          : first?.reason,
    } satisfies CapabilityRecord;
  });
  return {
    version: 1,
    networkMode,
    chainName: `${networkMode} networks`,
    generatedAt: new Date().toISOString(),
    records,
  };
}

/**
 * Derive the server-owned capability view used by Luca's prompt and response
 * context. This is intentionally based on the canonical registry and reviewed
 * provider allow-lists, not on model text or a mutable product prompt.
 *
 * The snapshot describes configured capability, not live liquidity or a
 * successful quote. Runtime tools still have to read the chain/provider and
 * return partial or unavailable results when those reads fail.
 */
export function getCapabilitySnapshot(args: {
  chainId?: number;
  networkMode: NetworkMode;
}): CapabilitySnapshot {
  const { chainId, networkMode } = args;
  if (chainId === undefined) return aggregateSnapshot(networkMode);
  const meta = getChainMeta(chainId);
  if (!meta || meta.network !== networkMode) {
    return unknownSnapshot(chainId, networkMode);
  }

  const scopedChainId = meta.id;

  const scope = { networkMode, chainId, chainName: meta.name } as const;
  const contracts = getContracts(chainId);
  const hasV3 = Boolean(
    contracts.v3Factory && contracts.v3Quoter && contracts.v3Router,
  );
  const hasLpManager = Boolean(contracts.v3Factory && contracts.v3PositionManager);
  const lending = registeredLendingAssets(chainId, "loanable");
  const collateral = registeredLendingAssets(chainId, "collateral");
  const hasLending = Boolean(contracts.diamond);
  const aggregators = aggregatorIntegrations(scopedChainId, networkMode);
  const aggregatorNames = aggregators.map((item) => item.name);
  const swapConfigured = hasV3 || aggregatorNames.length > 0;
  const launchpads = launchpadIntegrations(scopedChainId, networkMode);
  const launchpadsConfigured = launchpads.length > 0;

  const records: CapabilityRecord[] = [
    record(scope, {
      id: "wallet.read",
      product: "wallet and balances",
      status: chainTokens(chainId).length > 0 ? "available" : "degraded",
      surfaces: surfaces("unavailable", { read: "available" }),
      source: "chain registry and token registry",
      reason:
        chainTokens(chainId).length > 0
          ? undefined
          : "The chain is registered but has no named assets in the token registry.",
    }),
    record(scope, {
      id: "swap",
      product: "swaps",
      status: swapConfigured ? "available" : "not_configured",
      surfaces: surfaces(swapConfigured ? "available" : "not_configured"),
      source: "deployment registry and reviewed aggregator allow-lists",
      reason: swapConfigured
        ? aggregatorNames.length
          ? `Configured routes: ${[hasV3 ? "Kaleido" : null, ...aggregatorNames].filter(Boolean).join(", ")}. Liquidity is checked at quote time.`
          : "Kaleido routing is configured; liquidity is checked at quote time."
        : "No reviewed native or aggregator route is configured for this chain.",
    }),
    record(scope, {
      id: "liquidity",
      product: "liquidity",
      status: hasLpManager ? "available" : "not_configured",
      surfaces: surfaces(hasLpManager ? "available" : "not_configured", {
        read: hasV3 ? "available" : "not_configured",
      }),
      source: "V3 factory and position-manager registry",
      reason: hasLpManager
        ? "Native LP management is configured; external pool visibility does not imply deposit support."
        : "No native LP position manager is registered for this chain.",
    }),
    record(scope, {
      id: "lending",
      product: "lending and borrowing",
      status:
        !hasLending
          ? "not_configured"
          : lending.known && collateral.known
            ? "available"
            : "degraded",
      surfaces: surfaces(
        !hasLending
          ? "not_configured"
          : lending.known && collateral.known
            ? "available"
            : "degraded",
        { read: hasLending ? "available" : "not_configured" },
      ),
      source: "Diamond deployment and lending registration",
      reason: !hasLending
        ? "No lending Diamond is registered for this chain."
        : lending.known && collateral.known
          ? undefined
          : "The Diamond exists but one or more lending asset registrations are incomplete.",
    }),
    record(scope, {
      id: "limit-orders",
      product: "limit orders",
      status: hasOrders(chainId) ? "available" : "not_configured",
      surfaces: surfaces(hasOrders(chainId) ? "available" : "not_configured"),
      source: "orders deployment registry",
      reason: hasOrders(chainId)
        ? "Settlement and keeper health are still checked at order time."
        : "No orders settlement contract is registered for this chain.",
    }),
    record(scope, {
      id: "staking",
      product: "staking",
      status: hasStaking(chainId) ? "available" : "not_configured",
      surfaces: surfaces(hasStaking(chainId) ? "available" : "not_configured"),
      source: "staking contract registry",
      reason: hasStaking(chainId)
        ? undefined
        : "No complete KLD vault/stKLD deployment is registered for this chain.",
    }),
    record(scope, {
      id: "stablecoin",
      product: "stablecoin",
      status: hasStablecoin(chainId) ? "available" : "not_configured",
      surfaces: surfaces(hasStablecoin(chainId) ? "available" : "not_configured"),
      source: "stablecoin contract registry",
      reason: hasStablecoin(chainId)
        ? undefined
        : "No complete kfUSD/kafUSD deployment is registered for this chain.",
    }),
    record(scope, {
      id: "launchpads",
      product: "launchpad integrations",
      status: launchpadsConfigured ? "available" : "not_configured",
      surfaces: surfaces(launchpadsConfigured ? "available" : "not_configured"),
      source:
        launchpads.length > 0
          ? launchpads.map((item) => item.source).join("; ")
          : "canonical launchpad integration catalog",
      reason: launchpadsConfigured
        ? `${launchpads.map((item) => item.name).join(" and ")} are registered on Arc mainnet. ${launchpads.map((item) => item.reason).join(" ")}`
        : "No launchpad integration is registered for this chain.",
    }),
    record(scope, {
      id: "bridge.quote",
      product: "bridges",
      status: "degraded",
      surfaces: surfaces("degraded", {
        read: "available",
        quote: "available",
      }),
      source: "Relay and LI.FI runtime providers",
      reason:
        "A provider quote is required for corridor, fee, timing and execution availability; no route is assumed from chain registration alone.",
    }),
  ];

  return {
    version: 1,
    networkMode,
    ...(chainId === undefined ? {} : { chainId }),
    chainName: meta.name,
    generatedAt: new Date().toISOString(),
    records,
  };
}

/** Compact, model-facing rendering. The full typed snapshot stays in context. */
export function capabilityPrompt(snapshot: CapabilitySnapshot): string {
  const scope = snapshot.chainName
    ? `${snapshot.chainName}${snapshot.chainId === undefined ? "" : ` (${snapshot.chainId})`}`
    : "no connected chain";
  const lines = snapshot.records.map((item) => {
    const detail = item.reason ? ` — ${item.reason}` : "";
    return `- ${item.product}: ${item.status}${detail}`;
  });
  return [
    `Server-owned capability snapshot v${snapshot.version}: mode=${snapshot.networkMode}; scope=${scope}.`,
    "This describes configured capability, not live liquidity or a completed action. Use the relevant read/quote tool for current state; never turn an unavailable or degraded capability into a zero or a success.",
    ...lines,
  ].join("\n");
}

/** Useful for tests and future UI/tool policy gates. */
export function capabilityFor(
  snapshot: CapabilitySnapshot,
  id: string,
): CapabilityRecord | undefined {
  return snapshot.records.find((item) => item.id === id);
}

/** Keep the registry import exercised in environments that tree-shake callers. */
export function registeredChainIds(): number[] {
  return CHAINS.map((chain) => chain.id);
}
