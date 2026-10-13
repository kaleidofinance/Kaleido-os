// The liquidation keeper's loop, driven with fakes: no chain, no key. What these
// protect: only overdue or unhealthy loans are considered; the CONTRACT decides
// (a refused simulation is never sent); a dry run sends nothing; the per-chain
// limit holds; a keeper that cannot pay stops that chain without failing the
// others; and no keeper key means nothing runs at all.
//
//   npm run test:liquidator

import {
  candidates,
  runLiquidations,
  HEALTH_ONE,
  NO_DEBT,
  type ChainBook,
  type LiquidatorDeps,
  type Loan,
  type SendOutcome,
  type Simulation,
} from "./liquidator.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const L = "0x9999999999999999999999999999999999999999";
const NOW = 1_800_000_000n;

const loan = (id: number, author: string, returnDate: bigint, owed = 10n ** 18n): Loan => ({
  requestId: BigInt(id),
  author,
  lender: L,
  returnDate,
  totalRepayment: owed,
});
const book = (loans: Loan[], health: Record<string, bigint>): ChainBook => ({
  now: NOW,
  loans,
  health: new Map(Object.entries(health).map(([k, v]) => [k.toLowerCase(), v])),
});

function fakeDeps(over: {
  books?: Record<number, ChainBook | { error: string }>;
  simulate?: (chainId: number, id: bigint) => Simulation;
  send?: (chainId: number, id: bigint) => SendOutcome;
  keeper?: string | null;
}) {
  const sent: string[] = [];
  const simulated: string[] = [];
  const deps: LiquidatorDeps = {
    keeperAddress: () => (over.keeper === undefined ? "0xB37d079F6AccE50332043cf20e1f4FFD363799aE" : over.keeper),
    readBook: async (chainId) => over.books?.[chainId] ?? { error: "no book" },
    simulate: async (chainId, id) => {
      simulated.push(`${chainId}:${id}`);
      return over.simulate ? over.simulate(chainId, id) : { ok: true };
    },
    send: async (chainId, id) => {
      sent.push(`${chainId}:${id}`);
      return over.send ? over.send(chainId, id) : { hash: `0xhash${id}` };
    },
    rewards: async () => ({ "0xcollateral": "42" }),
  };
  return { deps, sent, simulated };
}

