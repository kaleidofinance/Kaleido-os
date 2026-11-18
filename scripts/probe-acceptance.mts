import { probeMainnetAcceptance } from "../src/lib/ai/probeAcceptance";

async function main() {
  console.log("=================================================");
  console.log("  Luca Mainnet Acceptance Probe (Live RPC/Quote)  ");
  console.log("=================================================\n");

  const report = await probeMainnetAcceptance();

  for (const chain of report.chains) {
    const rpcStatus = chain.rpcOk
      ? `ONLINE (block #${chain.blockNumber}, ${chain.latencyMs}ms)`
      : `OFFLINE (${chain.error})`;
    console.log(`[Chain ${chain.chainId}] ${chain.chainName}: ${rpcStatus}`);

    for (const item of chain.integrations) {
      const tag = item.readiness === "ready" ? "[READY]" : item.readiness === "degraded" ? "[DEGRADED]" : "[UNAVAILABLE]";
      console.log(`   ${tag} [${item.kind}] ${item.name} (${item.operation}): ${item.readiness} - ${item.reason}`);
    }
    console.log("");
  }

  console.log("---------------- Summary ----------------");
  console.log(`RPC Pass Rate: ${(report.summary.rpcPassRate * 100).toFixed(1)}%`);
  console.log(`Ready Surfaces: ${report.summary.ready}`);
  console.log(`Degraded Surfaces: ${report.summary.degraded}`);
  console.log(`Unavailable Surfaces: ${report.summary.unavailable}`);
  console.log(`Total Surfaces Probed: ${report.summary.totalIntegrations}`);
  console.log("=========================================");
}

main().catch((err) => {
  console.error("Acceptance probe fatal error:", err);
  process.exit(1);
});
