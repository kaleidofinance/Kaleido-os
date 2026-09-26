import { ethers } from "ethers";
import { swapFeeReceiver } from "@/lib/swap/kyberswapServer";
import { kyberSwapRouter } from "@/lib/swap/kyberswap";
import { getContracts } from "@/constants/registry";
import { GENERATED_SEEDED_POOLS } from "@/constants/deployments.generated";
import { providerForChain } from "@/config/provider";
import { planSpans } from "@/lib/keeper/candleIndex";
import { retryRpc } from "@/lib/dex/rpcRetry";
import {
  TRANSFER_TOPIC,
  decodeTransferLog,
  parseSwapInput,
  classifySwap,
  userOpSenders,
  usdcLegValue,
} from "@/lib/points/swapCollector";
import { dexTokenPrices } from "@/lib/swap/dexPrices";
import { creditAction } from "@/lib/points/credit";
import { recordSwapVolume } from "@/lib/points/swapLedger";
import {
  backfillNextFrom,
  computeCursorAdvance,
  parseBackfillParams,
} from "@/lib/points/swapCursor";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { ARGUS_V4 } from "@/lib/argus/addresses";

const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

/**
 * Credits Season-1 `swap` points for Arc-mainnet swaps, by indexing the 0.2% fee
 * our swaps pay.
 *
 * Every swap sends its fee — a transfer of the OUTPUT token — to
 * `SWAP_FEE_RECEIVER`. This scans a recent window of transfers TO that wallet,
 * and for each one that came from a KyberSwap-router transaction (the fee wallet
 * is shared with the bridge, so that check is what tells a swap from a bridge
 * fee — see swapCollector), credits the transaction's sender for the USD value of
 * their input leg. Idempotent on the tx hash, so overlapping windows and re-runs
 * never double-credit; there is no cursor to keep because the credit itself is the
 * checkpoint.
 *
 * VALUATION: a trade is worth its USDC leg — the USDC the wallet moved, on
 * whichever side it sits (USDC is the Arc quote asset, so almost every trade has
 * one and it IS the dollar size, no price needed). A token↔token swap with no
 * USDC leg is priced from its input token via the DEX (dexTokenPrices), so every
 * swap credits, not just USDC-input ones. Only a token the DEX cannot route or
 * whose decimals cannot be read is skipped — never guessed.
 *
 * Armed the same way the other crons are: a Cloudflare Worker calls it with
 * `Authorization: Bearer $CRON_SECRET`. With no CRON_SECRET, and with no
 * SWAP_FEE_RECEIVER, it stays inert — no auth, no data source, no credits.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ARC = 5042;
const SEASON = 1;
/** Arc USDC — the 6-dec ERC20 face of the native gas token (see registry). */
const USDC = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;
/** Arc's wrapped-native (0x8c6c) is an 18-dec WETH9 wrapper of native USDC. */
const WRAPPED_NATIVE_DECIMALS = 18;
/**
 * Our own Arc V3 pools. A trade our pool quotes better than KyberSwap executes
 * directly against one of these and pays NO 0.2% fee, so the fee-transfer scan
 * below never sees it. We ALSO scan these pools' own `Swap` events, so every
 * swap credits and counts toward volume — not only fee-paying aggregator routes.
 * (User-created pools beyond the seeded set would need factory enumeration; the
 * seeded set is where Arc's liquidity — and thus real volume — sits today.)
 */
const NATIVE_POOLS = (GENERATED_SEEDED_POOLS[ARC] ?? []).map((a) =>
  a.toLowerCase(),
);
/** V3 `Swap(sender,recipient,amount0,amount1,sqrtPriceX96,liquidity,tick)`. */
const V3_SWAP_TOPIC = ethers.id(
  "Swap(address,address,int256,int256,uint160,uint128,int24)",
);
/** Blocks back from head to scan each run. Overlap is safe (idempotent), and this
 *  comfortably covers a fifteen-minute cron at Arc's block time. A few blocks of
 *  head are left off for reorg safety. */
