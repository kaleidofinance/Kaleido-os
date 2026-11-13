import { getChainMeta } from "@/constants/chains";
import { integrationsForChain, type IntegrationDescriptor } from "./integrationCatalog";

export interface LaunchpadCreationSpec {
  chainId: number;
  networkMode: "mainnet" | "testnet";
  launchpadId: string;
  name: string;
  symbol: string;
  supply?: string;
  decimals?: number;
  metadataUri?: string;
}

export type LaunchpadCreationReadiness = "ready_for_adapter" | "unsupported" | "invalid";

export interface LaunchpadCreationPlan {
  readiness: LaunchpadCreationReadiness;
  spec: LaunchpadCreationSpec;
  integration: IntegrationDescriptor | null;
  reason: string;
  requiresUserApproval: true;
  artifacts: [];
}

export function prepareLaunchpadCreation(spec: LaunchpadCreationSpec): LaunchpadCreationPlan {
  const chain = getChainMeta(spec.chainId);
  const integration = integrationsForChain(spec.chainId, spec.networkMode).find(
    (item) => item.id === spec.launchpadId && item.kind === "launchpad",
  ) ?? null;
  if (!chain || chain.network !== spec.networkMode || !integration) {
    return {
      readiness: "invalid",
      spec,
      integration,
      reason: "The requested launchpad is not registered for this chain and network mode.",
      requiresUserApproval: true,
      artifacts: [],
    };
  }
  if (integration.operations.createToken !== "available") {
    return {
      readiness: "unsupported",
      spec,
      integration,
      reason:
        `${integration.name} token creation is not configured. Luca can inspect and trade verified launches, but it will not invent a factory call or return a signable creation plan.`,
      requiresUserApproval: true,
      artifacts: [],
    };
  }
  return {
    readiness: "ready_for_adapter",
    spec,
    integration,
    reason: "The launchpad creation adapter is registered; validation, simulation, and user approval are still required.",
    requiresUserApproval: true,
    artifacts: [],
  };
}
