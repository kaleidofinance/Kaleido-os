import { ethers } from "ethers";

import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { CHAINS, CHAINS_BY_ID, type ChainMeta } from "@/constants/chains";
import { isDeployed, tradableChains } from "@/constants/registry";
import type { ITradingPair } from "@/constants/types/dex";

/**
 * Which chains the pool tables enumerate, and how one sweep runs across them.
 *
 * Both enumerators — `usePoolData` for V2 pairs, `useV3Pools` for V3 pools — read
 * one chain each until now: `READ_ONLY_CHAIN_ID`, on the argument that a factory
 * is one address on one chain and a discovery table whose contents changed with
 * the wallet's network would be reporting on whatever code happens to sit at that
 * address elsewhere. That argument is still right about the *wallet's* chain and
 * was wrong to conclude "therefore one chain": the protocol is deployed to five,
 * pools have been opened on more than one of them, and a table that lists a single
 * chain's pools under the heading "All pools" is not describing the protocol. The
 * fix is to read every chain we deployed to, and to say on each row which chain it
 * came from — which is what `ITradingPair.chainId` is for.
 *
 * ONE SLOW CHAIN MUST NOT COST THE TABLE
 *
 * Five chains means five endpoints of differing health, and three of the five hold
 * no funded pools yet. So the fan-out is deliberately not a `Promise.all`:
 *
 *  - each chain is read independently and publishes its rows the moment they land,
 *    so the table fills in progressively rather than waiting for the slowest node;
 *  - a chain that fails contributes nothing instead of failing the list, and the
 *    sweep only reports an error when *every* chain failed — an empty table with a
 *    message is the honest outcome then, and one dead RPC is not that;
 *  - each chain has a deadline, because ethers' own request timeout is five
 *    minutes and an unhealthy-but-listening endpoint would otherwise hold the
 *    sweep open for that long, blocking the next refresh behind it.
 */

export interface DiscoveryChain {
  chainId: number;
  meta: ChainMeta;
  /** Non-null by construction — a chain with no RPC URL is dropped from the set. */
  provider: ethers.JsonRpcProvider;
}

/**
 * How long one chain gets before the sweep stops waiting for it.
 *
 * Long enough for a cold sweep on a slow public node — the V3 side is 84
 * `eth_call`s at four in flight, plus a range probe and two block reads — and
 * short enough that a hung endpoint cannot outlive the 30s refresh cycle it would
 * otherwise block. It stops the *waiting*, not the requests: the in-flight fetches
 * carry on until ethers gives up on them, so this bounds latency rather than
 * saving the calls.
 */
const CHAIN_DEADLINE_MS = 20_000;

/* Static for the life of the page: `DEPLOYMENTS` and `CHAINS` are constants and
   `providerForChain` caches, so this resolves once and every later caller reads
   the same array — which also keeps `snapshot()` below cheap and its row order
   stable. */
let discovered: DiscoveryChain[] | null = null;

/**
 * The chains a pool sweep covers: everywhere we have deployed and intend to trade.
 *
 * `tradableChains` is the same set the network picker offers, so the table cannot
 * list a chain the user has no way to reach — it ands `chains.ts`'s `tradable`
 * intent against a real deployment record, which is why a chain we have not
 * deployed to contributes no requests at all rather than 84 calls into an empty
 * address.
 *
 * The read chain leads the list when it is deployed, and is included even if it
 * were not marked tradable: it is the chain the rest of the app answers for, so a
 * configuration that reads it must not silently stop listing its pools. A chain
 * `chains.ts` carries no RPC URL for is dropped rather than dialled through the
 * read provider, for the reason `providerForChain` returns null — reading one
 * chain and labelling the answer with another is worse than a missing row.
 */
export function discoveryChains(): DiscoveryChain[] {
  if (discovered) return discovered;

  const ids: number[] = [];
  if (isDeployed(READ_ONLY_CHAIN_ID)) ids.push(READ_ONLY_CHAIN_ID);
  for (const chain of tradableChains(CHAINS)) {
    if (!ids.includes(chain.id)) ids.push(chain.id);
  }

  const out: DiscoveryChain[] = [];
  for (const chainId of ids) {
    const meta = CHAINS_BY_ID[chainId];
    const provider = providerForChain(chainId);
    if (!meta || !provider) continue;
    out.push({ chainId, meta, provider });
  }

  discovered = out;
  return out;
}

