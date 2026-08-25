// Adversarial checks on the transaction log. Run with plain node — no test
// runner in this repo. Mirrors src/lib/market/bookValue.test.ts.
//
// Two things here are worth testing and one of them is the whole reason the file
// exists. `txFromError` reads an outcome off an ethers error, and every case
// below is transcribed from the two places ethers 6 actually throws from
// `tx.wait()` (node_modules/ethers/lib.commonjs/providers/provider.js:1110 and
// :1127) rather than from memory — an earlier draft of that function read every
// throw as a revert, which would have told a user who hit "speed up" that a swap
// that landed had failed. `tsc` was perfectly happy with it.
//
// The store half is tested because localStorage is user-writable and survives a
// deploy, so the parser's job is to never let a hand-edited row throw on open.
import {
  clearTxLog,
  readTxLog,
  recordTx,
  subscribeTxLog,
  txFromError,
  txLogKey,
  type TxLogEntry,
} from "./txLog.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const HASH_A = H(0xaaa);
const HASH_B = H(0xbbb);

/* -------------------------------------------------------------------------- */
console.log("\n— txFromError: nothing reached the chain —\n");

check("null is not a transaction", txFromError(null) === null);
check("undefined is not a transaction", txFromError(undefined) === null);
check("a string is not a transaction", txFromError("boom") === null);

/* ACTION_REJECTED — the user closed the wallet prompt. No receipt, nothing
   broadcast, nothing paid. A row for this would record a decision not to
   trade. */
check(
  "rejected signature",
  txFromError({ code: "ACTION_REJECTED", reason: "rejected" }) === null,
);

/* UNPREDICTABLE_GAS_LIMIT / estimateGas revert — carries revert data and a
   `transaction`, but that object is `{ to, from, data }` with no hash
   (errors.d.ts:290-294), so there is nothing to link to and nothing was spent. */
check(
  "failed gas estimate, transaction without a hash",
  txFromError({
    code: "CALL_EXCEPTION",
    action: "estimateGas",
    reason: "K: INSUFFICIENT_OUTPUT_AMOUNT",
    transaction: { to: "0x00", from: "0x01", data: "0x" },
  }) === null,
);

/* The old dead branch, kept as a case so its removal stays deliberate: a hash
   hanging off `transaction` is not a mined transaction. */
check(
  "hash on transaction alone is not enough",
  txFromError({ transaction: { hash: HASH_A } }) === null,
);

/* -------------------------------------------------------------------------- */
console.log("\n— txFromError: reverted after broadcast —\n");

/* provider.js:1122-1135 — `checkReceipt` asserts CALL_EXCEPTION when
   `receipt.status === 0`, with that receipt attached. Cost gas; the one failure
   worth a row. */
const reverted = txFromError({
  code: "CALL_EXCEPTION",
  action: "sendTransaction",
  reason: null,
  transaction: { to: "0x00", from: "0x01", data: "" },
  receipt: { hash: HASH_A, status: 0 },
});
check(
  "status 0 is reverted",
  reverted?.status === "reverted",
  JSON.stringify(reverted),
);
check("reverted keeps the receipt's hash", reverted?.hash === HASH_A);

/* -------------------------------------------------------------------------- */
console.log("\n— txFromError: replaced by the wallet —\n");

/* provider.js:1110-1116 — "speed up" in MetaMask. Throws even though the
   replacement landed, and the attached receipt is the replacement's, status 1.
   Reading the throw as a failure is the bug this case exists to prevent. */
const repriced = txFromError({
  code: "TRANSACTION_REPLACED",
  cancelled: false,
  reason: "repriced",
  hash: HASH_B,
  receipt: { hash: HASH_B, status: 1 },
});
check(
  "repriced and mined is confirmed, not reverted",
  repriced?.status === "confirmed",
  JSON.stringify(repriced),
);
check(
  "repriced logs the replacement's hash, the one the explorer has",
  repriced?.hash === HASH_B,
);

/* A repriced transaction can itself revert. The status still comes from the
   receipt, so this must not be swept in with the success above. */