async function run() {
  console.log("candidates()");
  {
    const b = book(
      [
        loan(1, A, NOW + 86400n), // healthy, not due
        loan(2, B, NOW - 1n), // overdue, healthy
        loan(3, C, NOW + 86400n), // HF 0.9
        loan(4, A, NOW - 10n, 0n), // already settled (nothing owed)
      ],
      { [A]: 2n * HEALTH_ONE, [B]: 3n * HEALTH_ONE, [C]: (HEALTH_ONE * 9n) / 10n },
    );
    const c = candidates(b);
    check("only the overdue loan and the unhealthy one", c.map((x) => Number(x.requestId)).join(",") === "2,3",
      c.map((x) => x.requestId).join(","));
    check("overdue comes first", c[0].overdue === true && c[1].overdue === false);
  }
  {
    const b = book([loan(1, A, NOW + 1n)], { [A]: NO_DEBT });
    check("the no-debt sentinel is healthy, not a huge-but-valid number", candidates(b).length === 0);
  }
  {
    const b = book([loan(1, A, NOW + 1n), loan(2, B, NOW - 5n)], {});
    const c = candidates(b);
    check("an unreadable health factor alone never qualifies; overdue still does",
      c.length === 1 && Number(c[0].requestId) === 2);
  }
  {
    const b = book(
      [loan(1, A, NOW + 9n), loan(2, B, NOW + 9n)],
      { [A]: (HEALTH_ONE * 95n) / 100n, [B]: (HEALTH_ONE * 50n) / 100n },
    );
    check("among unhealthy loans, the lowest health factor first",
      Number(candidates(b)[0].requestId) === 2);
  }
  check("exactly at the return date is not overdue", candidates(book([loan(1, A, NOW)], { [A]: 2n * HEALTH_ONE })).length === 0);

  console.log("\nrunLiquidations()");
  {
    const { deps, sent } = fakeDeps({ books: { 1: book([loan(7, B, NOW - 1n)], { [B]: 2n * HEALTH_ONE }) } });
    const r = await runLiquidations({ chainIds: [1] }, deps);
    check("an overdue loan is liquidated", r.liquidated === 1 && sent.join() === "1:7", JSON.stringify(r.chains[0]));
    check("the reward ledger is reported after a liquidation", r.chains[0].rewards?.["0xcollateral"] === "42");
  }
  {
    const { deps, sent, simulated } = fakeDeps({
      books: { 1: book([loan(7, B, NOW - 1n)], {}) },
      simulate: () => ({ ok: false, reason: "Protocol__PositionHealthy" }),
    });
    const r = await runLiquidations({ chainIds: [1] }, deps);
    check("a candidate the contract refuses is simulated but never sent",
      simulated.length === 1 && sent.length === 0 && r.chains[0].skipped[0]?.reason === "Protocol__PositionHealthy");
  }
  {
    const { deps, sent } = fakeDeps({ books: { 1: book([loan(7, B, NOW - 1n)], {}) } });
    const r = await runLiquidations({ chainIds: [1], dryRun: true }, deps);
    check("a dry run sends nothing and reports what it would do",
      sent.length === 0 && r.wouldLiquidate === 1 && r.liquidated === 0);
  }
  {
    const loans = Array.from({ length: 9 }, (_, i) => loan(i + 1, B, NOW - 1n));
    const { deps, sent } = fakeDeps({ books: { 1: book(loans, {}) } });
    const r = await runLiquidations({ chainIds: [1], limit: 3 }, deps);
    check("the per-chain limit holds", sent.length === 3 && r.liquidated === 3);
  }
  {
    const { deps, sent } = fakeDeps({
      books: { 1: book([loan(1, B, NOW - 1n), loan(2, C, NOW - 1n)], {}), 2: book([loan(5, A, NOW - 1n)], {}) },
      send: (chainId) => (chainId === 1 ? { skipped: "keeper gas too low" } : { hash: "0xok" }),
    });
    const r = await runLiquidations({ chainIds: [1, 2] }, deps);
    const c1 = r.chains.find((c) => c.chainId === 1)!;
    check("a keeper that cannot pay stops that chain after one attempt",
      sent.filter((s) => s.startsWith("1:")).length === 1 && c1.skipped.length === 1);
    check("and the other chain still runs", r.chains.find((c) => c.chainId === 2)!.liquidated.length === 1);
  }
  {
    const { deps } = fakeDeps({
      books: { 1: { error: "rpc down" }, 2: book([loan(5, A, NOW - 1n)], {}) },
    });
    const r = await runLiquidations({ chainIds: [1, 2] }, deps);
    check("one chain's read error is reported, the others still liquidate",
      !r.ok && r.chains[0].status === "error" && r.liquidated === 1);
  }
  {
    const { deps, sent } = fakeDeps({
      books: { 1: book([loan(1, B, NOW - 1n), loan(2, C, NOW - 1n)], {}) },
      send: (_c, id) => (id === 1n ? { error: "nonce too low" } : { hash: "0xok" }),
    });
    const r = await runLiquidations({ chainIds: [1] }, deps);
    check("a failed send is reported and the next candidate is still tried",
      r.failed === 1 && r.liquidated === 1 && sent.length === 2);
  }
  {
    // A clock that advances 15s per send: with a 40s budget, the 4th candidate is deferred.
    let t = 0;
    const loans = Array.from({ length: 6 }, (_, i) => loan(i + 1, B, NOW - 1n));
    const { deps, sent } = fakeDeps({
      books: { 1: book(loans, {}) },
      send: () => {
        t += 15_000;
        return { hash: "0xok" };
      },
    });
    const r = await runLiquidations({ chainIds: [1], limit: 25, budgetMs: 40_000, now: () => t }, deps);
    check("the time budget stops new sends and reports the rest as deferred",
      sent.length === 3 && r.chains[0].deferred === 3, `sent ${sent.length}, deferred ${r.chains[0].deferred}`);
  }
  {
    const { deps, sent } = fakeDeps({ keeper: null, books: { 1: book([loan(1, B, NOW - 1n)], {}) } });
    const r = await runLiquidations({ chainIds: [1] }, deps);
    check("no keeper key (or an owner key) — nothing runs", !r.ok && sent.length === 0 && /refusing/.test(r.error ?? ""));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