const WINDOW_BLOCKS = Number(process.env.POINTS_SWAP_WINDOW ?? 10_000);
const REORG_MARGIN = 5;
/**
 * Blocks per getLogs. Arc's RPC refuses a large range (-32012 at 10k) and rate-
 * limits (-32005), so the window is scanned in chunks this wide with a pace
 * between them — the same span/rate-limit fight candleIndex documents. 1000 is a
 * safe default under Arc's ceiling; raise via env if the endpoint allows more.
 */
const SPAN = Number(process.env.POINTS_SWAP_SPAN ?? 1_000);
/** Pace between RPC calls, so a run does not trip Arc's rate limiter. */
const DELAY_MS = Number(process.env.POINTS_SWAP_DELAY_MS ?? 200);
/** Cap on transactions processed per run — bounds RPC load and keeps a paced run
 *  inside the 60s budget. Overlapping windows are idempotent, so anything over the
 *  cap is picked up next run; raise via env if a window ever carries more swaps. */
const MAX_TXS = Number(process.env.POINTS_SWAP_MAX_TXS ?? 500);

/**
 * Blocks scanned per run, bounding the getLogs work inside the 60s budget. The
 * persistent cursor (points_swap_cursor) means this NO LONGER bounds coverage —
 * a run that cannot reach `head` leaves the rest for the next run, so nothing is
 * missed however far behind the cursor is; this only caps one run's RPC load.
 */
const MAX_BLOCKS_PER_RUN = Number(
  process.env.POINTS_SWAP_MAX_BLOCKS ?? WINDOW_BLOCKS,
);

const ARC_CHAIN_ID = ARC;

/**
 * The indexer's resume point. Fail-OPEN: if the cursor row (or its table) can't
 * be read, fall back to the legacy "last WINDOW_BLOCKS" window so a missing
 * migration or a DB hiccup never stops crediting — it just can't advance a
 * cursor that run. Returns null when no cursor exists yet (bootstrap).
 */
async function readCursor(): Promise<number | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("points_swap_cursor")
    .select("last_block")
    .eq("chain_id", ARC_CHAIN_ID)
    .maybeSingle();
  if (error || !data) return null;
  const n = Number(data.last_block);
  return Number.isFinite(n) ? n : null;
}

/** Persist how far this run fully drained. Best-effort: a write error just means
 *  the next run re-scans the same range, which is idempotent. */
async function writeCursor(lastBlock: number): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("points_swap_cursor")
    .upsert(
      { chain_id: ARC_CHAIN_ID, last_block: lastBlock, updated_at: new Date().toISOString() },
      { onConflict: "chain_id" },
    );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ERC-20 decimals, cached per run — needed only to value a token↔token swap's
 *  input leg (the common USDC-paired trade is valued from its USDC leg, no read).
 *  A token whose decimals cannot be read is treated as unpriceable, not guessed. */
const decimalsCache = new Map<string, number>();
async function tokenDecimals(
  provider: ethers.Provider,
  token: string,
): Promise<number | null> {
  const key = token.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const c = new ethers.Contract(token, ERC20_DECIMALS_ABI, provider);
    const d = Number(await retryRpc(() => c.decimals()));
    if (!Number.isInteger(d) || d < 0 || d > 36) return null;
    decimalsCache.set(key, d);
    return d;
  } catch {
    return null;
  }
}

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get("x-cron-secret") === secret;
}

