import {
  PROBE_COOLDOWN_MS,
  activateWalletIfEligible,
} from "./activateWallet";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${got}`);
  }
};

const NOW = Date.parse("2026-11-22T12:00:00Z");

interface MockOpts {
  hasBalance?: boolean;
  waitlistRow?: Record<string, unknown> | null;
  activeReferrals?: number;
  swapUsd?: number;
}

function makeMockAdmin(opts: MockOpts) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const admin = {
    from: (table: string) => {
      if (table === "point_balances") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.hasBalance ? { wallet: "0x1111" } : null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "waitlist") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.waitlistRow ?? null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: () => ({
                is: async () => ({ error: null }),
              }),
            };
          },
        };
      }
      if (table === "waitlist_leaderboard") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { active_referrals: opts.activeReferrals ?? 0 },
              }),
            }),
          }),
        };
      }
      if (table === "wallet_task_volume") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { swaps_usd: opts.swapUsd ?? 0, collateral_usd: 0 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "point_actions") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserted.push(payload);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { admin, inserted, updates };
}

async function main() {
  console.log("\n— activateWalletIfEligible —");

  // 1. Already active wallet (has balance + activated_at) skips Arc RPC probe
  {
    let probed = false;
    const { admin } = makeMockAdmin({
      hasBalance: true,
      waitlistRow: { wallet: "0x1111", activated_at: "2026-10-01T00:00:00Z" },
    });
    const res = await activateWalletIfEligible(admin, "0x1111", {
      nowMs: NOW,
      checkArcActivity: async () => {
        probed = true;
        return true;
      },
    });
    check(
      "already active wallet returns alreadyActive: true without probing RPC",
      res.activated === true && res.alreadyActive === true && !probed,
    );
  }

  // 2. Balance exists without waitlist row also short-circuits cleanly
  {
    let probed = false;
    const { admin } = makeMockAdmin({ hasBalance: true, waitlistRow: null });
    const res = await activateWalletIfEligible(admin, "0x1111", {
      nowMs: NOW,
      checkArcActivity: async () => {
        probed = true;
        return true;
      },
    });
    check(
      "wallet with balance and no waitlist row returns alreadyActive: true without probing RPC",
      res.activated === true && res.alreadyActive === true && !probed,
    );
  }

  // 3. Respects cooldown on passive reads when last_checked_at is recent
  {
    let probed = false;
    const recent = new Date(NOW - PROBE_COOLDOWN_MS + 10_000).toISOString();
    const { admin } = makeMockAdmin({
      hasBalance: false,
      waitlistRow: {
        wallet: "0x1111",
        activated_at: null,
        last_checked_at: recent,
      },
    });
    const res = await activateWalletIfEligible(admin, "0x1111", {
      respectCooldown: true,
      nowMs: NOW,
      checkArcActivity: async () => {
        probed = true;
        return true;
      },
    });
    check(
      "passive read inside cooldown skips RPC probe",
      res.activated === false && res.skippedCooldown === true && !probed,
    );
  }

  // 4. Negative probe (nonce === 0) stamps last_checked_at and inserts nothing
  {
    const { admin, inserted, updates } = makeMockAdmin({
      hasBalance: false,
      waitlistRow: {
        wallet: "0x1111",
        welcome_points: 100,
        activated_at: null,
        last_checked_at: null,
      },
    });
    const res = await activateWalletIfEligible(admin, "0x1111", {
      nowMs: NOW,
      checkArcActivity: async () => false,
    });
    check(
      "inactive wallet returns activated: false, inserts no point_actions, stamps last_checked_at",
      res.activated === false &&
        inserted.length === 0 &&
        updates.length === 1 &&
        typeof updates[0].last_checked_at === "string" &&
        !("activated_at" in updates[0]),
    );
  }

  // 5. Active wallet (nonce > 0) credits point_actions and stamps activated_at
  {
    const { admin, inserted, updates } = makeMockAdmin({
      hasBalance: false,
      waitlistRow: {
        wallet: "0x1111",
        welcome_points: 100,
        activated_at: null,
        last_checked_at: null,
      },
      activeReferrals: 2,
      swapUsd: 15,
    });
    const res = await activateWalletIfEligible(admin, "0x1111", {
      nowMs: NOW,
      checkArcActivity: async () => true,
    });
    // 100 welcome + 2*50 referrals + 500 ($10 swap tier) = 700
    check(
      "active wallet inserts canonical waitlist credit and stamps activated_at",
      res.activated === true &&
        res.points === 700 &&
        inserted.length === 1 &&
        inserted[0].tx_hash === "waitlist:0x1111" &&
        inserted[0].points === 700 &&
        updates.length === 1 &&
        typeof updates[0].activated_at === "string",
      JSON.stringify({ res, inserted, updates }),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

void main();
