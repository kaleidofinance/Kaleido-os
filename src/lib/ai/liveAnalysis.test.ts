import assert from "node:assert/strict";
import { isLiveAnalysisRequest } from "./liveAnalysis";

assert.equal(
  isLiveAnalysisRequest("Find yield source available on Elysium chain"),
  true,
);
assert.equal(isLiveAnalysisRequest("How much revenue has Kaleido made across chains?"), true);
assert.equal(
  isLiveAnalysisRequest("compare lending rates across Arc and BSC"),
  true,
);
assert.equal(isLiveAnalysisRequest("what is APR?"), false);
assert.equal(isLiveAnalysisRequest("what is slippage?"), false);
assert.equal(isLiveAnalysisRequest("swap 100 USDC to EURC"), false);

console.log("Live analysis routing checks passed.");
