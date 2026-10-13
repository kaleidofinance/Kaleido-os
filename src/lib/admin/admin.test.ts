/**
 * Admin gate + admin metric summarisers, offline.
 * Run: `npx tsx src/lib/admin/admin.test.ts`.
 *
 * verifyAdmin is exercised with REAL ethers signatures (a throwaway wallet signs
 * the exact message the client would), so the recover + allowlist + freshness
 * path is proven, not mocked. The summarisers are pure.
 */

import { Wallet } from "ethers";
import { verifyAdmin, adminMessage, ADMIN_PROOF_TTL_MS } from "@/lib/admin/auth";
import { summarizeHealth, summarizeQuota } from "@/lib/analytics/admin";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

async function main() {
  const admin = Wallet.createRandom();
  const stranger = Wallet.createRandom();
  const ts = Date.now();
  const sig = await admin.signMessage(adminMessage(ts));

  console.log("— verifyAdmin —");
  process.env.ADMIN_WALLETS = admin.address.toLowerCase();
  {
    const v = verifyAdmin({ address: admin.address, signature: sig, ts });
    check("valid signature from an allowlisted wallet → ok", v.ok === true, v);
  }
  {
    // Right message, but the signer is not the claimed address.
    const badSig = await stranger.signMessage(adminMessage(ts));
    const v = verifyAdmin({ address: admin.address, signature: badSig, ts });
    check("signature from another wallet → rejected", v.ok === false && v.status === 401);
  }
  {
    const v = verifyAdmin({ address: admin.address, signature: sig, ts: ts - ADMIN_PROOF_TTL_MS - 1000 });
    check("a stale timestamp → expired", v.ok === false && v.status === 401);
  }
  {
    // Valid signature, but the wallet is no longer on the allowlist.
    process.env.ADMIN_WALLETS = stranger.address.toLowerCase();
    const v = verifyAdmin({ address: admin.address, signature: sig, ts });
    check("valid signature but not allowlisted → 403", v.ok === false && v.status === 403, v);
    process.env.ADMIN_WALLETS = admin.address.toLowerCase();
  }
  {
    const v = verifyAdmin({ address: admin.address, signature: "0xdead", ts });
    check("malformed signature → 400", v.ok === false && v.status === 400);
  }

  console.log("\n— summarizeHealth —");
  {
    const h = summarizeHealth([
      { status: "ok", latency_ms: 1000, failed_over: false, provider: "ai-gateway" },
      { status: "ok", latency_ms: 3000, failed_over: true, provider: "ai-gateway" },
      { status: "refused", latency_ms: 800, failed_over: false, provider: "ai-gateway" },
      { status: "provider_error", latency_ms: null, failed_over: false, provider: "gemini" },
    ]);
    check("total", h.total === 4);
    check("byStatus counts each", h.byStatus.ok === 2 && h.byStatus.refused === 1 && h.byStatus.provider_error === 1);
    check("okRate = ok/total", Math.abs(h.okRate - 0.5) < 1e-9);
    check("errorRate counts only real errors (refused is NOT an error)", Math.abs(h.errorRate - 0.25) < 1e-9, h.errorRate);
    check("failoverRate", Math.abs(h.failoverRate - 0.25) < 1e-9);
    check("avg latency ignores null", h.avgLatencyMs === 1600, h.avgLatencyMs);
    check("provider mix", h.providerMix["ai-gateway"] === 3 && h.providerMix.gemini === 1);
  }
  {
    const h = summarizeHealth([]);
    check("empty → zero rates, null latency", h.total === 0 && h.okRate === 0 && h.avgLatencyMs === null);
  }

  console.log("\n— summarizeQuota —");
  {
    const q = summarizeQuota([
      { wallet: "0xAAA", requests: 10 },
      { wallet: "0xBBB", requests: "3" },
      { wallet: "0xCCC", requests: 0 },
    ]);
    check("requests today = sum of positive", q.requestsToday === 13, q.requestsToday);
    check("active wallets = distinct", q.walletsToday === 3);
    check("top wallets sorted desc, positives only", q.topWalletsToday[0].wallet === "0xaaa" && q.topWalletsToday.length === 2);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
