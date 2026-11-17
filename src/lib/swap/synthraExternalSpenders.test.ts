import assert from "node:assert/strict";
import { isKnownSynthraExternalSpender } from "./synthraExternalSpenders";

const previous = process.env.SYNTHRA_EXTERNAL_SPENDERS;
process.env.SYNTHRA_EXTERNAL_SPENDERS =
  "4663:0x4444444444444444444444444444444444444444";

assert.equal(
  isKnownSynthraExternalSpender(
    4663,
    "0x4444444444444444444444444444444444444444",
  ),
  true,
);
assert.equal(
  isKnownSynthraExternalSpender(
    5042,
    "0x4444444444444444444444444444444444444444",
  ),
  false,
);
assert.equal(
  isKnownSynthraExternalSpender(
    4663,
    "0x5555555555555555555555555555555555555555",
  ),
  false,
);

if (previous === undefined) delete process.env.SYNTHRA_EXTERNAL_SPENDERS;
else process.env.SYNTHRA_EXTERNAL_SPENDERS = previous;

console.log("Synthra external spender allowlist passed");
