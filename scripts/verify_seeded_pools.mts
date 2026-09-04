/**
 * Reads back, on chain, every pool the deployer recorded opening.
 *
 * Written because the records in `smart-contract/deployment-pool-*.json` are the
 * only evidence behind the verified tick on a pool row, and until this ran, that
 * evidence had never been checked against the chain. A record is what a seeding
 * run *believed*; this is what is actually there.
 *
 * WHAT IT ESTABLISHES, PER POOL
 *
 *   1. bytecode at the recorded address at all;
 *   2. the pool's own `token0`/`token1`/`fee` agree with the record;
 *   3. the factory's canonical pool for that pair and tier IS this one — the
 *      check that matters most, because `createPool` is permissionless and the
 *      app's enumerator finds whatever the factory points at;
 *   4. its live tick and price, against both the tick it opened at and the oracle
 *      price the run seeded it from;
 *   5. both balances, so neither side is empty, and in-range `liquidity()`;
 *   6. each recorded position still exists, holds liquidity, spans the recorded
 *      ticks, and is still held by the address that minted it;
 *   7. its recent Swaps, newest first, which is what explains a pool sitting off
 *      its seed tick — the difference between "has been traded" and "something
 *      moved this pool". Budgeted, and the report says which window it covered;
 *      see `LOG_CALL_BUDGET`;
 *   8. and that the pool is in `SEEDED_POOLS`, so the tick will actually render.
 *
 * READ-ONLY, AND NO KEY. Nothing here signs. Ownership is established by
 * comparing `ownerOf` against the `from` of the mint transaction the record
 * itself names — which needs no secret and proves more than comparing against a
 * key we happen to hold, because it shows the minter has not sold the position.
 *
 * Raw `fetch` JSON-RPC with `ethers.Interface` for coding, rather than
 * `JsonRpcProvider`, which cannot detect the network from this machine. Two of
 * these endpoints return a rate limit as HTTP 200 with a JSON-RPC error, so a
 * failed call rotates endpoints instead of being reported as a missing pool, and
 * `eth_getLogs` ranges shrink on a range complaint rather than giving up (the
 * ceiling is per-endpoint — thirdweb Sepolia caps at 1000 blocks).
 *
 *   npm run verify:pools            every recorded pool
 *   npm run verify:pools -- WETH    only records whose filename matches
 */
import { readdirSync, readFileSync } from "node:fs";

import { Interface, getAddress, type Result } from "ethers";

import { CHAINS_BY_ID } from "../src/constants/chains";
import { getContracts, isSeededPool } from "../src/constants/registry";

const DIR = "smart-contract";

interface PoolRecord {
  file: string;
  network: string;
  chainId: number;
  pool: string;
  fee: number;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  openedAt: { sqrtPriceX96: string; tick: number; liveTick: number };
  oracle: { usd0: string; usd1: string };
  positions: {
    label: string;
    tickLower: number;
    tickUpper: number;
    tokenId: string;
    tx: string;
  }[];
}

const POOL = new Interface([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 oi, uint16 oc, uint16 ocn, uint8 feeProtocol, bool unlocked)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
const FACTORY = new Interface([
  "function getPool(address,address,uint24) view returns (address)",
]);
const ERC20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const NPM = new Interface([
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 fg0, uint256 fg1, uint128 owed0, uint128 owed1)",
]);
const SWAP_TOPIC = POOL.getEvent("Swap")!.topicHash;

/* ------------------------------------------------------------------ rpc -- */

let calls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thrown for "you asked for too many blocks", which the caller answers by
    asking for fewer rather than by trying another endpoint. */
class TooWide extends Error {}

async function rpc(
  urls: string[],
  method: string,
  params: unknown[],
): Promise<unknown> {
  let last = "";
  for (let attempt = 0; attempt < urls.length * 2; attempt++) {
    const url = urls[attempt % urls.length];
    try {
      calls++;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: calls, method, params }),
      });
      const body = (await res.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };
      if (body.error) {
        last = `${body.error.code} ${body.error.message}`;
        if (/range|too many|limit exceeded/i.test(last))
          throw new TooWide(last);
        await sleep(600 * (attempt + 1));
        continue;
      }
      return body.result;
    } catch (e) {
      if (e instanceof TooWide) throw e;
      last = String(e instanceof Error ? e.message : e);
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error(`${method} failed on every endpoint: ${last}`);
}

