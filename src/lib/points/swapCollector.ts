/**
 * Turning an on-chain swap into a points credit — the parts a mistake would
 * mis-credit through, kept pure and injectable so every branch is tested without
 * a chain.
 *
 * The data source is the 0.2% fee our swaps pay: KyberSwap sends it as a plain
 * transfer of the OUTPUT token to `SWAP_FEE_RECEIVER` inside the swap transaction.
 * The indexer scans for those transfers; this module decides, for each one,
 * whether it is a swap we credit and to whom for how much. Two holes it closes:
 *
 *  1. **Swap vs. bridge.** The fee wallet is shared with the bridge integrator, so
 *     a transfer to it is not proof of a swap. The proof is that the transaction
 *     called the KyberSwap router — `parseSwapInput` refuses anything else.
 *  2. **Who swapped, and how much.** The transfer's `from` is the router, not the
 *     user; the user is the transaction's `from`. The size is the user's INPUT
 *     leg (the token they sent in), read from the same transaction's transfers —
 *     valued at 1:1 when it is USDC (the Arc quote asset, so the common case needs
 *     no price), and priced otherwise.
 */

/** keccak256("Transfer(address,address,uint256)") — ERC-20 Transfer topic0. */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** A decoded ERC-20 Transfer: the token contract and the three fields. */
export interface TransferLog {
  token: string;
  from: string;
  to: string;
  value: bigint;
}

/** Just the transaction facts this needs — `to` (the contract called) and `from`
 *  (the EOA that called it). Kept minimal so a test builds one by hand. */
export interface SwapTx {
  to: string | null;
  from: string;
}

/** A raw log shape (ethers/JSON-RPC), for `decodeTransferLog`. */
export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
}

const norm = (a: string | null | undefined): string => (a ?? "").toLowerCase();

/** The 20-byte address packed into a 32-byte topic. Null when it isn't one. */
function addressFromTopic(topic: string | undefined): string | null {
  if (!topic || topic.length !== 66) return null;
  return `0x${topic.slice(26)}`.toLowerCase();
}

/**
 * A raw log → a Transfer, or null when it is not one. Only `Transfer(from, to,
 * value)` with two indexed address topics and a value in data decodes; anything
 * else (a different event, a malformed entry) is dropped rather than guessed at.
 */
export function decodeTransferLog(log: RawLog): TransferLog | null {
  if (norm(log.topics[0]) !== TRANSFER_TOPIC) return null;
  const from = addressFromTopic(log.topics[1]);
  const to = addressFromTopic(log.topics[2]);
  if (!from || !to) return null;
  let value: bigint;
  try {
    value = BigInt(log.data || "0x0");
  } catch {
    return null;
  }
  return { token: norm(log.address), from, to, value };
}

export type ParsedSwap =
  | { wallet: string; inputToken: string; inputAmount: bigint }
  | { skip: string };

/** keccak256 of ERC-4337's UserOperationEvent — topic[2] is the smart account. */
export const USER_OPERATION_EVENT_TOPIC =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";

/** The smart accounts a receipt's ERC-4337 UserOperationEvents name. Pure. */
export function userOpSenders(logs: readonly RawLog[]): string[] {
  const out: string[] = [];
  for (const l of logs) {
    if (norm(l.topics[0]) !== USER_OPERATION_EVENT_TOPIC) continue;
    const sender = addressFromTopic(l.topics[2]);
    if (sender) out.push(sender);
  }
  return out;
}

/**
 * Who to credit and for which input, from a swap transaction's transfers — or a
 * reason to skip. Pure.
 *
 * NOT keyed on `tx.to` / `tx.from` alone any more, because a trade signed as a
 * bundle (EIP-5792) is not a direct call from the user to the router:
 *   • an EIP-7702 account sends the tx to ITSELF (to = the user), sometimes via
 *     a relayer (from = the relayer);
 *   • an ERC-4337 smart wallet's tx goes from a bundler to the EntryPoint, and
 *     the user is the account its UserOperationEvent names.
 * Keyed that way, every bundled trade was either skipped or credited to the
 * relayer. So:
 *
 * Hole 1 (swap vs. bridge — the fee wallet is shared with the bridge
 * integrator): it is a swap when tokens moved THROUGH a swap venue we route —
 * the KyberSwap router, or Argus's v4 PoolManager — or the tx called the router
 * directly. A bridge's integrator fee arrives from the bridge's contracts and
 * touches neither.
 *
 * Hole 2 (who swapped): the first of tx.from, tx.to, then any 4337 account that
 * SENT an input leg in this tx. Never a venue or the fee wallet, and a relayer
 * or the EntryPoint sends no tokens, so neither can be credited.
 */
