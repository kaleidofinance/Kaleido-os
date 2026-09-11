// Checks on the pure pieces of the KLD candle indexer — the span planner and
// the Swap-log decoder. Run with `npx tsx src/lib/keeper/candleIndex.test.ts`.
//
// The I/O (resolving a pool, scanning logs, upserting) needs a chain and a
// database and is exercised by the dry-run path in production. What is tested
// here is the two places an off-by-one or a bad decode silently loses a swap:
//
//   1. planSpans covers [from, to] exactly — no block scanned twice at a chunk
//      boundary, and none skipped. A skipped block is a swap that never becomes
//      a candle; a doubled one is only harmless because the fold dedupes.
//   2. decodeSwap reads the tick out of a real encoded Swap log, and refuses
//      anything that is not one rather than throwing and losing the whole page.

import { AbiCoder, id, zeroPadValue } from "ethers";
import { decodeSwap, planSpans } from "./candleIndex.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` ${got}`}`);
  }
};

console.log("\n— planSpans covers the range exactly —");
{
  const spans = planSpans(100, 350, 100);
  check("chunks cover from the start", spans[0].start === 100);
  check("to the end, no further", spans[spans.length - 1].end === 350);
  check("each chunk is at most span wide", spans.every((s) => s.end - s.start + 1 <= 100));

  /* The seam that matters: chunk N+1 starts exactly one past chunk N's end.
     One less is a re-read (harmless), one more is a skipped block (a lost
     swap). */
  let contiguous = true;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start !== spans[i - 1].end + 1) contiguous = false;
  }
  check("chunks are contiguous with no gap or overlap", contiguous, JSON.stringify(spans));

  /* And every block in the range lands in exactly one chunk. */
  const covered = new Set<number>();
  for (const { start, end } of spans) for (let b = start; b <= end; b++) covered.add(b);
  let all = true;
  for (let b = 100; b <= 350; b++) if (!covered.has(b)) all = false;
  check("every block is covered once", all && covered.size === 251, String(covered.size));
}

console.log("\n— planSpans edges —");
{
  check("a single block is one chunk", planSpans(42, 42, 1000).length === 1);
  check("a single block chunk is [42,42]", planSpans(42, 42, 1000)[0].end === 42);
  check("to < from is empty", planSpans(200, 100, 10).length === 0);
  check("an exact multiple splits cleanly", planSpans(0, 199, 100).length === 2);
  check("a span wider than the range is one chunk", planSpans(10, 20, 1000).length === 1);
  /* A zero or negative span must not loop forever — it floors to 1. */
  check("a zero span does not hang", planSpans(1, 3, 0).length === 3);
}

console.log("\n— decodeSwap reads the tick, refuses everything else —");
{
  const coder = AbiCoder.defaultAbiCoder();
  const SWAP_TOPIC = id("Swap(address,address,int256,int256,uint160,uint128,int24)");

  /* A real Swap log: two indexed addresses in topics, the five value args in
     data, tick last. */
  const encode = (tick: number) => ({
    topics: [
      SWAP_TOPIC,
      zeroPadValue("0x1111111111111111111111111111111111111111", 32),
      zeroPadValue("0x2222222222222222222222222222222222222222", 32),
    ],
    data: coder.encode(
      ["int256", "int256", "uint160", "uint128", "int24"],
      [-1000, 2000, 79228162514264337593543950336n, 5000, tick],
    ),
    blockNumber: 500,
    logIndex: 3,
  });

  const ok = decodeSwap(encode(-73_500));
  check("a Swap log decodes", ok !== null);
  check("the tick is read, sign intact", ok?.tick === -73_500, String(ok?.tick));
  check("block and logIndex carry through", ok?.blockNumber === 500 && ok?.logIndex === 3);

  const positive = decodeSwap(encode(60_123));
  check("a positive tick too", positive?.tick === 60_123, String(positive?.tick));

  /* A log for some other event — right shape, wrong topic0 — is not a swap. */
  const other = decodeSwap({
    topics: [id("Transfer(address,address,uint256)"), "0x", "0x"],
    data: "0x",
    blockNumber: 1,
    logIndex: 0,
  });
  check("a non-Swap topic is refused", other === null);

  /* Garbage data does not throw, it returns null — one bad log must not lose
     the getLogs page it arrived in. */
  const garbage = decodeSwap({ topics: [SWAP_TOPIC], data: "0xdead", blockNumber: 1, logIndex: 0 });
  check("undecodable data yields null, not a throw", garbage === null);
  const empty = decodeSwap({ topics: [], data: "0x", blockNumber: 1, logIndex: 0 });
  check("an empty topic list yields null", empty === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