check(
  "repriced then reverted is reverted",
  txFromError({
    code: "TRANSACTION_REPLACED",
    cancelled: false,
    reason: "repriced",
    hash: HASH_B,
    receipt: { hash: HASH_B, status: 0 },
  })?.status === "reverted",
);

/* `cancelled` is ethers' own "the original's effects cannot be assured"
   (errors.d.ts:387-390). The transaction that landed is a zero-value self-send;
   filing it under "Swap 1 ETH for USDC — confirmed" would be a lie with a
   working explorer link attached. */
check(
  "cancelled is not logged, even though its receipt says status 1",
  txFromError({
    code: "TRANSACTION_REPLACED",
    cancelled: true,
    reason: "cancelled",
    hash: HASH_B,
    receipt: { hash: HASH_B, status: 1 },
  }) === null,
);
check(
  "reason 'replaced' is also cancelled per provider.js:1111",
  txFromError({
    code: "TRANSACTION_REPLACED",
    cancelled: true,
    reason: "replaced",
    hash: HASH_B,
    receipt: { hash: HASH_B, status: 1 },
  }) === null,
);

/* -------------------------------------------------------------------------- */
console.log("\n— txFromError: unusable receipts —\n");

check(
  "no status is an unknown outcome, not a guess",
  txFromError({ receipt: { hash: HASH_A } }) === null,
);
check(
  "status 2 is not a status this store can name",
  txFromError({ receipt: { hash: HASH_A, status: 2 } }) === null,
);
check(
  "a truncated hash is not a hash",
  txFromError({ receipt: { hash: "0xdeadbeef", status: 0 } }) === null,
);
check(
  "a non-hex hash is not a hash",
  txFromError({ receipt: { hash: `0x${"z".repeat(64)}`, status: 0 } }) === null,
);

/* -------------------------------------------------------------------------- */
console.log("\n— the store —\n");

/* Enough of localStorage to exercise the real code paths, including a throwing
   setItem for the quota case. Node has no `window`, and txLog.ts guards on
   exactly that, so every read above this line returned an empty log. */
let store = new Map<string, string>();
let throwOnSet = false;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  },
};

const CHAIN = 11124;
const ADDR = "0xAbCdEf0123456789012345678901234567890123";
const entry = (hash: string, at: number, title = "Swap"): TxLogEntry => ({
  hash,
  kind: "swap",
  title,
  status: "confirmed",
  at,
});

recordTx(CHAIN, ADDR, entry(HASH_A, 1000));
recordTx(CHAIN, ADDR, entry(HASH_B, 2000));
const roundTrip = readTxLog(CHAIN, ADDR);
check("both entries survive a round trip", roundTrip.length === 2);
check(
  "newest first, regardless of timestamp order",
  roundTrip[0]?.hash === HASH_B,
);

/* Re-recording the same transaction is a status correction or a double call,
   never a second transaction — and the hash comparison is case-insensitive
   because an explorer link and a wallet can disagree on checksum casing. */
recordTx(CHAIN, ADDR, {
  ...entry(HASH_A.toUpperCase().replace("0X", "0x"), 3000),
  status: "reverted",
});
const deduped = readTxLog(CHAIN, ADDR);
check("re-recording replaces rather than appends", deduped.length === 2);
check(
  "the replacement wins and moves to the top",
  deduped[0]?.status === "reverted",
  JSON.stringify(deduped[0]),
);

/* -------------------------------------------------------------------------- */
console.log("\n— the store: scoping —\n");

check(
  "another chain is another log",
  readTxLog(8453, ADDR).length === 0,
  `key ${txLogKey(8453, ADDR)}`,
);
check(
  "another wallet is another log — a shared machine must not leak",
  readTxLog(CHAIN, "0x1111111111111111111111111111111111111111").length === 0,
);
check(
  "the same wallet in different casing is the same log",
  readTxLog(CHAIN, ADDR.toLowerCase()).length === 2,
);
check(
  "the key is lowercased",
  txLogKey(CHAIN, ADDR) === txLogKey(CHAIN, ADDR.toLowerCase()),
);
check(
  "no chain is no log, rather than a global one",
  readTxLog(undefined, ADDR).length === 0,
);
check("no address is no log", readTxLog(CHAIN, undefined).length === 0);

