import { ethers } from "ethers";
import { swapFeeReceiver } from "@/lib/swap/kyberswapServer";
import { kyberSwapRouter } from "@/lib/swap/kyberswap";
import { providerForChain } from "@/config/provider";
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
const WINDOW_BLOCKS = 10_000;
const REORG_MARGIN = 5;
/** Cap on transactions processed per run, bounding RPC load like the other crons. */
const MAX_TXS = 200;

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
    const head = (await provider.getBlockNumber()) - REORG_MARGIN;
    const fromBlock = Math.max(0, head - WINDOW_BLOCKS);

    // Every ERC-20 transfer TO the fee wallet in the window, any token.
    const logs = await provider.getLogs({
      fromBlock,
      toBlock: head,
      topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(receiver, 32)],
    });
    scanned = logs.length;

    // One credit per transaction, even if a tx produced several fee transfers.
    const txHashes = [...new Set(logs.map((l) => l.transactionHash))].slice(
      0,
      MAX_TXS,
    );

    for (const txHash of txHashes) {
      try {
        const [tx, receipt] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
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
          ? await provider.getBlock(tx.blockNumber)
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
