import type { IntegrationDescriptor, IntegrationOperation, IntegrationStatus } from "./integrationCatalog";

export type Readiness = "ready" | "degraded" | "unavailable";

export interface IntegrationReadiness {
  id: string;
  name: string;
  kind: IntegrationDescriptor["kind"];
  chainId: number;
  operation: IntegrationOperation;
  configured: IntegrationStatus;
  readiness: Readiness;
  reason: string;
}

/** Convert a static catalog entry into a request-time, honest readiness row. */
export function evaluateIntegration(
  item: IntegrationDescriptor,
  operation: IntegrationOperation,
  liveCheck?: { ok: boolean; reason?: string },
): IntegrationReadiness {
  const configured = item.operations[operation] ?? "not_configured";
  if (configured === "not_configured" || configured === "unavailable") {
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      chainId: item.chainId,
      operation,
      configured,
      readiness: "unavailable",
      reason: item.reason ?? `${item.name} does not expose ${operation}.`,
    };
  }
  if (configured === "degraded" || liveCheck?.ok === false) {
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      chainId: item.chainId,
      operation,
      configured,
      readiness: "degraded",
      reason: liveCheck?.reason ?? item.reason ?? "A live check is required before use.",
    };
  }
  if (!liveCheck) {
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      chainId: item.chainId,
      operation,
      configured,
      readiness: "degraded",
      reason: "Configured adapter; quote/health check still required at request time.",
    };
  }
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    chainId: item.chainId,
    operation,
    configured,
    readiness: "ready",
    reason: liveCheck.reason ?? "Live adapter check passed.",
  };
}
