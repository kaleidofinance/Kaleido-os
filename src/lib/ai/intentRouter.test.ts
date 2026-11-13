import { canUseLocalCatalog, routeIntent } from "./intentRouter";

const cases: Array<[string, string]> = [
  ["swap 10 USDC to KLD", "deterministic_command"],
  ["what is my balance on Elysium?", "live_read"],
  ["how many launchpads are integrated on Arc?", "protocol_catalog"],
  ["hello Luca, what can you do?", "conversation"],
  ["compare the best yield across chains", "reasoning"],
];
for (const [message, expected] of cases) {
  const actual = routeIntent(message).route;
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
if (!canUseLocalCatalog("how many launchpads are integrated on Arc?")) {
  throw new Error("catalog question should be eligible for the local catalog");
}
if (canUseLocalCatalog("launch a token for me")) {
  throw new Error("execution request must not be answered by the local catalog");
}
console.log("Intent routing checks passed.");
