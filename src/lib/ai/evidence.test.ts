import assert from "node:assert/strict";
import {
  evidenceOk,
  evidencePartial,
  evidenceUnavailable,
  evidenceUnsupported,
} from "./evidence";

const base = {
  scope: { chainIds: [5042], networkMode: "mainnet" as const },
  source: "test source",
  coverage: {
    requested: ["balance"],
    succeeded: ["balance"],
    failed: [],
  },
  evidenceId: "evidence-test-1",
};

const ok = evidenceOk({ balance: "10" }, base);
assert.equal(ok.status, "ok");
assert.deepEqual(ok.data, { balance: "10" });
assert.equal(ok.observedAt, ok.fetchedAt);
assert.equal(ok.evidenceId, "evidence-test-1");

const partial = evidencePartial(
  { balances: { USDC: "10" }, missing: ["EURC"] },
  {
    ...base,
    coverage: {
      requested: ["USDC", "EURC"],
      succeeded: ["USDC"],
      failed: ["EURC"],
    },
    warnings: ["EURC provider timed out."],
  },
);
assert.equal(partial.status, "partial");
assert.equal(partial.warnings[0], "EURC provider timed out.");

const unavailable = evidenceUnavailable({
  ...base,
  coverage: { requested: ["balance"], succeeded: [], failed: ["balance"] },
});
assert.equal(unavailable.status, "unavailable");
assert.equal(unavailable.data, null);
assert.equal(unavailable.observedAt, null);

const unsupported = evidenceUnsupported({
  ...base,
  scope: { chainIds: [999999], networkMode: "mainnet" },
  coverage: {
    requested: ["integration catalog"],
    succeeded: [],
    failed: ["chain registry"],
  },
});
assert.equal(unsupported.status, "unsupported");
assert.equal(unsupported.data, null);
assert.equal(unsupported.observedAt, null);

console.log("Evidence envelope checks passed.");
