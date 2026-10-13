/** Run: npx tsx src/lib/auth/verifyWalletSignature.test.ts */
import { Wallet } from "ethers";
import { verifyWalletSignature } from "./verifyWalletSignature";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
};

const me = Wallet.createRandom();
const other = Wallet.createRandom();
const A = `Link my X account to the Kaleido wallet ${me.address}.`;
const B = `Link my X account to the Kaleido waitlist wallet ${me.address}.`;

(async () => {
  const sigB = await me.signMessage(B);
  // THE BUG: signing the second accepted wording used to fail as a mismatch,
  // because ecrecover over the first wording returns a stranger, not a throw.
  check("EOA signing the 2nd accepted message is accepted", await verifyWalletSignature(me.address, [A, B], sigB));
  check("EOA signing the 1st accepted message is accepted", await verifyWalletSignature(me.address, [A, B], await me.signMessage(A)));
  check("address match is case-insensitive", await verifyWalletSignature(me.address.toLowerCase(), B, sigB));
  check("someone else's signature is rejected", !(await verifyWalletSignature(me.address, [A, B], await other.signMessage(B))));
  check("a signature over an unaccepted message is rejected", !(await verifyWalletSignature(me.address, [A], sigB)));
  check("empty signature is rejected", !(await verifyWalletSignature(me.address, A, "")));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
