import { envVars } from "@/constants/envVars";
import { CHAINS_BY_ID } from "@/constants/chains";
import { ethers } from "ethers";

/**
 * Default read chain: Sepolia, step 1 of TESTNET_WAVE (registry.ts).
 *
 * The read chain is whichever chain the protocol-wide panels should describe when
 * there is no wallet to ask — `/pool`'s stats, `/api/market/overview`, and the
 * AI read tools all render one chain's view of the protocol. Step 1 of the wave
 * is the right default because it is the first chain that will hold contracts;
 * there is no useful sense in which an unconfigured deployment reads a chain the
 * deploy has not reached yet.
 *
 * This replaced a hardcoded 11124 (Abstract Testnet), which was never a wave
 * chain and is no longer tradable at all.
 *
 * Not a `DEFAULT_CHAIN_ID` in the sense chains.ts refuses to have one. That
 * refusal is about substituting a default for *the user's* chain — the
 * `chainId ?? DEFAULT` fallback that answers confidently about the wrong chain
 * when the honest answer was "not connected". This constant is the opposite
 * case: the read path has no wallet to ask, by construction, which is why
 * `READ_ONLY_CHAIN_ID` is exported for server callers to scope lookups with.
 * Configuration is the only thing that can answer "which chain" here. It stays
 * module-private so it cannot be picked up as a fallback elsewhere.
 */
const DEFAULT_READ_CHAIN_ID = 11155111;

/**
 * Resolve the read chain from `NEXT_PUBLIC_READ_CHAIN_ID`.
 *
 * Unset is the normal case and takes the default above. A value that is *set and
 * unusable* throws, at module scope, on purpose — the two failure modes are not
 * comparable. An unparseable or unregistered chain id is an operator typo that
 * surfaces the moment the dev server or the build starts, and costs one edit.
 * Falling back silently instead would leave the app serving one chain's data
 * while its operator believed it was serving another's, for as long as nobody
 * checked. That is the same class of bug as a wrong contract address: nothing
 * throws, every figure renders, and all of them are about the wrong chain.
 *
 * Note this is a `NEXT_PUBLIC_` variable, so it is inlined at build time and
 * changing it needs a dev-server restart.
 */
function resolveReadChainId(): number {
  const raw = (process.env.NEXT_PUBLIC_READ_CHAIN_ID || "").trim();
  if (!raw) return DEFAULT_READ_CHAIN_ID;

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `NEXT_PUBLIC_READ_CHAIN_ID is not a chain id: "${raw}". ` +
        `Set it to a numeric id from src/constants/chains.ts, or unset it to ` +
        `use the default (${DEFAULT_READ_CHAIN_ID}).`,
    );
  }
  if (!CHAINS_BY_ID[id]) {
    throw new Error(
      `NEXT_PUBLIC_READ_CHAIN_ID is ${id}, which is not registered in ` +
        `src/constants/chains.ts. An unregistered chain has no RPC URL and no ` +
        `token table here, so every read against it would resolve to nothing. ` +
        `Add the chain there first, or unset this to use the default ` +
        `(${DEFAULT_READ_CHAIN_ID}).`,
    );
  }
  return id;
}

/**
 * The chain `readOnlyProvider` is pinned to.
 *
 * Exported so server-side callers can scope a registry lookup to the chain they
 * are actually reading. A token address is only meaningful together with its
 * chain, and server code has no wallet to ask — this constant is the answer,
 * and it moves in lockstep with the provider below.
 */
export const READ_ONLY_CHAIN_ID = resolveReadChainId();

const READ_CHAIN = CHAINS_BY_ID[READ_ONLY_CHAIN_ID];

/**
 * URL the read provider dials.
 *
 * Derived from `READ_ONLY_CHAIN_ID` via chains.ts rather than read from its own
 * variable, because the derived case sets `staticNetwork: true` below — ethers
 * then takes the declared network on trust and never calls `eth_chainId`. A URL
 * and a chain id supplied independently would disagree with nothing to catch it:
 * every read would return real data, from a chain the app has mislabelled, and
 * registry lookups keyed by the declared id would pair those reads with another
 * chain's addresses. Deriving one from the other removes the failure rather than
 * documenting it.
 *
 * `NEXT_PUBLIC_HTTP_RPC` still overrides, for a private or rate-limited endpoint.
 * It is NOT taken on trust, and the reason is that leaving it to the operator was
 * measured and failed: on 2026-08-25 this variable held
 * `https://api.testnet.abs.xyz` — Abstract Testnet, chain 11124, retired — while
 * `READ_ONLY_CHAIN_ID` had moved to Sepolia. With `staticNetwork: true` ethers
 * never asks, so `readOnlyProvider` reported itself as Sepolia and served
 * Abstract: block height 18,451,886 instead of 11,560,571, and `eth_getCode` at
 * the Sepolia diamond returned `0x`. Nothing threw. Every AI read tool degraded
 * to its own empty answer — `getPortfolio` to a null collateral, `serverLoans`
 * and `serverPositions` to `[]` — so the agent told a user with three live loans
 * and a funded position that they had none. That is worse than an error, because
 * the model relays it as fact and plans off it.
 *
 * So the check the override skips is put back for exactly the override case:
 * omitting `staticNetwork` makes ethers verify with one `eth_chainId` on first
 * use and throw `network changed: 11155111 => 11124` when the node disagrees.
 * One round trip, once, and only when an override is configured. The derived URL
 * keeps `staticNetwork: true` because URL and id come from the same record there
 * and cannot disagree.
 */
