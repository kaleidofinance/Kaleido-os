// Checks on the filler's decisions. Run with `npx tsx src/lib/dex/fill.test.ts`.
//
// The keeper is the only party that spends money on someone else's order, and it
// spends it whether or not the fill lands: a reverted `fill` costs the gas and
// changes nothing. So the whole cost of a wrong decision here is a slow drain on
// a schedule, with no user to notice and no error anywhere — which is why the
// decision is a pure function and this file exists.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. The quote-input rule. A fill swaps `swapInputFor(amountIn, fee)`, not
//      `amountIn`, so quoting the full input overstates the output by the filler's
//      cut and the order looks fillable at exactly the prices where the fill
//      reverts. Enforced with a throw, asserted in test 2.
//   2. The terminal/transient split. A reason wrongly called terminal cancels a
//      live order in the UI; a reason wrongly called transient is re-quoted every
//      cycle forever. Tests 5-7, and test 7 reads the contract so a new reason
//      string cannot be added without landing on one side or the other.
//   3. `reconcile` taking the chain's fill count rather than incrementing ours.
//      Test 8, including the 1970 timestamp that would report every recurring
//      order as ready.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_REASONS,
  bestQuote,
  decideFill,
  reconcile,
  sweepable,
  type TierQuote,
} from "./fill";
import type { Order, StoredOrder } from "./orders";

let pass = 0;
let fail = 0;
/* A decision carries bigints and the detail argument is evaluated whether or not
   the check fails, so a plain `JSON.stringify` throws on the passing cases too. */
const show = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/* A KLD → USDC order: 1000 KLD (18) for at least 30 USDC (6), one fill. Written
   as a literal rather than through `buildOrder` so the fields under test are the
   ones on the page, not whatever the builder defaults to. */
const order: Order = {
  maker: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000000",
  minOut: "30000000",
  startAt: 0,
  expiry: 1_900_000_000,
  interval: 0,
  maxFills: 1,
  epoch: 0,
  salt: "42",
};

/* The fee the deployed contract carries today. Zero means `swapInputFor` is the
   identity, so every case below is also written with a non-zero fee somewhere —
   an arithmetic guard that only holds at 0 holds by accident. */
const FEE_BPS = 30;
const swapIn = (BigInt(order.amountIn) * BigInt(9970)) / BigInt(10_000);

const ok = { ok: true, reason: "" };
const q = (fee: number, out: bigint | null): TierQuote => ({ fee, out });

/* ------------------------------------------------------------------ 1 -- */
/* bestQuote. */
check(
  "bestQuote picks the route that pays most",
  bestQuote([q(500, BigInt(10)), q(3000, BigInt(31)), q(10000, BigInt(20))])
    ?.fee === 3000,
);
check(
  "bestQuote gives a tie to the earlier tier, so the maker keeps the cheaper pool",
  bestQuote([q(500, BigInt(31)), q(3000, BigInt(31))])?.fee === 500,
);
check(
  "bestQuote ignores a pool that did not quote",
  bestQuote([q(500, null), q(3000, BigInt(5))])?.fee === 3000,
);
check(
  "bestQuote treats a zero quote as no quote",
  bestQuote([q(500, BigInt(0))]) === null,
);
check("bestQuote is null when nothing quoted", bestQuote([q(500, null)]) === null);