export function parseSwapInput(args: {
  tx: SwapTx;
  transfers: TransferLog[];
  kyberRouter: string;
  /** Other swap venues whose token movements prove a swap (Argus's PoolManager). */
  venues?: string[];
  /** ERC-4337 accounts named by the receipt (see userOpSenders). */
  accountSenders?: string[];
  /** The fee wallet — never a candidate for credit. */
  feeReceiver?: string;
}): ParsedSwap {
  const { tx, transfers, kyberRouter } = args;
  const venues = new Set([kyberRouter, ...(args.venues ?? [])].map(norm).filter(Boolean));

  const viaVenue =
    venues.has(norm(tx.to)) ||
    transfers.some((t) => venues.has(t.from) || venues.has(t.to));
  if (!viaVenue) return { skip: "not-a-swap" };

  const excluded = new Set([...venues, norm(args.feeReceiver)]);
  const candidates = [tx.from, tx.to, ...(args.accountSenders ?? [])]
    .map(norm)
    .filter((a) => a && !excluded.has(a));
  if (candidates.length === 0) return { skip: "no-sender" };

  // The size is the user's input leg — the transfer the user themselves sent.
  // The fee transfer and the output come FROM the router / pool, not the user.
  let wallet = "";
  let input: TransferLog | undefined;
  for (const c of candidates) {
    input = transfers.find((t) => t.from === c && t.value > 0n);
    if (input) {
      wallet = c;
      break;
    }
  }
  if (!input) return { skip: "no-input-leg" };

  return { wallet, inputToken: input.token, inputAmount: input.value };
}

/**
 * USD value of the input leg. USDC (the Arc quote asset) is 1:1 and needs no
 * price; everything else goes through the injected `priceUsd`, which returns null
 * when it cannot value the token — in which case the swap is skipped rather than
 * credited at a guessed value.
 */
export function valueInput(
  inputToken: string,
  inputAmount: bigint,
  cfg: { usdc: string; usdcDecimals: number },
  priceUsd: (token: string, amount: bigint) => number | null,
): number | null {
  if (norm(inputToken) === norm(cfg.usdc)) {
    return Number(inputAmount) / 10 ** cfg.usdcDecimals;
  }
  const v = priceUsd(norm(inputToken), inputAmount);
  return v !== null && v > 0 ? v : null;
}

/**
 * The trade's USD notional from its USDC leg — the USDC the wallet itself moved
 * in the swap, on whichever side USDC is. Pure.
 *
 * USDC is the Arc quote asset, so almost every trade has a USDC leg, and that leg
 * IS the dollar size of the trade — no price needed. The wallet's own leg is used
 * (`from === wallet` for a USDC input, `to === wallet` for a USDC output), never
 * the fee transfer to the fee wallet, and the input leg is preferred when both
 * exist because it is the exact amount in, before the 0.2% fee shaves the output.
 * Returns null when no USDC touched the wallet — a token↔token swap the caller
 * must price another way — so this never guesses.
 */
export function usdcLegValue(args: {
  wallet: string;
  transfers: TransferLog[];
  usdc: string;
  usdcDecimals: number;
}): number | null {
  const w = norm(args.wallet);
  const u = norm(args.usdc);
  let sent: bigint | null = null; // USDC the wallet put in (exact notional)
  let received: bigint | null = null; // USDC the wallet got out (net of fee)
  for (const t of args.transfers) {
    if (norm(t.token) !== u || t.value <= 0n) continue;
    if (t.from === w) sent = (sent ?? 0n) + t.value;
    else if (t.to === w) received = (received ?? 0n) + t.value;
  }
  const v = sent ?? received;
  return v === null ? null : Number(v) / 10 ** args.usdcDecimals;
}

/**
 * Which venue a recognised swap ran through, and whether it paid Kaleido's fee —
 * for the volume ledger (see swapLedger.ts). Pure.
 *
 * `feePaid` is read from the transfers, not inferred from the venue: a swap paid
 * the fee exactly when some token moved TO the fee wallet in its transaction.
 * That is what Total fees must be charged on — a direct native-pool trade pays
 * none, and charging 20 bps on it overstated fee revenue.
 *
 * Venue precedence: Argus (its PoolManager), then the aggregator (KyberSwap
 * router), then one of our own pools / our v3 router, else "other". A venue is
 * "touched" when the tx calls it or any transfer moves tokens from or to it.
 */
export function classifySwap(args: {
  tx: SwapTx;
  transfers: TransferLog[];
  kyberRouter: string;
  argusVenues?: string[];
  nativeVenues?: string[];
  feeReceiver?: string;
}): { venue: "aggregator" | "argus" | "native-pool" | "other"; feePaid: boolean } {
  const touches = (addrs: readonly string[] | undefined): boolean => {
    const set = new Set((addrs ?? []).map(norm).filter(Boolean));
    if (set.size === 0) return false;
    return (
      set.has(norm(args.tx.to)) ||
      args.transfers.some((t) => set.has(t.from) || set.has(t.to))
    );
  };
  const fee = norm(args.feeReceiver);
  const feePaid =
    !!fee && args.transfers.some((t) => t.to === fee && t.value > 0n);
  const venue = touches(args.argusVenues)
    ? "argus"
    : touches([args.kyberRouter])
      ? "aggregator"
      : touches(args.nativeVenues)
        ? "native-pool"
        : "other";
  return { venue, feePaid };
}
