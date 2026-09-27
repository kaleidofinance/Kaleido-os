/**
 * The send a funding bridge exists for, prepared once the bridge lands.
 *
 * When a send can't be covered on its chain, the builder offers a bridge there
 * first (sendShortfall in build.ts) and hands back the send as `then`. After
 * the bridge is signed, the agent page watches the DESTINATION balance — the one
 * signal every provider shares (LI.FI, CCTP, a canonical portal) — and when the
 * send is covered it builds, audits and shows the send for review. It never
 * signs it: moving money stays the user's signature.
 *
 * Kept out of the page so the arrival rule is testable without React.
 */
import { CHAINS_BY_ID } from "@/constants/chains";
import { isNativeSentinel, resolveUserToken } from "@/constants/registry";
import { resolveChain } from "@/lib/ai/bridgeQuotes";
import type { Command } from "./fromCommand";

export interface ArrivalTarget {
  chainId: number;
  chainName: string;
  /** The token the send will move, as the destination chain knows it. */
  token: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  /** The send's amount in base units: arrival means the balance covers it. */
  units: bigint;
}

/** Where, in what, and how much must be there before the send can go. */
export function arrivalTarget(then: Command): ArrivalTarget | null {
  if (then.kind !== "send" || !then.chain) return null;
  const chain = resolveChain(then.chain);
  if (!chain) return null;
  const meta = CHAINS_BY_ID[chain.id];
  const t =
    resolveUserToken(meta, then.token.symbol, "dex") ??
    resolveUserToken(meta, then.token.symbol, "lending");
  if (!t) return null;
  let units: bigint;
  try {
    const [whole, frac = ""] = then.amount.split(".");
    if (frac.length > t.decimals) return null;
    units = BigInt(whole || "0") * 10n ** BigInt(t.decimals) +
      BigInt((frac + "0".repeat(t.decimals)).slice(0, t.decimals) || "0");
  } catch {
    return null;
  }
  return {
    chainId: chain.id,
    chainName: chain.shortName,
    token: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
    isNative:
      isNativeSentinel(t.address, "dex") || isNativeSentinel(t.address, "lending"),
    units,
  };
}

export type ArrivalOutcome = "arrived" | "timeout" | "aborted";

/**
 * Polls `read` until it reports at least `need`, the time runs out, or the
 * signal aborts. An unreadable balance (null, or a throw) is just another poll
 * — a flaky RPC must not end the wait.
 */
export async function waitForArrival(opts: {
  read: () => Promise<bigint | null>;
  need: bigint;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<ArrivalOutcome> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const until = now() + opts.timeoutMs;
  for (;;) {
    if (opts.signal?.aborted) return "aborted";
    let have: bigint | null = null;
    try {
      have = await opts.read();
    } catch {
      have = null;
    }
    if (opts.signal?.aborted) return "aborted";
    if (have !== null && have >= opts.need) return "arrived";
    if (now() >= until) return "timeout";
    await sleep(opts.intervalMs);
  }
}

/* ------------------------------------------------------------ persistence -- */
/*
 * The watch survives a reload: the send it's waiting on and its deadline are
 * kept per wallet in the browser, and the page resumes the watch on load. Only
 * the one wallet's record is ever read, and what comes back is validated field
 * by field — it becomes a command, even though it still has to be built,
 * audited and reviewed before anything is signed.
 */

/** How long a watch runs, from the moment the bridge was signed. */
export const ARRIVAL_WINDOW_MS = 20 * 60_000;

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SavedWatch {
  then: Command;
  /** Epoch ms after which the watch gives up. */
  deadline: number;
}

const keyFor = (address: string) =>
  `kaleido:afterBridge:${address.toLowerCase()}`;

export function saveWatch(
  store: KeyValueStore | null,
  address: string,
  watch: SavedWatch,
): void {
  try {
    store?.setItem(keyFor(address), JSON.stringify(watch));
  } catch {
    /* Private mode / quota: the watch still runs, it just won't survive a reload. */
  }
}

export function clearWatch(store: KeyValueStore | null, address: string): void {
  try {
    store?.removeItem(keyFor(address));
  } catch {
    /* nothing to do */
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d{1,30}(\.\d{1,36})?$/;

/** The saved watch for this wallet, or null — also null for anything malformed. */
export function loadWatch(
  store: KeyValueStore | null,
  address: string,
): SavedWatch | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(keyFor(address)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { then?: Record<string, unknown>; deadline?: unknown };
    const t = v.then;
    const tok = t?.token as Record<string, unknown> | undefined;
    if (
      !t || t.kind !== "send" ||
      typeof t.to !== "string" || !ADDRESS.test(t.to) ||
      typeof t.amount !== "string" || !AMOUNT.test(t.amount) ||
      typeof t.chain !== "string" || t.chain.length === 0 || t.chain.length > 40 ||
      !tok || typeof tok.symbol !== "string" || tok.symbol.length > 24 ||
      typeof tok.address !== "string" || !ADDRESS.test(tok.address) ||
      typeof tok.decimals !== "number" || !Number.isInteger(tok.decimals) ||
      tok.decimals < 0 || tok.decimals > 36 ||
      typeof v.deadline !== "number" || !Number.isFinite(v.deadline)
    ) {
      return null;
    }
    return {
      then: {
        kind: "send",
        amount: t.amount,
        to: t.to,
        chain: t.chain,
        token: {
          address: tok.address,
          name: typeof tok.name === "string" ? tok.name.slice(0, 64) : tok.symbol,
          symbol: tok.symbol,
          decimals: tok.decimals,
          verified: tok.verified === true,
          ...(typeof tok.chainId === "number" ? { chainId: tok.chainId } : {}),
        },
      } as Command,
      deadline: v.deadline,
    };
  } catch {
    return null;
  }
}
