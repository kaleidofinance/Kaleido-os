import assert from "node:assert/strict";
import type { Signer } from "ethers";
import { assertPositionNetwork, guardPositionSigner } from "./positionNetwork";

async function main() {
  assert.throws(() => assertPositionNetwork(4663, 5042));
  assert.throws(() => assertPositionNetwork(undefined, undefined));
  let chain = 4663;
  let sends = 0;
  const signer = { sendTransaction: async () => { sends++; return {}; } } as unknown as Signer;
  const guarded = guardPositionSigner(signer, 4663, () => chain);
  await guarded.sendTransaction({});
  assert.equal(sends, 1);
  chain = 5042;
  await assert.rejects(() => guarded.sendTransaction({}));
  assert.equal(sends, 1, "network change between transaction steps must block submission");
  assert.throws(() => guardPositionSigner(signer, 4663, () => 5042));
  console.log("Position network guards: 5 checks passed");
}
void main();