async function call(
  urls: string[],
  to: string,
  iface: Interface,
  fn: string,
  args: unknown[] = [],
): Promise<Result> {
  const data = (await rpc(urls, "eth_call", [
    { to, data: iface.encodeFunctionData(fn, args) },
    "latest",
  ])) as string;
  return iface.decodeFunctionResult(fn, data);
}

interface RawLog {
  data: string;
  topics: string[];
  blockNumber: string;
  transactionHash: string;
}

interface SwapScan {
  logs: RawLog[];
  /** Oldest block actually covered. Above `from` when the budget ran out. */
  scannedFrom: number;
  complete: boolean;
}

/**
 * How many `eth_getLogs` calls one pool's history is allowed to cost.
 *
 * There has to be a ceiling. "Every block since the first mint" is a few chunks
 * for a pool opened today and unbounded for one opened three weeks ago on a
 * 0.75s chain — BSC testnet alone is millions of blocks, and the first run of
 * this script sat on that one pool until it was killed. A budget turns the scan
 * from unbounded into a window, which is why the report says which window it
 * covered instead of implying it saw everything.
 */
const LOG_CALL_BUDGET = 40;

/**
 * Swaps, newest first, walking BACKWARD from the head.
 *
 * Backward because the budget can run out and the recent end is the half worth
 * having: a pool sitting off its seed tick got there from its most recent swap,
 * and a pool nobody has touched lately is one whose last activity is the thing
 * to report. Forward-scanning would spend the budget on the empty weeks after
 * the mint and stop before reaching anything.
 */
async function swapLogs(
  urls: string[],
  address: string,
  from: number,
  to: number,
): Promise<SwapScan> {
  const out: RawLog[] = [];
  let cursor = to;
  let width = 9000;
  let spent = 0;

  while (cursor >= from) {
    if (spent >= LOG_CALL_BUDGET) {
      return { logs: out, scannedFrom: cursor + 1, complete: false };
    }
    const start = Math.max(cursor - width + 1, from);
    try {
      spent++;
      const got = (await rpc(urls, "eth_getLogs", [
        {
          address,
          topics: [SWAP_TOPIC],
          fromBlock: "0x" + start.toString(16),
          toBlock: "0x" + cursor.toString(16),
        },
      ])) as RawLog[];
      /* Each window is older than the last, so prepending keeps the whole list
         in block order. */
      out.unshift(...got);
      cursor = start - 1;
    } catch (e) {
      if (e instanceof TooWide && width > 200) {
        width = Math.floor(width / 5);
        continue;
      }
      throw e;
    }
  }
  return { logs: out, scannedFrom: from, complete: true };
}

/* --------------------------------------------------------------- maths -- */

const Q192 = 2n ** 192n;
const WAD = 10n ** 18n;

/** token1 per token0, in display units. Integer-scaled before the one division
    that becomes a float, because sqrtPriceX96 squared is far past 2^53. */
function priceFromSqrt(sqrt: bigint, dec0: number, dec1: number): number {
  return (
    Number(
      (sqrt * sqrt * 10n ** BigInt(dec0) * WAD) / (Q192 * 10n ** BigInt(dec1)),
    ) / 1e18
  );
}

const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
const fmt = (n: number, dp = 4) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const addrFromTopic = (t: string) => getAddress("0x" + t.slice(26));

/* --------------------------------------------------------------- report -- */

const problems: string[] = [];