/* ------------------------------------------------------------------ 2 -- */
/* The quote-input rule, which is the one mistake this module can catch for its
   caller. Quoting `amountIn` instead of `swapInputFor(amountIn, fee)` overstates
   the output by 30bps here — small, and exactly the size of the band where an
   order is quoted as fillable and reverts. */
{
  let threw = "";
  try {
    decideFill({
      order,
      terms: ok,
      quotes: [q(3000, BigInt(order.minOut))],
      quotedFor: BigInt(order.amountIn),
      fillerFeeBps: FEE_BPS,
    });
  } catch (e) {
    threw = (e as Error).message;
  }
  check(
    "quoting the full amountIn is refused rather than acted on",
    threw.includes("Quote swapInputFor"),
    threw || "did not throw",
  );
}
check(
  "and the same call with the reduced input is accepted",
  decideFill({
    order,
    terms: ok,
    quotes: [q(3000, BigInt(order.minOut))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  }).action === "fill",
);
check(
  "a zero fee means the full amount IS the swap input",
  decideFill({
    order,
    terms: ok,
    quotes: [q(3000, BigInt(order.minOut))],
    quotedFor: BigInt(order.amountIn),
    fillerFeeBps: 0,
  }).action === "fill",
);

/* ------------------------------------------------------------------ 3 -- */
/* The price condition. */
{
  const d = decideFill({
    order,
    terms: ok,
    quotes: [q(500, BigInt(29_000_000)), q(3000, BigInt(30_500_000))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    "a route paying above the floor is filled along that route",
    d.action === "fill" && d.fee === 3000 && d.quotedOut === BigInt(30_500_000),
    show(d),
  );
}
{
  /* One unit short. The floor is the maker's price and the contract enforces it
     against the router, so "close enough" is a reverted transaction. */
  const d = decideFill({
    order,
    terms: ok,
    quotes: [q(3000, BigInt(29_999_999))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    "a route one base unit below the floor waits",
    d.action === "wait",
    show(d),
  );
  check(
    "and the reason names both numbers, so a log says how far away it was",
    d.action === "wait" &&
      d.because.includes("29999999") &&
      d.because.includes("30000000"),
    show(d),
  );
}
{
  const d = decideFill({
    order,
    terms: ok,
    quotes: [q(500, null), q(3000, null)],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    "a pair with no pool waits rather than being written off",
    d.action === "wait" && d.because.includes("no pool"),
    show(d),
  );
}
{
  /* Exactly the floor fills. The contract's own comparison is `>=` — the router
     is given `minOut` as its minimum, not as a bound to beat. */
  const d = decideFill({
    order,
    terms: ok,
    quotes: [q(3000, BigInt(order.minOut))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check("a route paying exactly the floor fills", d.action === "fill", show(d));
}

/* ------------------------------------------------------------------ 4 -- */
/* The terms come first: a dead order is never quoted, whatever the price. */
{
  const d = decideFill({
    order,
    terms: { ok: false, reason: "expired" },
    quotes: [q(3000, BigInt(order.minOut) * BigInt(10))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    "a refused order is not filled even at ten times the floor",
    d.action === "reconcile" && d.status === "expired",
    show(d),
  );
}

/* ------------------------------------------------------------------ 5 -- */
/* Every terminal reason, and the word the row gets. */
const TERMINAL_CASES: Array<[string, string]> = [
  ["cancelled", "cancelled"],
  ["cancelled by the maker", "cancelled"],
  ["expired", "expired"],
  ["fully filled", "filled"],
];
for (const [reason, status] of TERMINAL_CASES) {
  const d = decideFill({
    order,
    terms: { ok: false, reason },
    quotes: [],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    `"${reason}" writes the row off as ${status}`,
    d.action === "reconcile" && d.status === status,
    show(d),
  );
}

/* ------------------------------------------------------------------ 6 -- */
/*
 * Every reason that must NOT be written off, and each for its own reason. The
 * last one is the case that matters: an ERC-1271 wallet is a contract, and a
 * contract can answer differently tomorrow — so treating this as terminal would
 * cancel live orders belonging to exactly the makers who signed with an in-app
 * email or social wallet.
 */
const TRANSIENT_REASONS = [
  "not started",
  "waiting for the next interval",
  "malformed order",
  "path does not match the pair",
  "signature does not match the maker",
];
for (const reason of TRANSIENT_REASONS) {
  const d = decideFill({
    order,
    terms: { ok: false, reason },
    quotes: [q(3000, BigInt(order.minOut))],
    quotedFor: swapIn,
    fillerFeeBps: FEE_BPS,
  });
  check(
    `"${reason}" waits instead of being written off`,
    d.action === "wait" && d.because === reason,
    show(d),
  );
}

/* ------------------------------------------------------------------ 7 -- */
/*
 * The tripwire: the contract is the source of these strings.
 *
 * An unmatched reason does not fail loudly — it falls through to `wait`, and the
 * keeper quotes a dead order every cycle for as long as it exists. So the two
 * lists above are checked against the .sol rather than against each other, and a
 * reason added to `checkFill` fails this suite until someone decides which side
 * it belongs on.
 *
 * The count assertion is the control. A regex that matched nothing would satisfy
 * "every extracted reason is accounted for" perfectly.
 */
{
  const sol = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../smart-contract/contracts/Orders/KaleidoOrders.sol",
    ),
    "utf8",
  );
  const found = [...sol.matchAll(/return \(false, "([^"]+)"\)/g)].map((m) => m[1]);
  check(
    "the contract's refusal strings were actually found",
    found.length >= 9,
    `found ${found.length}: ${found.join(", ")}`,
  );
  const unaccounted = found.filter(
    (r) => !(r in TERMINAL_REASONS) && !TRANSIENT_REASONS.includes(r),
  );
  check(
    "every reason checkFill can return is either terminal or deliberately transient",
    unaccounted.length === 0,
    `unaccounted: ${unaccounted.join(", ")}`,
  );
  /* And the other direction: a terminal reason this contract cannot return is a
     transcription that has drifted, which reads as coverage while covering
     nothing. */
  const stale = Object.keys(TERMINAL_REASONS).filter((r) => !found.includes(r));
  check(
    "and every terminal reason is a string the contract actually returns",
    stale.length === 0,
    `stale: ${stale.join(", ")}`,
  );
}

/* ------------------------------------------------------------------ 8 -- */
/* reconcile. */
const state = (over: Partial<{ cancelled: boolean; fills: number; lastFillAt: number }>) => ({
  cancelled: false,
  fills: 0,
  lastFillAt: 0,
  ...over,
});
const NOW = 1_800_000_000;
const recurring: Order = { ...order, interval: 604_800, maxFills: 4 };

check(
  "an untouched order inside its window stays open",
  reconcile(order, state({}), NOW).status === "open",
);
check(
  "an order that used its last fill is filled",
  reconcile(order, state({ fills: 1, lastFillAt: NOW }), NOW).status === "filled",
);
check(
  "a recurring order part way through stays open",
  reconcile(recurring, state({ fills: 2, lastFillAt: NOW }), NOW).status === "open",
);
check(
  "an order past its expiry is expired",
  reconcile(order, state({}), order.expiry + 1).status === "expired",
);
check(
  "cancelled beats filled — the maker did something, and the row should say what",
  reconcile(order, state({ cancelled: true, fills: 1 }), NOW).status === "cancelled",
);
/* A `cancelAll` leaves the struct saying open — see the note on OnChainState. The
   keeper ORs the epoch mismatch into this field, so what is checked here is that
   the field is enough: nothing else in `reconcile` needs to know which route. */
check(
  "a cancelAll'd order reaches cancelled through the same field, with the struct untouched",
  reconcile(recurring, state({ cancelled: true, fills: 0, lastFillAt: 0 }), NOW)
    .status === "cancelled",
);
check(
  "filled beats expired — an order that did its job did not fail to",
  reconcile(order, state({ fills: 1, lastFillAt: NOW }), order.expiry + 1).status ===
    "filled",
);
check(
  "the fill count comes from the chain, not from adding one",
  reconcile(recurring, state({ fills: 3, lastFillAt: NOW }), NOW).fills === 3,
);
check(
  "lastFillAt is null while nothing has filled, never the struct's 0",
  reconcile(recurring, state({ fills: 0 }), NOW).lastFillAt === null,
);
check(
  "and is the chain's timestamp once something has",
  reconcile(recurring, state({ fills: 1, lastFillAt: 1_700_000_000 }), NOW)
    .lastFillAt === 1_700_000_000,
);

/* ------------------------------------------------------------------ 9 -- */
/* sweepable: which rows a cycle looks at. */
const row = (over: Partial<StoredOrder> & { createdAt: string }): StoredOrder => ({
  order,
  signature: "0x00",
  hash: `0x${over.createdAt.length}`,
  chainId: 11155111,
  orders: "0x4444444444444444444444444444444444444444",
  fills: 0,
  lastFillAt: null,
  status: "open",
  ...over,
});

{
  const rows = [
    row({ createdAt: "2026-09-03T00:00:00+00:00" }),
    row({ createdAt: "2026-09-01T00:00:00+00:00" }),
    row({ createdAt: "2026-09-02T00:00:00+00:00" }),
  ];
  const { take, dropped } = sweepable(rows, NOW, 10);
  check(
    "a sweep takes the oldest order first, so a long-standing one is not starved",
    take[0].createdAt === "2026-09-01T00:00:00+00:00" && dropped === 0,
    show(take.map((r) => r.createdAt)),
  );
}
{
  const rows = [
    row({ createdAt: "2026-09-01T00:00:00+00:00", status: "filled" }),
    row({ createdAt: "2026-09-02T00:00:00+00:00", status: "cancelled" }),
    row({ createdAt: "2026-09-03T00:00:00+00:00" }),
  ];
  const { take } = sweepable(rows, NOW, 10);
  check(
    "a row the keeper has already written off is not swept again",
    take.length === 1 && take[0].createdAt === "2026-09-03T00:00:00+00:00",
    show(take.map((r) => r.status)),
  );
}
{
  /* Expired but still `open`, which is the normal state of things: the status
     column is this keeper's cache and nothing writes it until a cycle looks. */
  const stale = row({ createdAt: "2026-09-01T00:00:00+00:00" });
  const { take } = sweepable([stale], order.expiry + 1, 10);
  check(
    "an expired row is skipped even while the cache still says open",
    take.length === 0,
    show(take),
  );
}
{
  const rows = [
    row({ createdAt: "2026-09-01T00:00:00+00:00" }),
    row({ createdAt: "2026-09-02T00:00:00+00:00" }),
    row({ createdAt: "2026-09-03T00:00:00+00:00" }),
  ];
  const { take, dropped } = sweepable(rows, NOW, 2);
  check(
    "the cap reports what it dropped, so a bounded cycle is not read as a complete one",
    take.length === 2 && dropped === 1,
    show({ take: take.length, dropped }),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
