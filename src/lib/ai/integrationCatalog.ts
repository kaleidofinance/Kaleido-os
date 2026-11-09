import { ARGUS_CHAIN_ID, argusEnabled } from "@/lib/argus/addresses";
import { PEACH_CHAIN_ID } from "@/lib/peach/route";
import { hasFlyTrade } from "@/lib/swap/flytrade";
import { hasKyberSwap } from "@/lib/swap/kyberswap";
import { hasLifiSwap } from "@/lib/swap/lifi";

export type IntegrationKind = "launchpad" | "aggregator";
export type IntegrationOperation =
  | "inspect"
  | "quote"
  | "plan"
  | "audit"
  | "simulate"
  | "trade"
  | "createToken";
export type IntegrationStatus =
  | "available"
  | "degraded"
  | "unavailable"
  | "not_configured"
  | "unknown";

export interface IntegrationDescriptor {
  id: string;
  name: string;
  kind: IntegrationKind;
  chainId: number;
  networkMode: "mainnet" | "testnet";
  operations: Partial<Record<IntegrationOperation, IntegrationStatus>>;
  source: string;
  reason?: string;
}

const MAINNET = "mainnet" as const;

function launchpad(
  id: string,
  name: string,
  chainId: number,
  reason: string,
  execute: IntegrationStatus = "available",
): IntegrationDescriptor {
  return {
    id,
    name,
    kind: "launchpad",
    chainId,
    networkMode: MAINNET,
    operations: {
      inspect: "available",
      quote: "available",
      plan: "available",
      audit: "available",
      simulate: "available",
      trade: execute,
      /* Trading a launchpad token and creating a launch are different adapters.
         Creation stays explicitly unavailable until the factory/portal workflow
         has its own parameter validation, simulation and receipt checks. */
      createToken: "not_configured",
    },
    source: `${name} launchpad adapter`,
    reason,
  };
}

function aggregator(id: string, name: string, chainId: number): IntegrationDescriptor {
  return {
    id,
    name,
    kind: "aggregator",
    chainId,
    networkMode: MAINNET,
    operations: {
      inspect: "available",
      quote: "available",
      plan: "available",
      audit: "available",
      simulate: "available",
      trade: "available",
    },
    source: `${name} reviewed aggregator adapter`,
    reason: "Liquidity, quote freshness and executable calldata are checked at request time.",
  };
}

/**
 * The reviewed external integrations Luca and the app may describe.
 *
 * This is deliberately operation-level: a launchpad can be discoverable while
 * a specific creation or trading path is unavailable, and an aggregator being
 * listed here does not imply liquidity for every token pair.
 */
export function integrationsForChain(
  chainId: number | undefined,
  networkMode: "mainnet" | "testnet" = "mainnet",
): IntegrationDescriptor[] {
  if (chainId === undefined || networkMode !== "mainnet") return [];

  const out: IntegrationDescriptor[] = [];
  if (chainId === ARGUS_CHAIN_ID) {
    out.push(
      launchpad(
        "argus",
        "Argus",
        ARGUS_CHAIN_ID,
        `Argus trading is ${argusEnabled() ? "enabled" : "gated until ARGUS_ENABLED is enabled"}; pasted tokens still require live launch and pool verification.`,
        argusEnabled() ? "available" : "degraded",
      ),
      launchpad(
        "peach",
        "Peach",
        PEACH_CHAIN_ID,
        "Peach is Arc-mainnet only; pasted tokens still require live launch and curve verification.",
      ),
    );
  }

  if (hasKyberSwap(chainId)) out.push(aggregator("kyberswap", "KyberSwap", chainId));
  if (hasLifiSwap(chainId)) out.push(aggregator("lifi", "LI.FI", chainId));
  if (hasFlyTrade(chainId)) out.push(aggregator("flytrade", "Fly.trade", chainId));
  return out;
}

export function launchpadIntegrations(
  chainId?: number,
  networkMode: "mainnet" | "testnet" = "mainnet",
): IntegrationDescriptor[] {
  return integrationsForChain(chainId, networkMode).filter(
    (item) => item.kind === "launchpad",
  );
}

export function aggregatorIntegrations(
  chainId?: number,
  networkMode: "mainnet" | "testnet" = "mainnet",
): IntegrationDescriptor[] {
  return integrationsForChain(chainId, networkMode).filter(
    (item) => item.kind === "aggregator",
  );
}

export function integrationOperationStatus(
  item: IntegrationDescriptor,
  operation: IntegrationOperation,
): IntegrationStatus {
  return item.operations[operation] ?? "not_configured";
}