async function verify(rec: PoolRecord) {
  const pair = `${rec.token0.symbol}/${rec.token1.symbol}`;
  const note = (msg: string) => problems.push(`${rec.network} ${pair}: ${msg}`);

  const urls = CHAINS_BY_ID[rec.chainId]?.rpcUrls ?? [];
  const c = getContracts(rec.chainId);

  console.log(
    `\n=== ${rec.network} (${rec.chainId})  ${pair} ${rec.fee / 10000}% ===`,
  );
  console.log(`    record    ${rec.file}`);
  console.log(`    pool      ${rec.pool}`);

  if (urls.length === 0) {
    note("no RPC URL in chains.ts");
    return;
  }

  /* 1. deployed at all. */
  const code = (await rpc(urls, "eth_getCode", [rec.pool, "latest"])) as string;
  const bytes = (code.length - 2) / 2;
  if (bytes === 0) {
    console.log("    code      NONE — nothing deployed at this address");
    note("no bytecode at the recorded pool address");
    return;
  }
  console.log(`    code      ${bytes} bytes`);

  /* 2. the pool the record says it is. */
  const [t0] = await call(urls, rec.pool, POOL, "token0");
  const [t1] = await call(urls, rec.pool, POOL, "token1");
  const [fee] = await call(urls, rec.pool, POOL, "fee");
  const idOk =
    String(t0).toLowerCase() === rec.token0.address.toLowerCase() &&
    String(t1).toLowerCase() === rec.token1.address.toLowerCase() &&
    Number(fee) === rec.fee;
  console.log(
    `    identity  ${idOk ? "matches the record" : `MISMATCH on chain: ${short(String(t0))}/${short(String(t1))} @ ${Number(fee)}`}`,
  );
  if (!idOk) note("the pool's own token0/token1/fee disagree with the record");

  /* 3. and the one the factory hands out, which is the one the app will find. */
  if (!c.v3Factory) {
    note("no v3Factory recorded for this chain");
  } else {
    const [canonical] = await call(urls, c.v3Factory, FACTORY, "getPool", [
      rec.token0.address,
      rec.token1.address,
      rec.fee,
    ]);
    const canonicalOk =
      String(canonical).toLowerCase() === rec.pool.toLowerCase();
    console.log(
      `    factory   ${canonicalOk ? "this is the canonical pool for the pair+tier" : `points at ${canonical} instead`}`,
    );
    if (!canonicalOk)
      note(`factory.getPool returns ${canonical}, not the recorded pool`);
  }

  /* 4. price now, against the seed. Oriented so the figure reads in the quote
        token per the volatile one, whichever side of the pair that landed on. */
  const s0 = await call(urls, rec.pool, POOL, "slot0");
  const tick = Number(s0[1]);
  const price = priceFromSqrt(
    BigInt(s0[0] as bigint),
    rec.token0.decimals,
    rec.token1.decimals,
  );
  const openPrice = priceFromSqrt(
    BigInt(rec.openedAt.sqrtPriceX96),
    rec.token0.decimals,
    rec.token1.decimals,
  );
  const quoteIs1 = /^(USDC|USDT|kfUSD|USDe)$/.test(rec.token1.symbol);
  const base = quoteIs1 ? rec.token0.symbol : rec.token1.symbol;
  const quote = quoteIs1 ? rec.token1.symbol : rec.token0.symbol;
  const now = quoteIs1 ? price : 1 / price;
  const then = quoteIs1 ? openPrice : 1 / openPrice;

  const drift = 1.0001 ** (tick - rec.openedAt.tick) - 1;
  console.log(
    `    tick      ${tick} live vs ${rec.openedAt.tick} at open (${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(3)}% on token1/token0)`,
  );
  console.log(
    `    price     ${fmt(now, 4)} ${quote} per ${base}, opened at ${fmt(then, 4)}`,
  );

  /* The oracle price the run seeded from, so a mis-seed shows up as a pool that
     never moved and still disagrees with what the asset was worth. */
  const oracleUsd =
    Number(BigInt(quoteIs1 ? rec.oracle.usd0 : rec.oracle.usd1)) / 1e18;
  if (oracleUsd > 0) {
    const seedErr = then / oracleUsd - 1;
    console.log(
      `    oracle    ${fmt(oracleUsd, 4)} USD for ${base} at seed time (opened ${(seedErr * 100).toFixed(3)}% off it)`,
    );
    if (Math.abs(seedErr) > 0.01)
      note(
        `opened ${(seedErr * 100).toFixed(2)}% away from the oracle price it was seeded from`,
      );
  }

  /* 5. what it holds. Decimals are re-read rather than trusted: a wrong one is a
        factor of 1e12 on every figure below. */
  const [b0] = await call(urls, rec.token0.address, ERC20, "balanceOf", [
    rec.pool,
  ]);
  const [b1] = await call(urls, rec.token1.address, ERC20, "balanceOf", [
    rec.pool,
  ]);
  const [dec0] = await call(urls, rec.token0.address, ERC20, "decimals");
  const [dec1] = await call(urls, rec.token1.address, ERC20, "decimals");
  if (
    Number(dec0) !== rec.token0.decimals ||
    Number(dec1) !== rec.token1.decimals
  )
    note(
      `decimals on chain are ${Number(dec0)}/${Number(dec1)}, record says ${rec.token0.decimals}/${rec.token1.decimals}`,
    );

  const a0 = units(BigInt(b0 as bigint), Number(dec0));
  const a1 = units(BigInt(b1 as bigint), Number(dec1));
  console.log(
    `    holds     ${fmt(a0, 6)} ${rec.token0.symbol} + ${fmt(a1, 6)} ${rec.token1.symbol}`,
  );
  if (a0 === 0 || a1 === 0) note("one side of the pool is empty");

  const [liq] = await call(urls, rec.pool, POOL, "liquidity");
  console.log(`    liquidity ${String(liq)} in range at the current tick`);
  if (BigInt(liq as bigint) === 0n)
    note("no liquidity is in range at the current tick");

  /* 6. the positions, and whether they are still ours. */
  let firstMintBlock: number | null = null;
  if (!c.v3PositionManager) {
    note("no v3PositionManager recorded for this chain");
  } else {
    for (const p of rec.positions) {
      const pos = await call(urls, c.v3PositionManager, NPM, "positions", [
        p.tokenId,
      ]);
      const [owner] = await call(urls, c.v3PositionManager, NPM, "ownerOf", [
        p.tokenId,
      ]);
      const tx = (await rpc(urls, "eth_getTransactionByHash", [p.tx])) as {
        from?: string;
      } | null;
      const receipt = (await rpc(urls, "eth_getTransactionReceipt", [
        p.tx,
      ])) as {
        status?: string;
        blockNumber?: string;
      } | null;
      if (receipt?.blockNumber) {
        const b = Number(BigInt(receipt.blockNumber));
        firstMintBlock =
          firstMintBlock === null ? b : Math.min(firstMintBlock, b);
      }

      const posLiq = BigInt(pos[7] as bigint);
      const rangeOk =
        Number(pos[5]) === p.tickLower && Number(pos[6]) === p.tickUpper;
      const pairOk =
        String(pos[2]).toLowerCase() === rec.token0.address.toLowerCase() &&
        String(pos[3]).toLowerCase() === rec.token1.address.toLowerCase() &&
        Number(pos[4]) === rec.fee;
      const minter = tx?.from ?? null;
      const held =
        minter !== null && String(owner).toLowerCase() === minter.toLowerCase();

      console.log(
        `    #${p.tokenId} ${p.label.padEnd(11)} liq ${String(posLiq).padEnd(22)} ticks ${rangeOk ? "as recorded" : `${Number(pos[5])}..${Number(pos[6])} NOT as recorded`}`,
      );
      console.log(
        `         pair ${pairOk ? "matches" : "MISMATCH"} · mint ${receipt?.status === "0x1" ? "succeeded" : `status ${receipt?.status ?? "not found"}`} · ${held ? `still held by its minter ${short(String(owner))}` : `owner ${short(String(owner))} is NOT the minter ${minter ? short(minter) : "unknown"}`}`,
      );

      if (posLiq === 0n) note(`position #${p.tokenId} holds no liquidity`);
      if (!rangeOk)
        note(`position #${p.tokenId} range differs from the record`);
      if (!pairOk) note(`position #${p.tokenId} is on a different pair`);
      if (receipt?.status !== "0x1")
        note(`mint tx for #${p.tokenId} is not a successful receipt`);
      if (!held) note(`position #${p.tokenId} left its minter`);
    }
  }

  /* 7. swaps, newest first. A pool cannot have been swapped before it held
        liquidity, so the first mint is the oldest block worth asking about — but
        the scan is budgeted, so the report states the window it actually covered
        rather than letting a partial answer read as a complete one. */
  if (firstMintBlock === null) {
    console.log("    swaps     range unknown (no mint receipt), not scanned");
  } else {
    const head = Number(
      BigInt((await rpc(urls, "eth_blockNumber", [])) as string),
    );
    try {
      const scan = await swapLogs(urls, rec.pool, firstMintBlock, head);
      const window = scan.complete
        ? `all ${head - firstMintBlock} blocks since the first mint`
        : `the last ${head - scan.scannedFrom} of ${head - firstMintBlock} blocks since the first mint`;
      console.log(`    swaps     ${scan.logs.length} in ${window}`);
      /* An unexplained tick is the one case where a partial scan is not good
         enough: the pool moved, and the swap that moved it may be older than the
         window. Say so rather than leaving the drift unaccounted for. */
      if (
        !scan.complete &&
        tick !== rec.openedAt.tick &&
        scan.logs.length === 0
      )
        note(
          `sits ${(drift * 100).toFixed(3)}% off its seed tick with no swap in the ${head - scan.scannedFrom} blocks scanned — widen LOG_CALL_BUDGET to find what moved it`,
        );
      for (const log of scan.logs) {
        const ev = POOL.decodeEventLog("Swap", log.data, log.topics);
        const d0 = units(BigInt(ev.amount0), Number(dec0));
        const d1 = units(BigInt(ev.amount1), Number(dec1));
        /* Signed from the pool's side: positive in, negative out. */
        const inLeg =
          d0 > 0
            ? `${fmt(d0, 6)} ${rec.token0.symbol}`
            : `${fmt(d1, 6)} ${rec.token1.symbol}`;
        const outLeg =
          d0 < 0
            ? `${fmt(-d0, 6)} ${rec.token0.symbol}`
            : `${fmt(-d1, 6)} ${rec.token1.symbol}`;
        const baseAmt = Math.abs(quoteIs1 ? d0 : d1);
        const quoteAmt = Math.abs(quoteIs1 ? d1 : d0);
        console.log(
          `         block ${Number(BigInt(log.blockNumber))}: ${inLeg} in → ${outLeg} out @ ${baseAmt === 0 ? "n/a" : fmt(quoteAmt / baseAmt, 2)} ${quote} per ${base}`,
        );
        console.log(
          `             via ${short(addrFromTopic(log.topics[1]))}${c.v3Router && addrFromTopic(log.topics[1]).toLowerCase() === c.v3Router.toLowerCase() ? " (our V3 router)" : ""} → ${short(addrFromTopic(log.topics[2]))} · tick now ${Number(ev.tick)}`,
        );
      }
    } catch (e) {
      console.log(
        `    swaps     scan failed — ${e instanceof Error ? e.message : String(e)}`,
      );
      note("swap history could not be read");
    }
  }

  /* 8. and whether the app will tick it. */
  const ticked = isSeededPool(rec.chainId, rec.pool);
  console.log(
    `    badge     ${ticked ? "in SEEDED_POOLS — the verified tick renders" : "NOT in SEEDED_POOLS — no tick"}`,
  );
  if (!ticked)
    note("absent from SEEDED_POOLS, so the verified tick will not render");
}

