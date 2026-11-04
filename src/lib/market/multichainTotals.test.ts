import { strict as assert } from "node:assert";
import { sumMeasured } from "./bookValue";

assert.equal(sumMeasured([11, 7]), 18, "Arc and Robinhood contributions add");
assert.equal(sumMeasured([11, null]), 11, "a failed network retains the successful lower bound");
assert.equal(sumMeasured([null, null]), null, "all failures stay unavailable");
assert.equal(sumMeasured([0, null]), 0, "a measured empty network stays zero");
assert.equal(sumMeasured([]), 0, "no deployed markets is an empty scope");
console.log("5 multi-chain total checks passed");