/** Chain ids only, for callers that just need to know whether there are any. */
export const discoveryChainIds = (): number[] =>
  discoveryChains().map((c) => c.chainId);

/**
 * `work`, but the caller stops waiting after `CHAIN_DEADLINE_MS`.
 *
 * The losing promise keeps running, so its eventual rejection needs a handler of
 * its own — without one, a chain that fails *after* its deadline surfaces as an
 * unhandled rejection in the console. Attaching one here does not take the
 * rejection away from the race, which has its own.
 */
function withDeadline<T>(work: Promise<T>, chain: DiscoveryChain): Promise<T> {
  work.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${chain.meta.shortName} did not answer within ${
              CHAIN_DEADLINE_MS / 1000
            }s`,
          ),
        ),
      CHAIN_DEADLINE_MS,
    );
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export interface PoolStore {
  /** Every chain's rows, in discovery order. Cheap; safe to call in a render. */
  snapshot(): ITradingPair[];
  /**
   * Called with a fresh snapshot each time any chain lands.
   *
   * Subscribed for the life of a consumer rather than only while its own sweep
   * runs: three components mount each hook — the strip, the table and the detail
   * page — and one shared sweep serves all of them, so a consumer that only
   * listened to its own call would sit on a stale list while another's sweep
   * published chain after chain.
   */
  subscribe(listener: (pools: ITradingPair[]) => void): () => void;
  /**
   * Read every discovery chain, publishing each as it lands.
   *
   * `prepare` runs once for the whole sweep and holds whatever is chain-agnostic —
   * the spot price table, in both callers, which has no cache of its own and would
   * otherwise be fetched once per chain. `perChain` then reads one chain and
   * returns its rows.
   *
   * Resolves with the full snapshot. Rejects only when every chain failed.
   */
  sweep<C>(
    prepare: () => Promise<C>,
    perChain: (chain: DiscoveryChain, context: C) => Promise<ITradingPair[]>,
    force: boolean,
  ): Promise<ITradingPair[]>;
}

/**
 * The cross-chain cache both enumerators keep at module scope.
 *
 * Keyed by chain rather than one flat list, which is what makes a partial result
 * expressible: a sweep can publish Sepolia's pools while Base is still reading,
 * and a chain that fails keeps whatever it last returned instead of blanking its
 * share of the table over one bad second. The alternative — dropping a failed
 * chain's rows — turns a transient RPC blip into pools that vanish and come back.
 */
export function createPoolStore(ttlMs: number): PoolStore {
  const byChain = new Map<number, ITradingPair[]>();
  const listeners = new Set<(pools: ITradingPair[]) => void>();
  let completedAt = 0;
  let inFlight: Promise<ITradingPair[]> | null = null;

  const snapshot = () =>
    discoveryChains().flatMap((c) => byChain.get(c.chainId) ?? []);

  const publish = () => {
    const rows = snapshot();
    for (const listener of listeners) listener(rows);
  };

  return {
    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    sweep(prepare, perChain, force) {
      /* An in-flight sweep is joined rather than duplicated, force or not: two
         consumers mounting in the same tick would otherwise each read five
         chains. */
      if (inFlight) return inFlight;
      if (!force && completedAt > 0 && Date.now() - completedAt < ttlMs) {
        return Promise.resolve(snapshot());
      }

      const run = (async () => {
        const context = await prepare();
        const chains = discoveryChains();

        const settled = await Promise.allSettled(
          chains.map(async (chain) => {
            const rows = await withDeadline(perChain(chain, context), chain);
            byChain.set(chain.chainId, rows);
            /* Published per chain, not once at the end — this is the whole point
               of the fan-out. */
            publish();
          }),
        );

        completedAt = Date.now();

        const failed = settled.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        for (let i = 0; i < settled.length; i += 1) {
          const result = settled[i];
          if (result.status === "rejected") {
            /* Warned rather than surfaced: the other chains' rows are on screen
               and a banner about a chain with no pools on it would be noise. */
            console.warn(
              `[pools] ${chains[i].meta.shortName} sweep failed:`,
              result.reason,
            );
          }
        }
        if (failed.length > 0 && failed.length === settled.length) {
          throw failed[0].reason;
        }

        return snapshot();
      })();

      inFlight = run;
      const clear = () => {
        if (inFlight === run) inFlight = null;
      };
      run.then(clear, clear);
      return run;
    },
  };
}