async function main() {
  const filter = process.argv[2] ?? "";
  const files = readdirSync(DIR)
    .filter(
      (f) =>
        f.startsWith("deployment-pool-") &&
        f.endsWith(".json") &&
        f.includes(filter),
    )
    .sort();

  if (files.length === 0) {
    console.log(
      `No pool records in ${DIR} matching ${JSON.stringify(filter)}.`,
    );
    process.exit(1);
  }

  console.log(
    `${files.length} pool record(s) to verify${filter ? ` matching ${JSON.stringify(filter)}` : ""}`,
  );

  for (const f of files) {
    const rec: PoolRecord = {
      ...(JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as Omit<
        PoolRecord,
        "file"
      >),
      file: f,
    };
    try {
      await verify(rec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`    ERROR     ${msg}`);
      problems.push(
        `${rec.network} ${rec.token0.symbol}/${rec.token1.symbol}: probe failed: ${msg}`,
      );
    }
  }

  console.log(`\n\n===== ${problems.length} problem(s) =====`);
  for (const p of problems) console.log(`  - ${p}`);
  if (problems.length === 0)
    console.log(
      "  none — every record checked is on chain, is the factory's canonical pool\n" +
        "  for its pair and tier, holds both sides with liquidity in range, and its\n" +
        "  positions are still held by the address that minted them.",
    );
  console.log(`\n(${calls} RPC calls)`);
  process.exit(problems.length === 0 ? 0 : 1);
}

void main();
