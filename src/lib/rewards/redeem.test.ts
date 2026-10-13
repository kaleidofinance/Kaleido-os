/** Run: npx tsx src/lib/rewards/redeem.test.ts */
import { makeCode, normalizeCode, redeemMessage } from "./redeem";

let passed = 0;
let failed = 0;
const check = (n: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.log(`  FAIL ${n}`); }
};

check("normalizes case and spaces", normalizeCode(" kld-ab12 cd34 ") === "KLD-AB12CD34");
check("rejects too short", normalizeCode("AB1") === "");
check("rejects odd characters", normalizeCode("KLD_ABCD!") === "");
const c = makeCode("arc");
check("code shape PREFIX-XXXX-XXXX-XXXX", /^ARC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c));
check("no ambiguous characters", !/[01OI]/.test(c.slice(4)));
check("a generated code passes normalize", normalizeCode(c) === c);
check("message names code and lowercased wallet",
  redeemMessage("0xABC", "kld-ab12-cd34-ef56") === "Redeem Kaleido code KLD-AB12-CD34-EF56 for wallet 0xabc.");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
