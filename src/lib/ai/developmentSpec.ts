import { getChainMeta } from "@/constants/chains";

export interface ContractDevelopmentSpec {
  objective: string;
  chainId: number;
  networkMode: "mainnet" | "testnet";
  solidityVersion?: string;
  interfaces?: string[];
  constraints?: string[];
  testsRequired?: number;
}

export type DevelopmentReadiness = "ready_for_worker" | "unsupported" | "invalid";

export interface DevelopmentPlan {
  readiness: DevelopmentReadiness;
  spec: ContractDevelopmentSpec;
  reason: string;
  requiresUserApproval: true;
  artifacts: [];
}

export function prepareDevelopmentPlan(spec: ContractDevelopmentSpec): DevelopmentPlan {
  const objective = spec.objective.trim();
  const chain = getChainMeta(spec.chainId);
  if (!objective) {
    return {
      readiness: "invalid",
      spec,
      reason: "A contract objective is required before development can start.",
      requiresUserApproval: true,
      artifacts: [],
    };
  }
  if (!chain || chain.network !== spec.networkMode) {
    return {
      readiness: "invalid",
      spec,
      reason: "The requested chain is not registered in the selected network mode.",
      requiresUserApproval: true,
      artifacts: [],
    };
  }
  return {
    readiness: "unsupported",
    spec: { ...spec, objective },
    reason:
      "Luca can capture and review this specification, but the isolated compile/test/simulate worker is not enabled yet. No source, deployment, or signing artifact was produced.",
    requiresUserApproval: true,
    artifacts: [],
  };
}
