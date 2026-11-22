import { activateWalletIfEligible } from "./activateWallet";
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

async function main() {
  console.log("\n— activateWalletIfEligible —");

  // 1. Test already active wallet
  {
    const mockAdmin = {
      from: (table: string) => {
        if (table === "point_balances") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { wallet: "0x1111" } }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { wallet: "0x1111", activated_at: "2026-10-01" },
              }),
            }),
          }),
        };
      },
    } as unknown as SupabaseClient;

    const res = await activateWalletIfEligible(mockAdmin, "0x1111");
    check(
      "already active wallet returns activated: true and alreadyActive: true",
      res.activated === true && res.alreadyActive === true,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

void main();
