import { ethers } from "ethers";
import { swapFeeReceiver } from "@/lib/swap/kyberswapServer";
import { kyberSwapRouter } from "@/lib/swap/kyberswap";
import { providerForChain } from "@/config/provider";
import { planSpans } from "@/lib/keeper/candleIndex";
import { retryRpc } from "@/lib/dex/rpcRetry";
import {
  TRANSFER_TOPIC,
  decodeTransferLog,
  parseSwapInput,
  valueInput,
} from "@/lib/points/swapCollector";
import { creditAction } from "@/lib/points/credit";

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
 * PHASE 1: only USDC-input swaps credit (USDC is the Arc quote asset, so this is
 * the overwhelming majority and needs no pricing — valued 1:1). A non-USDC input
 * is skipped, not guessed at, until token pricing is wired.
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
const MAX_TXS = Number(process.env.POINTS_SWAP_MAX_TXS ?? 100);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get("x-cron-secret") === secret;
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
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

  let scanned = 0;
  let credited = 0;
  const skips: Record<string, number> = {};
  const bump = (r: string) => (skips[r] = (skips[r] ?? 0) + 1);

  try {
    const head = (await retryRpc(() => provider.getBlockNumber())) - REORG_MARGIN;
    const fromBlock = Math.max(0, head - WINDOW_BLOCKS);
    const feeTopic = ethers.zeroPadValue(receiver, 32);

    // Every ERC-20 transfer TO the fee wallet in the window, any token — scanned
    // in SPAN-wide chunks (retried, paced) so Arc's getLogs range and rate limits
    // do not refuse the run.
    const logs: ethers.Log[] = [];
    for (const { start, end } of planSpans(fromBlock, head, SPAN)) {
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
    scanned = logs.length;

    // One credit per transaction, even if a tx produced several fee transfers.
    const txHashes = [...new Set(logs.map((l) => l.transactionHash))].slice(
      0,
      MAX_TXS,
    );

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

        const parsed = parseSwapInput({
          tx: { to: tx.to, from: tx.from },
          transfers,
          kyberRouter: router,
        });
        if ("skip" in parsed) {
          bump(parsed.skip);
          continue;
        }

        // Phase 1: USDC 1:1, everything else skipped (no pricer supplied).
        const usdValue = valueInput(
          parsed.inputToken,
          parsed.inputAmount,
          { usdc: USDC, usdcDecimals: USDC_DECIMALS },
          () => null,
        );
        if (usdValue === null) {
          bump("non-usdc-input");
          continue;
        }

        const block = tx.blockNumber
          ? await retryRpc(() => provider.getBlock(tx.blockNumber!))
          : null;
        const occurredAt = block
          ? new Date(block.timestamp * 1000).toISOString()
          : new Date().toISOString();

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

  return Response.json({ scanned, credited, skips });
}

export const GET = handle;
export const POST = handle;
