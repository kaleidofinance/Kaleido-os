import assert from "node:assert/strict";
import { inspectSynthraSteps } from "./synthraSteps";

const wallet = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const tx = {
  from: wallet,
  to: target,
  data: "0x1234",
  value: "0",
  chainId: 99901,
};
const steps = [
  { kind: "transaction", items: [{ kind: "transaction", data: tx }] },
];
assert.equal(inspectSynthraSteps(steps, wallet, 99901)?.length, 1);
assert.equal(inspectSynthraSteps(steps, wallet, 5042), null);
assert.equal(
  inspectSynthraSteps([{ kind: "signature", items: [] }], wallet, 99901),
  null,
);
assert.equal(
  inspectSynthraSteps(
    [
      {
        kind: "transaction",
        items: [{ kind: "transaction", data: { ...tx, from: target } }],
      },
    ],
    wallet,
    99901,
  ),
  null,
);
console.log("Synthra transaction inspection passed");
