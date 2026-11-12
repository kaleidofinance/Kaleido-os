import assert from "node:assert/strict";
import { chainTokens } from "../../constants/tokens";
import { isPoolPositionToken, poolPositionTokens } from "./positionTokens";

const ELYSIUM = 99901;
const all = chainTokens(ELYSIUM);
const nativeHype = all.find((token) => token.symbol === "HYPE");
const whype = all.find((token) => token.symbol === "WHYPE");

assert(nativeHype?.isNative, "fixture must include native HYPE");
assert(whype && !whype.isNative, "fixture must include ERC-20 WHYPE");
assert.equal(
  isPoolPositionToken(nativeHype),
  false,
  "native HYPE must not be offered by an ERC-20 V3 position picker",
);
assert.equal(
  isPoolPositionToken(whype),
  true,
  "WHYPE must remain available for Elysium V3 positions",
);

const positionTokens = poolPositionTokens(ELYSIUM);
assert.equal(
  positionTokens.some((token) => token.symbol === "HYPE"),
  false,
  "the Elysium LP list must not show native HYPE and silently replace it",
);
assert.equal(
  positionTokens.some((token) => token.symbol === "WHYPE"),
  true,
  "the Elysium LP list must show WHYPE explicitly",
);

console.log("positionTokens: 6 assertions passed");
