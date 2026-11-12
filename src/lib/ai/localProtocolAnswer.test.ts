import assert from "node:assert/strict";
import { launchpadAnswer, launchpadQuestion } from "./localProtocolAnswer";

assert.equal(
  launchpadQuestion("how many launchpad kaleido support on arc?"),
  true,
);
assert.equal(
  launchpadQuestion("how many launchpad kaleido integrated on arc?"),
  true,
);
assert.equal(
  launchpadQuestion("which launchpads are integrated on Arc?"),
  true,
);
assert.equal(launchpadQuestion("launch a token on Peach"), false);
assert.equal(launchpadQuestion("trade this launchpad token"), false);

assert.match(
  launchpadAnswer("how many launchpad kaleido support on arc?", {
    chainId: 5042,
    showTestnets: false,
  }) ?? "",
  /2 launchpads on Arc: Argus and Peach/,
);
assert.match(
  launchpadAnswer("how many launchpad integrations?", {
    chainId: 56,
    showTestnets: false,
  }) ?? "",
  /No launchpad trading adapter is registered on BNB Smart Chain/,
);
assert.match(
  launchpadAnswer("how many launchpads are integrated on Elysium?", {
    chainId: 5042,
    showTestnets: false,
  }) ?? "",
  /12 launchpads on Elysium: Montra, BOXA/,
);
assert.match(
  launchpadAnswer("how many launchpad integrations?", {
    showTestnets: false,
  }) ?? "",
  /14 launchpads across two mainnets/,
);
assert.match(
  launchpadAnswer("which launchpads are live?", {
    chainId: 99801,
    showTestnets: true,
  }) ?? "",
  /No launchpad trading adapter is registered on Elysium Testnet/,
);

console.log("Local launchpad answer checks passed.");