/* -------------------------------------------------------------------------- */
console.log("\n— the store: hostile storage —\n");

const KEY = txLogKey(CHAIN, ADDR);

store.set(KEY, "{not json");
check(
  "corrupt JSON reads as an empty log, not a throw",
  readTxLog(CHAIN, ADDR).length === 0,
);

store.set(KEY, JSON.stringify({ hash: HASH_A }));
check(
  "a bare object where an array belongs reads empty",
  readTxLog(CHAIN, ADDR).length === 0,
);

store.set(KEY, JSON.stringify("nope"));
check("a bare string reads empty", readTxLog(CHAIN, ADDR).length === 0);

/* Row-by-row, not all-or-nothing: one bad row written by an older build must not
   hide the good ones beside it. */
store.set(
  KEY,
  JSON.stringify([
    entry(HASH_A, 1000),
    null,
    42,
    { hash: "nope", kind: "swap", title: "x", status: "confirmed", at: 1 },
    { hash: HASH_B, kind: "swap", title: "x", status: "elsewhere", at: 1 },
    { hash: HASH_B, kind: "swap", title: "x", status: "confirmed", at: "soon" },
    { hash: HASH_B, kind: "swap", status: "confirmed", at: 1 },
    { hash: HASH_B, kind: "swap", title: "x", status: "confirmed", at: NaN },
    { ...entry(HASH_B, 2000), detail: 7 },
    entry(HASH_B, 2000),
  ]),
);
const filtered = readTxLog(CHAIN, ADDR);
check(
  "eight malformed rows dropped, two kept",
  filtered.length === 2,
  `got ${filtered.length}: ${JSON.stringify(filtered.map((e) => e.hash))}`,
);

/* -------------------------------------------------------------------------- */
console.log("\n— the store: the cap —\n");

store = new Map();
for (let i = 1; i <= 60; i++) recordTx(CHAIN, ADDR, entry(H(i), i * 1000));
const capped = readTxLog(CHAIN, ADDR);
check("capped at 50 entries", capped.length === 50, `got ${capped.length}`);
check("the newest is kept", capped[0]?.hash === H(60));
check("the oldest is dropped", !capped.some((e) => e.hash === H(1)));
check("the 50th newest survives", capped[49]?.hash === H(11));

/* -------------------------------------------------------------------------- */
console.log("\n— the store: change notification —\n");

/* Load-bearing: `localStorage.setItem` fires `storage` in other tabs and never
   in the one that wrote, so without this emitter an open modal sits stale while
   PlanReview fills the log three components away. */
const seen: string[] = [];
const off = subscribeTxLog((k) => seen.push(k));

recordTx(CHAIN, ADDR, entry(H(99), 99000));
check(
  "a write notifies",
  seen.length === 1 && seen[0] === KEY,
  JSON.stringify(seen),
);

clearTxLog(CHAIN, ADDR);
check("a clear notifies", seen.length === 2);
check("and the log is gone", readTxLog(CHAIN, ADDR).length === 0);

/* A write that did not happen must not tell the modal to re-read. */
throwOnSet = true;
recordTx(CHAIN, ADDR, entry(H(98), 98000));
check(
  "a failed write does not notify",
  seen.length === 2,
  JSON.stringify(seen),
);
throwOnSet = false;

/* An invalid entry is rejected at the door, so a bad row never reaches storage
   in the first place — the reader's filter is the second line of defence, not
   the only one. */
recordTx(CHAIN, ADDR, { ...entry(HASH_A, 1), hash: "0x00" } as TxLogEntry);
check("an invalid entry is not written", readTxLog(CHAIN, ADDR).length === 0);
check("and does not notify", seen.length === 2);

off();
recordTx(CHAIN, ADDR, entry(HASH_A, 1));
check("unsubscribing stops the notifications", seen.length === 2);

/* -------------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
