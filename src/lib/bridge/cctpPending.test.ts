// Checks on the CCTP pending-burn store. Run with tsx.
//
// The store is localStorage-backed and guards on `typeof window`, so this stubs
// a Map-backed window.localStorage before exercising it: record/read roundtrip,
// dedup by burn hash, removal, per-wallet isolation, corrupt-row rejection, the
// entry cap, and that a write notifies same-tab subscribers.
const backing = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => backing.set(k, v),
    removeItem: (k: string) => backing.delete(k),
  },
};

import {
  cctpPendingKey,
  readCctpPending,
  recordCctpBurn,
  removeCctpPending,
  subscribeCctpPending,
  type PendingCctp,
} from "./cctpPending.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const entry = (over: Partial<PendingCctp> = {}): PendingCctp => ({
  txHash: "0x" + "ab".repeat(32),
  sourceChainId: 5042,
  destChainId: 8453,
  destChainName: "Base",
  amount: "100",
  symbol: "USDC",
  burnedAt: 1_700_000_000_000,
  ...over,
});

backing.clear();

console.log("\n— record + read roundtrip —");
recordCctpBurn(WALLET, entry());
const rows = readCctpPending(WALLET);
check("one row after a record", rows.length === 1);
check("the row round-trips its fields", rows[0]?.destChainName === "Base" && rows[0]?.amount === "100");
check("stored under the wallet-scoped key", backing.has(cctpPendingKey(WALLET)));

console.log("\n— dedup by burn hash —");
recordCctpBurn(WALLET, entry({ amount: "250" }));
const deduped = readCctpPending(WALLET);
check("same hash replaces, not appends", deduped.length === 1);
check("the replacement's fields win", deduped[0]?.amount === "250");
recordCctpBurn(WALLET, entry({ txHash: "0x" + "cd".repeat(32), amount: "5" }));
check("a different hash adds a second row", readCctpPending(WALLET).length === 2);

console.log("\n— per-wallet isolation —");
check("another wallet's list is empty", readCctpPending(OTHER).length === 0);

console.log("\n— removal —");
removeCctpPending(WALLET, "0x" + "ab".repeat(32));
const afterRemove = readCctpPending(WALLET);
check("removed the named burn", afterRemove.length === 1 && afterRemove[0]?.amount === "5");

console.log("\n— corrupt storage is dropped, not thrown —");
backing.set(cctpPendingKey(WALLET), JSON.stringify([{ txHash: "not-a-hash" }, "garbage", entry()]));
const cleaned = readCctpPending(WALLET);
check("only valid rows survive a read", cleaned.length === 1 && cleaned[0]?.symbol === "USDC");
backing.set(cctpPendingKey(WALLET), "{ not json");
check("unparseable storage reads as empty", readCctpPending(WALLET).length === 0);

console.log("\n— non-CCTP chains are rejected on the way in —");
backing.clear();
recordCctpBurn(WALLET, entry({ destChainId: 56, destChainName: "BNB" }));
check("a non-CCTP destination is not stored", readCctpPending(WALLET).length === 0);

console.log("\n— subscribers are notified on write —");
backing.clear();
let notified = "";
const off = subscribeCctpPending((k) => (notified = k));
recordCctpBurn(WALLET, entry());
check("write emits the wallet key to subscribers", notified === cctpPendingKey(WALLET));
off();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