async function handle(req: Request): Promise<Response> {
  // Trimmed: the bearer we compare against is trimmed too, and a Vercel env var
  // pasted with a trailing newline would otherwise never match — a phantom 401.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "not enabled" }, { status: 503 });
  if (!authorised(req, secret))
    return Response.json({ error: "unauthorised" }, { status: 401 });

  const receiver = swapFeeReceiver();
  if (!receiver)
    return Response.json({ skipped: "fee-not-armed", credited: 0 });
  const router = kyberSwapRouter(ARC);
  const provider = providerForChain(ARC);
  if (!router || !provider)
    return Response.json({ skipped: "no-router-or-provider", credited: 0 });
  /* Our own v3 router — a venue (so a direct pool trade is recognised) and, being
     a venue, never a credit candidate. Empty string is harmless: parseSwapInput
     lower-cases and drops falsy venue entries. */
  const v3Router = (getContracts(ARC).v3Router ?? "").toLowerCase();
  /* Wrapped-native (0x8c6c): the $1 leg our pools are quoted in — see the
     valuation note below. Empty string disables the 1:1 shortcut harmlessly. */
  const WRAPPED_NATIVE = (getContracts(ARC).wrappedNative ?? "").toLowerCase();

  let scanned = 0;
  let credited = 0;
  /* Swaps written to the volume ledger — every one the indexer can value, below
     the points floor included. Counted apart from `credited` (points). */
  let recorded = 0;
  const skips: Record<string, number> = {};
  const bump = (r: string) => (skips[r] = (skips[r] ?? 0) + 1);

  /* BACKFILL MODE. The live run only moves forward from its cursor, so a direct
     native-pool trade from before this scan learned to read pool Swap events
     (#445) sits behind the cursor and was never credited or counted toward
     volume. `?backfillFrom=&backfillTo=` re-scans an explicit historical range
     for our pools ONLY — the fee-transfer history was already covered by the
     cursor — through the exact per-transaction path below, and never reads or
     writes the cursor. `dryRun=1` values every trade but credits none, so a
     backfill is previewed before it writes. Credits are idempotent on the tx
     hash, so overlapping the live run or re-running double-counts nothing. */
  const bf = parseBackfillParams(new URL(req.url).searchParams);
  if (bf.mode === "invalid")
    return Response.json({ error: bf.error }, { status: 400 });
  const backfill = bf.mode === "backfill" ? bf : null;
  const dryRun = backfill?.dryRun ?? false;
  const wouldCredit: {
    txHash: string;
    wallet: string;
    usdValue: number;
    occurredAt: string;
    venue: string;
    feePaid: boolean;
  }[] = [];

  const cursor = backfill ? null : await readCursor();
  // Write the cursor whenever we have a client — even on the bootstrap run, so
  // subsequent runs resume from where this one stopped. With no client at all we
  // stay in the pure legacy window and never checkpoint.
  const usingCursor = !backfill && !!supabaseAdmin;
  let advancedTo: number | null = null;

  try {
    const head = (await retryRpc(() => provider.getBlockNumber())) - REORG_MARGIN;
    // Resume from the cursor; bootstrap (no cursor) or a fail-open read falls
    // back to the legacy WINDOW_BLOCKS lookback for this one run.
    const fromBlock = backfill
      ? backfill.from
      : cursor !== null
        ? Math.max(0, cursor + 1)
        : Math.max(0, head - WINDOW_BLOCKS);
    // Bound one run's block span; the cursor (or, backfilling, `nextFrom`)
    // carries any remainder to the next run, so this caps RPC load without ever
    // capping coverage.
    const scanTo = Math.min(
      head,
      backfill ? backfill.to : Number.MAX_SAFE_INTEGER,
      fromBlock + MAX_BLOCKS_PER_RUN - 1,
    );
    if (scanTo < fromBlock) {
      if (backfill)
        return Response.json({
          mode: "backfill",
          dryRun,
          scanned: 0,
          credited: 0,
          skips,
          fromBlock,
          drainedTo: null,
          nextFrom: null,
          head,
        });
      // Cursor is already at head — nothing new since the last run.
      return Response.json({
        scanned: 0,
        credited: 0,
        skips,
        fromBlock,
        scanTo: head,
        head,
        cursor,
        advancedTo: cursor,
      });
    }
    const feeTopic = ethers.zeroPadValue(receiver, 32);

    // Two discovery sources, unioned into ONE log array so the dedup + cursor
    // below treat them as a single ordered set of transactions:
    //   1. Every ERC-20 transfer TO the fee wallet — the aggregator (KyberSwap)
    //      swaps, which pay the 0.2% fee.
    //   2. Every `Swap` on our own Arc pools — the trades that our pool quoted
    //      better than KyberSwap and so ran direct, paying no fee and appearing
    //      in neither the fee scan nor `aggregator_swap_stats` until now.
    // Both are scanned in SPAN-wide chunks (retried, paced) so Arc's getLogs
    // range and rate limits do not refuse the run.
    const logs: ethers.Log[] = [];
    for (const { start, end } of planSpans(fromBlock, scanTo, SPAN)) {
      // A backfill re-reads only our pools; the fee history is the cursor's.
      // A backfill re-reads only the sources it names (pools by default).
      if (!backfill || backfill.sources.fee) {
        const page = await retryRpc(() =>
          provider.getLogs({
            fromBlock: start,
            toBlock: end,
            topics: [TRANSFER_TOPIC, null, feeTopic],
          }),
        );
        for (const l of page) logs.push(l);
        if (DELAY_MS) await sleep(DELAY_MS);
      }

      if (NATIVE_POOLS.length > 0 && (!backfill || backfill.sources.pools)) {
        const poolSwaps = await retryRpc(() =>
          provider.getLogs({
            fromBlock: start,
            toBlock: end,
            address: NATIVE_POOLS,
            topics: [V3_SWAP_TOPIC],
          }),
        );
        for (const l of poolSwaps) logs.push(l);
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }
    scanned = logs.length;

    // Unique tx hashes in block order (oldest first), so a MAX_TXS-capped run
    // always drains the oldest blocks and the cursor advances to the last block
    // it fully drained — the remainder is picked up next run.
    const ordered = [...logs].sort(
      (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
    );
    const seen = new Set<string>();
    const uniqueTx: { hash: string; block: number }[] = [];
    for (const l of ordered) {
      if (seen.has(l.transactionHash)) continue;
      seen.add(l.transactionHash);
      uniqueTx.push({ hash: l.transactionHash, block: l.blockNumber });
    }
    const txHashes = uniqueTx.slice(0, MAX_TXS).map((t) => t.hash);

    // How far this run may advance the cursor (only past fully drained blocks).
    // A backfill computes the same thing to say where the next call resumes.
    if (usingCursor || backfill) {
      const adv = computeCursorAdvance({
        fromBlock,
        scanTo,
        uniqueTxBlocks: uniqueTx.map((t) => t.block),
        maxTxs: MAX_TXS,
      });
      advancedTo = adv.advancedTo;
      if (adv.blockCapOverflow) bump("block-cap-overflow");
    }

    for (const txHash of txHashes) {
      try {
        const [tx, receipt] = await Promise.all([
          retryRpc(() => provider.getTransaction(txHash)),
          retryRpc(() => provider.getTransactionReceipt(txHash)),
        ]);
        if (!tx || !receipt) {
          bump("no-tx");
          continue;
        }
        const transfers = receipt.logs
          .map((l) => decodeTransferLog(l))
          .filter((t): t is NonNullable<typeof t> => t !== null);

        // Venues + account senders so Argus trades, direct native-pool trades,
        // and bundled (EIP-5792 / 7702 / 4337) trades are all credited to the
        // trader — see parseSwapInput. Our own pools and v3 router are venues so
        // a direct pool trade is recognised as a swap AND the router is never a
        // credit candidate (only the trader who sent the input leg is).
        const parsed = parseSwapInput({
          tx: { to: tx.to, from: tx.from },
          transfers,
          kyberRouter: router,
          venues: [ARGUS_V4.poolManager, v3Router, ...NATIVE_POOLS],
          accountSenders: userOpSenders(receipt.logs),
          feeReceiver: receiver,
        });
        if ("skip" in parsed) {
          bump(parsed.skip);
          continue;
        }

        // Value the trade. First choice is the USDC leg the wallet moved — USDC
        // is the Arc quote asset, so almost every swap has one and it IS the
        // dollar size, no price needed. A token↔token swap (no USDC leg) is
        // priced from its input token via the DEX, so ALL swaps credit, not just
        // USDC-input ones. Only a token the DEX cannot route is skipped.
        let usdValue = usdcLegValue({
          wallet: parsed.wallet,
          transfers,
          usdc: USDC,
          usdcDecimals: USDC_DECIMALS,
        });
        // Our native pools quote in the wrapped-native (0x8c6c), which is native
        // USDC 1:1 = $1 but which the aggregator cannot price (see #443). Treat a
        // wrapped-native leg as a USD leg too, so a direct pool trade quoted in it
        // is valued from that leg rather than falling to a DEX price it has none.
        if (usdValue === null && WRAPPED_NATIVE) {
          usdValue = usdcLegValue({
            wallet: parsed.wallet,
            transfers,
            usdc: WRAPPED_NATIVE,
            usdcDecimals: WRAPPED_NATIVE_DECIMALS,
          });
        }
        if (usdValue === null) {
          const dec = await tokenDecimals(provider, parsed.inputToken);
          if (dec === null) {
            bump("no-decimals");
            continue;
          }
          const prices = await dexTokenPrices(ARC, [
            { address: parsed.inputToken, decimals: dec },
          ]);
          const price = prices[parsed.inputToken.toLowerCase()];
          if (price) {
            usdValue = (Number(parsed.inputAmount) / 10 ** dec) * price;
          }
          if (DELAY_MS) await sleep(DELAY_MS);
        }
        if (usdValue === null || !(usdValue > 0)) {
          bump("unpriced-input");
          continue;
        }

        const block = tx.blockNumber
          ? await retryRpc(() => provider.getBlock(tx.blockNumber!))
          : null;
        const occurredAt = block
          ? new Date(block.timestamp * 1000).toISOString()
          : new Date().toISOString();

        /* Record the VOLUME first, for every valued swap — independent of the
           points decision below, which skips anything under the rate's min_usd.
           Fail-open: a ledger miss never blocks a credit, and a later backfill
           re-records it (idempotent on chain + tx). */
        const cls = classifySwap({
          tx: { to: tx.to, from: tx.from },
          transfers,
          kyberRouter: router,
          argusVenues: [ARGUS_V4.poolManager],
          nativeVenues: [v3Router, ...NATIVE_POOLS],
          feeReceiver: receiver,
        });

        if (dryRun) {
          // Previewing a backfill: value it, report it, write nothing.
          wouldCredit.push({
            txHash,
            wallet: parsed.wallet,
            usdValue,
            occurredAt,
            venue: cls.venue,
            feePaid: cls.feePaid,
          });
        } else {
          const ok = await recordSwapVolume({
            chainId: ARC,
            txHash,
            wallet: parsed.wallet,
            usdValue,
            venue: cls.venue,
            feePaid: cls.feePaid,
            occurredAt,
          });
          if (ok) recorded++;
          else bump("ledger-error");
        }

        // Points: skipped for a preview, and for a ledger-only backfill of
        // history whose points were already decided.
        if (!dryRun && !backfill?.ledgerOnly) {
          const res = await creditAction({
            wallet: parsed.wallet,
            source: "swap",
            season: SEASON,
            chainId: ARC,
            txHash,
            usdValue,
            occurredAt,
          });
          if (res.status === "credited") credited++;
          else bump(res.reason);
        }
      } catch {
        // One bad transaction never aborts the batch.
        bump("tx-error");
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  } catch (err) {
    return Response.json(
      { error: "scan-failed", detail: String((err as Error)?.message ?? err).slice(0, 120) },
      { status: 502 },
    );
  }

  // Checkpoint AFTER the scan+credit loop succeeded, so a mid-run failure re-runs
  // the same range rather than skipping it. Best-effort (idempotent re-scan).
  if (usingCursor && advancedTo !== null) await writeCursor(advancedTo);

  if (backfill)
    return Response.json({
      mode: "backfill",
      dryRun,
      ledgerOnly: backfill.ledgerOnly,
      sources: backfill.sources,
      scanned,
      credited,
      recorded,
      skips,
      fromBlock: backfill.from,
      drainedTo: advancedTo,
      nextFrom: backfillNextFrom(advancedTo, backfill.to),
      ...(dryRun ? { wouldCredit } : {}),
    });

  return Response.json({ scanned, credited, recorded, skips, cursor, advancedTo });
}

export const GET = handle;
export const POST = handle;
