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

/**
 * Who to credit and for which input, from a swap transaction's transfers — or a
 * reason to skip. Pure.
 */
export function parseSwapInput(args: {
  tx: SwapTx;
  transfers: TransferLog[];
  kyberRouter: string;
}): ParsedSwap {
  const { tx, transfers, kyberRouter } = args;

  // Hole 1: only a call to the KyberSwap router is a swap; a shared-wallet fee
  // from the bridge (or anything else) is not.
  if (!tx.to || norm(tx.to) !== norm(kyberRouter)) return { skip: "not-a-swap" };

  const wallet = norm(tx.from);
  if (!wallet) return { skip: "no-sender" };

  // Hole 2: the size is the user's input leg — the transfer the user themselves
  // sent. The fee transfer and the output are FROM the router, not the user.
  const input = transfers.find((t) => t.from === wallet && t.value > 0n);
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