const overrideRpcUrl = envVars.httpRPC?.trim() || "";
const readRpcUrl = overrideRpcUrl || READ_CHAIN.rpcUrls[0];

if (!readRpcUrl) {
  throw new Error(
    `No RPC URL for read chain ${READ_ONLY_CHAIN_ID} ` +
      `(${READ_CHAIN.name}): chains.ts lists no rpcUrls for it and ` +
      `NEXT_PUBLIC_HTTP_RPC is unset.`,
  );
}

export const readOnlyProvider = new ethers.JsonRpcProvider(
  readRpcUrl,
  {
    chainId: READ_ONLY_CHAIN_ID,
    name: READ_CHAIN.name,
  },
  { staticNetwork: !overrideRpcUrl },
);

// read/write provider, that allows you to read data and also sign transaction on whatever chain it's pointing to
export const getProvider = (provider: any) =>
  new ethers.BrowserProvider(provider);

/**
 * A read provider for any chain in the registry, cached per chain.
 *
 * **Returns null for a chain chains.ts does not carry, and that is the point.**
 * The three call sites this replaces each fell back to `readOnlyProvider` for an
 * unrecognised chain — `getOmniProvider` in constants/utils/omniChainBalances.ts,
 * `getProviderByChainId` in constants/utils/getUsdcBalance.ts, and the latter's
 * explicit `case 11124`. That fallback reads one chain and labels the answer with
 * another: the omni-chain indexer would report a Sepolia balance under
 * "Abstract", and an allowance read for a chain the switch had never heard of
 * would come back as whatever the read chain happened to say. Nothing throws,
 * every number renders, and all of them are about the wrong chain.
 *
 * It was survivable only while `READ_ONLY_CHAIN_ID` was itself Abstract, so those
 * two happened to coincide. They no longer do. Null forces the caller to skip the
 * chain instead, which is the honest answer — a missing row is recoverable, a
 * wrong balance is not.
 *
 * Each provider is `staticNetwork: true`, like the read provider above, so the
 * URL must come from the same record as the id it is declared with. Both come
 * from `CHAINS_BY_ID[chainId]` here for exactly that reason.
 */
const chainProviderCache = new Map<number, ethers.JsonRpcProvider>();

export function providerForChain(
  chainId: number | undefined,
): ethers.JsonRpcProvider | null {
  if (!chainId || !Number.isInteger(chainId)) return null;
  if (chainId === READ_ONLY_CHAIN_ID) return readOnlyProvider;

  const cached = chainProviderCache.get(chainId);
  if (cached) return cached;

  const meta = CHAINS_BY_ID[chainId];
  const url = meta?.rpcUrls[0];
  if (!url) return null;

  const provider = new ethers.JsonRpcProvider(
    url,
    { chainId, name: meta.name },
    { staticNetwork: true },
  );
  chainProviderCache.set(chainId, provider);
  return provider;
}

/**
 * WebSocket provider for chain event subscriptions, created on first use.
 *
 * Deliberately a lazy function, not a constant. `new
 * ethers.WebSocketProvider(url)` opens the socket inside its own constructor, so
 * a module-level export opened one on *every* import of this file — and this file
 * is imported by API routes and server components for `readOnlyProvider`, which
 * meant a socket per server render, to a chain the request wasn't even reading.
 * Nothing connects now until a browser actually subscribes.
 *
 * Null when `NEXT_PUBLIC_WEBSOCKET_RPC` is unset: callers skip subscribing rather
 * than construct a provider with an undefined URL. It used to hardcode
 * `wss://api.testnet.abs.xyz/ws` while .env.example documents the same host
 * *without* the `/ws` path — whichever is right, one of the two was wrong, and
 * the env var wins because that is the one an operator can change.
 *
 * Pinned to the same chain as `readOnlyProvider` above. Unlike the HTTP URL,
 * this one cannot be derived: chains.ts lists HTTP endpoints only, and a
 * WebSocket endpoint is a different URL on a different scheme rather than the
 * same one reachable over `wss://`. So it stays an explicit variable, and it
 * must serve `READ_ONLY_CHAIN_ID` — events arriving from another chain would
 * invalidate caches holding this chain's reads.
 */
let wss: ethers.WebSocketProvider | null = null;

export const getWssProvider = (): ethers.WebSocketProvider | null => {
  if (!envVars.wssRPC) return null;
  if (!wss) {
    wss = new ethers.WebSocketProvider(envVars.wssRPC, {
      chainId: READ_ONLY_CHAIN_ID,
      name: READ_CHAIN.name,
    });
  }
  return wss;
};
