import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";

/**
 * One RPC call for many reads, on whichever chain the caller names.
 *
 * This is the primitive the app was missing. Every read hook here fired its
 * contract views one eth_call at a time — twenty round trips for one screen —
 * and on a throttled testnet endpoint some of those calls come back as an error
 * that a bespoke `try` turns into a `0` or a `—`. The result was balances and
 * totals that were fabricated rather than measured: the exact failure the whole
 * `null`-not-zero discipline in the old hooks was written to fight, one round
 * trip at a time.
 *
 * `aggregate3` on Multicall3 collapses that into a single call that either lands
 * or does not, and reports each sub-call's success independently — so a snapshot
 * is atomic (every value read at the same block) and a throttle failure is one
 * failure the caller can see, not twenty silent zeros. Multicall3 is deployed at
 * the canonical address on every chain this app touches (verified on all five
 * testnets, 2026-09-09); a chain without it returns every call as unread rather
 * than throwing, which is the same shape a caller already handles.
 *
 * The chain is a parameter, always. A read belongs to the chain the wallet is on
 * — that a staking balance was read from one fixed chain while the stake was
 * written on another is precisely the bug this layer exists to make unspellable.
 */

/** Multicall3, same address on every chain. */
export const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3 = new ethers.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
]);

/** One view to read: where, which function, and the args it takes. */
export interface Call {
  /** Contract address on the target chain. */
  target: string;
  /** The ABI that decodes this call. Pass one `Interface` per contract and reuse it. */
  iface: ethers.Interface;
  /** Function name as the ABI spells it. */
  method: string;
  /** Positional args, or none. */
  args?: readonly unknown[];
  /**
   * Whether a revert on THIS call is tolerated (default true). A view that
   * reverts when a token is not on the chain, or when a mapping has no row, is a
   * normal answer — the caller reads `success:false` and decides what it means.
   * Set false only when a revert should fail the whole batch.
   */
  allowFailure?: boolean;
}

/** What a single call returned: decoded value, or a flag that it did not land. */
export interface CallResult<T = unknown> {
  success: boolean;
  /** Decoded return — a single value unwrapped, a tuple as an array. Null when unread. */
  value: T | null;
}

/**
 * Read many views on `chainId` in one call. Never throws — a transport failure
 * or a missing Multicall3 comes back as every result `unread`, so a caller reads
 * the same shape whether the chain answered or not.
 */
export async function readContracts(
  chainId: number | undefined,
  calls: Call[],
): Promise<CallResult[]> {
  const unread = (): CallResult[] =>
    calls.map(() => ({ success: false, value: null }));

  const provider = providerForChain(chainId);
  if (!provider || calls.length === 0) return unread();

  let encoded: { target: string; allowFailure: boolean; callData: string }[];
  try {
    encoded = calls.map((c) => ({
      target: c.target,
      allowFailure: c.allowFailure ?? true,
      callData: c.iface.encodeFunctionData(c.method, c.args ?? []),
    }));
  } catch {
    /* A bad address or arg is a programming error, not a chain state — but it
       must not take down a whole page's read. Report it as all-unread, which the
       caller renders as "—" rather than crashing the render. */
    return unread();
  }

  try {
    const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3, provider);
    const raw: { success: boolean; returnData: string }[] =
      await mc.aggregate3(encoded);
    return raw.map((r, i) => {
      if (!r.success) return { success: false, value: null };
      try {
        const decoded = calls[i].iface.decodeFunctionResult(
          calls[i].method,
          r.returnData,
        );
        /* ethers returns a Result (array-like) even for one output. Unwrap the
           common single-value case so callers read `value` rather than
           `value[0]`; a multi-output view keeps the whole array. */
        return {
          success: true,
          value: decoded.length === 1 ? decoded[0] : Array.from(decoded),
        };
      } catch {
        return { success: false, value: null };
      }
    });
  } catch {
    return unread();
  }
}
