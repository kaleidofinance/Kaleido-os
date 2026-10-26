import assert from "node:assert/strict";
import { analyticsChain } from "./scope";
assert.equal(analyticsChain(null), undefined);
assert.equal(analyticsChain("all"), undefined);
assert.equal(analyticsChain("5042"), 5042);
assert.equal(analyticsChain("4663"), 4663);
for (const raw of ["5042002", "1", "garbage", "5042,4663"]) assert.throws(() => analyticsChain(raw));
console.log("Analytics scope: 8 checks passed");
