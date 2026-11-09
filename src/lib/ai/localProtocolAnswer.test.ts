import assert from "node:assert/strict";
import { launchpadAnswer, launchpadQuestion } from "./localProtocolAnswer";

assert.equal(launchpadQuestion("how many launchpad kaleido support on arc?"), true);
assert.equal(launchpadQuestion("how many launchpad kaleido integrated on arc?"), true);
assert.equal(launchpadQuestion("which launchpads are integrated on Arc?"), true);
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
  /No launchpad adapter is registered on this chain/,
);
assert.match(
  launchpadAnswer("which launchpads are live?", {
    chainId: 99801,
    showTestnets: true,
  }) ?? "",
  /Arc mainnet only: Argus and Peach/,
);

console.log("Local launchpad answer checks passed.");
