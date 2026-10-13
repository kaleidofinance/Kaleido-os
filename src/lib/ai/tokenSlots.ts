import { ethers } from "ethers";

/**
 * Finding an ERC-20's allowance storage slot, so a plan's approve step can be
 * faked into the simulation of the step it authorises.
 *
 * WHY. Arc's RPC honours `eth_call` state overrides but has no sequence-simulation
 * method (eth_simulateV1 / eth_callMany are both unsupported — probed 2026-09-16),
 * so simulatePlan can't just replay approve-then-swap and let the node carry the
 * allowance forward. It has to override the token's allowance slot itself. That
 * needs the slot, and the slot is `keccak(spender · keccak(owner · N))` for some
 * base slot N the token's author chose — 1 for old OpenZeppelin, but not a
 * constant across tokens.
 *
 * HOW. Detection is a probe, not a guess: for each candidate N, override the slot
 * that N implies to a sentinel, `eth_call allowance(owner, spender)`, and see if
 * the sentinel comes back. The N that reads back is the real one. The probes run
 * in parallel and the first match wins.
 *
 * THIS IS ALSO THE CHAIN CHECK. A chain that ignores overrides reads back the real
 * allowance, never the sentinel, so detection returns null and the caller declines
 * to fake anything — which is exactly right, because on such a chain a faked
 * allowance would be a lie and an un-faked one a false "this will revert". So a
 * successful detection is proof, for this token on this chain, that overrides work;
 * a failed one is the signal to leave the plan's approve→spend chain unsimulated.
 */

/** A minimal JSON-RPC caller, injected so the simulator can be tested offline. */
export type RpcCall = (
  method: string,
  params: unknown[],
) => Promise<{ result?: unknown; error?: { code?: number; message?: string; data?: string } }>;

const ALLOWANCE_IFACE = new ethers.Interface([
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** 42, as a sentinel allowance value distinctive enough not to occur by chance. */
const SENTINEL = 42n;

/**
 * The storage slot of `allowance[owner][spender]` for a `mapping(address =>
 * mapping(address => uint256))` declared at base slot `n`. Two nested Solidity
 * mappings: the inner key hashes with the base slot, the outer key with that.
 */
export function allowanceSlot(owner: string, spender: string, base: number): string {
  const pad = (v: string) => ethers.zeroPadValue(v, 32);
  const inner = ethers.keccak256(
    ethers.concat([pad(owner), pad(ethers.toBeHex(base))]),
  );
  return ethers.keccak256(ethers.concat([pad(spender), inner]));
}

/* Detection is per (chain, token): the slot is a property of the token's source,
   the same on every call, so it is found once and remembered. `null` is a real
   answer — "this token's layout could not be detected, do not fake it" — and is
   cached too, so a non-standard token is not re-probed on every plan. */
const slotCache = new Map<string, number | null>();

/** Clears the memoised slots. Tests only — production detection never goes stale. */
export function _resetSlotCache(): void {
  slotCache.clear();
}

/**
 * The base slot of a token's allowance mapping, or null when it can't be found
 * (a non-standard layout, or a chain that ignores overrides). Probes slots
 * 0..maxSlot in parallel; the first that reads the sentinel back wins.
 */
export async function detectAllowanceSlot(
  call: RpcCall,
  chainId: number,
  token: string,
  owner: string,
  spender: string,
  maxSlot = 20,
): Promise<number | null> {
  const key = `${chainId}:${token.toLowerCase()}`;
  const cached = slotCache.get(key);
  if (cached !== undefined) return cached;

  const data = ALLOWANCE_IFACE.encodeFunctionData("allowance", [owner, spender]);
  const sentinelWord = ethers.toBeHex(SENTINEL, 32);

  const probe = async (base: number): Promise<number | null> => {
    const slot = allowanceSlot(owner, spender, base);
    try {
      const res = await call("eth_call", [
        { to: token, data },
        "latest",
        { [token]: { stateDiff: { [slot]: sentinelWord } } },
      ]);
      if (
        !res.error &&
        typeof res.result === "string" &&
        res.result !== "0x" &&
        BigInt(res.result) === SENTINEL
      ) {
        return base;
      }
    } catch {
      /* A single probe's transport error is not the whole detection failing. */
    }
    return null;
  };

  const found = (await Promise.all(
    Array.from({ length: maxSlot + 1 }, (_, i) => probe(i)),
  )).find((n) => n !== null);

  const result = found ?? null;
  slotCache.set(key, result);
  return result;
}
