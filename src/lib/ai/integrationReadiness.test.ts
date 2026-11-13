import { evaluateIntegration } from "./integrationReadiness";
import type { IntegrationDescriptor } from "./integrationCatalog";

const item: IntegrationDescriptor = {
  id: "flytrade",
  name: "Fly.trade",
  kind: "aggregator",
  chainId: 99901,
  networkMode: "mainnet",
  operations: { quote: "available" },
  source: "test",
};
if (evaluateIntegration(item, "quote").readiness !== "degraded") throw new Error("missing live check must degrade");
if (evaluateIntegration(item, "quote", { ok: true }).readiness !== "ready") throw new Error("healthy check must be ready");
if (evaluateIntegration({ ...item, operations: { createToken: "not_configured" } }, "createToken").readiness !== "unavailable") throw new Error("unconfigured operation must be unavailable");
console.log("Integration readiness checks passed.");
