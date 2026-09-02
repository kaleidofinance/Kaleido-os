/**
 * Refreshing the price feeds we publish ourselves, from the app instead of from
 * hardhat.
 *
 * This is `smart-contract/scripts/push-aggregator.js` with the hardhat runtime
 * taken out: same oracle, same feeds, same guards, same arithmetic. It exists
 * because the scheduler is the part that was broken, not the script.
 *
 * ── Why a second publisher ──────────────────────────────────────────────────
 *
 * `PushablePriceFeed` contracts on Robinhood are the only thing pricing that
 * chain, and nothing refreshes them but a keeper. The committed keeper runs on
 * GitHub Actions on a 20-minute cron, and measured over 152 hours GitHub
 * delivered 47 of the ~456 runs that schedule asks for — one per ~3.2 hours, gaps
 * of 2.5–5.5 h. ETH's installed bound there is 3600s. So it is blown between
 * consecutive runs by the scheduler alone, with a correct script and a funded
 * keeper: every deposit, borrow, health-factor read and liquidation on that chain
 * reverts `Protocol__StalePrice` for most of every interval.
 *
 * A route can be called by anything that fires on time. That is the whole reason
 * this module exists, and it is why it takes no scheduler of its own — see
 * `src/app/api/keeper/push/route.ts`, which is one caller of it.
 *
 * ── Which feeds it pushes: the feed decides, not a table ─────────────────────
 *
 * `scripts/libraries/aggregator-feeds.js` carries a per-chain list of which feeds
 * are self-hosted. That list is not reachable from here (CommonJS, outside the app
 * root) and copying it would create a second table to keep in sync — one that,
 * being wrong in the safe-looking direction, would have this pushing at a
 * third-party aggregator.
 *
 * So nothing here says which chains self-host. For each candidate feed id it asks
 * the oracle `feedAggregator(id)` — the address the protocol actually prices
 * against, so pushing to it is pushing to exactly what a borrower's health factor
 * reads — and then asks THAT contract two questions only a `PushablePriceFeed`
 * answers: `maxDeviationBps()` and `isPusher(keeper)`. Both are needed by the
 * logic below anyway. A Chainlink proxy has neither selector and reverts, which
 * is the skip; a feed that has not granted this keeper says so itself.
 *
 * The consequence worth stating: this is correct on all five chains today and
 * stays correct the day a `PushablePriceFeed` is deployed on a sixth. Sepolia,
 * Base Sepolia and BSC read Chainlink aggregators, which publish their own prices
 * and reject ours; Arc's oracle is `oracleKind() == "pyth"`, which takes a
 * Wormhole-signed blob that only Pyth can produce — `scripts/push-prices.js`, not
 * this. Both cases are reported rather than silently dropped.
 *
 * The one gap in that, stated because it is invisible from the outside: the ids
 * asked for come from `PYTH_FEEDS`, which is four distinct feeds (ETH/WETH, USDC,
 * USDT, BNB). `AggregatorPriceOracle` keeps `_feeds` private, so there is nothing
 * to enumerate against and a `PushablePriceFeed` deployed for some other symbol
 * would simply never be asked about — no error, no line in the report. When one
 * is, add the symbol to `PYTH_FEEDS` and take its id from
 * `scripts/libraries/pyth-feeds.js`, which is where feeds are registered from and
 * where an id has provenance. `pushFeeds.test.ts` requires the two tables to
 * agree on every symbol they share.
 *
 * ── Why it does not reuse `getPrices` from lib/points/prices.ts ──────────────
 *
 * That module answers "what is this worth", which is a different question from
 * "what was observed, and when". Two reasons it cannot be the source here:
 *
 *  1. It returns no observation time. `pushAnswer` stores `observedAt` as the
 *     feed's `updatedAt`, and `ProtocolFacet` ages a price as
 *     `block.timestamp - updatedAt` — so that stamp IS the staleness the protocol
 *     enforces. Stamping it with our own clock would assert a freshness nobody
 *     measured, which is why the hardhat keeper drops a CoinGecko entry with no
 *     `last_updated_at` rather than filling one in. This asks for
 *     `include_last_updated_at` and drops it too.
 *  2. It caches for 60s. A cached price is right for valuing a position and wrong
 *     for a push: the feed rejects `observedAt <= last` as a replay, so a keeper
 *     fed from a cache would push once and then fail until the cache expired.
 *
 * What is shared is the part that must not diverge: the feed ids (`PYTH_FEEDS`,
 * exported from that module) and the CoinGecko coin ids (`feedFor`). A chart, a
 * points balance and a collateral price disagreeing about which coin "ETH" is
 * would be a bug nobody would think to look for.
 *
 * ── The scaling is duplicated on purpose, and must stay identical ────────────
 *
 * `scaleToDecimals` and `decimalToFixedPoint` below are ports of
 * `hermes-prices.js`'s `scaleParsedPrice` and `decimalToPythShape`. Two
 * publishers now write to the same feed, and if they scaled a price differently
 * the first push after a switch would move the stored answer for no market
 * reason — reading as a jump, and rejected outright if it crossed the deviation
 * guard. Change one, change both: `pushFeeds.test.ts` runs this port and
 * `scaleParsedPrice` itself over one table of prices and requires identical
 * BigInts, so a drift fails `npm test` rather than a feed.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It will not bypass a deviation guard. `forceAnswer` is owner-only and this
 * holds a keeper key, which is the correct arrangement rather than a limitation:
 * telling a real move from a units bug is a human decision. A rejection is
 * reported with both prices so the human can make it.
 *
 * It will not push an observation already older than the feed's bound — that
 * lands a price which reverts anyway — and it will not push one no newer than
 * what the feed already holds, which the feed rejects as a replay. Both are
 * normal conditions on a tight schedule, not errors.
 *
 * It writes no file. `pushfeeds-<net>.json` is a receipt the hardhat keeper
 * leaves in the repo; a serverless filesystem is discarded when the invocation
 * ends, so the return value is the receipt and the caller decides where it goes.
 *
 * ── The key ─────────────────────────────────────────────────────────────────
 *
 * `KEEPER_PRIVATE_KEY`, the same name the GitHub workflow uses, and nothing else.
 * It deliberately does not fall back to `PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY`:
 * those own the diamond, the oracle and the feeds themselves, and a key that can
 * call `diamondCut` or `forceAnswer` must not sit behind an HTTP route. The
 * keeper's only power is the one action it performs, which is what `isPusher`
 * is for. Refusing an owner key here is explicit rather than merely absent,
 * because that fallback is the kind that gets added later for convenience.
 */

import { ethers } from "ethers";

import { getChainMeta } from "@/constants/chains";
import { DEPLOYMENTS, getContracts } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { PYTH_FEEDS } from "@/lib/points/prices";
import { feedFor } from "@/lib/v2/prices/feeds";

if (typeof window !== "undefined") {
  throw new Error(
    "[keeper/pushFeeds] server-only module imported in the browser. It holds a " +
      "signing key and publishes the prices the protocol liquidates on.",
  );
}

/* Minimal human-readable ABIs rather than the JSON in src/abi/. Each fragment
   below is copied from the contract source it names, and there are eight of them
   — small enough to read at the call site, and immune to a generated artifact
   drifting from the deployed code. */

/** `contracts/utils/oracle/AggregatorPriceOracle.sol` */
const ORACLE_ABI = [
  "function oracleKind() view returns (string)",
  "function feedAggregator(bytes32 feedId) view returns (address)",
];

/** `contracts/utils/oracle/PushablePriceFeed.sol` */
const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function maxDeviationBps() view returns (uint256)",
  "function isPusher(address) view returns (bool)",
  "function owner() view returns (address)",
  "function pushAnswer(int256 answer, uint256 observedAt)",
];

/** `contracts/facets/ProtocolFacet.sol` */
const PROTOCOL_ABI = [
  "function getPriceMaxAge() view returns (uint256)",
  "function getFeedMaxAge(bytes32 _priceFeed) view returns (uint256)",
];

const HERMES_BASE = process.env.HERMES_ENDPOINT || "https://hermes.pyth.network";
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

/**
 * Symbols whose CoinGecko id is their underlying rather than the asset itself.
 *
 * `feedFor` maps WBTC, cbBTC and BTCB to `bitcoin`, which is right for a chart
 * and wrong for a feed the protocol liquidates on: a custodied wrapper that can
 * depeg would be priced as though it could not, invisibly, forever. None of them
 * is in `PYTH_FEEDS` today, so this guards a future edit rather than a live case
 * — the same refusal `hermes-prices.js` makes, kept here so adding one there
 * cannot quietly start publishing it here.
 */
const NOT_ITS_OWN_COIN = new Set(["WBTC", "CBBTC", "BTCB"]);

/** One outcome per feed the oracle points at, whatever happened to it. */
export interface FeedOutcome {
  /** Symbols registered against this feed id — ETH and WETH share one. */
  symbols: string[];
  feedId: string;
  aggregator: string;
  /** `pushed` spent gas; every other status did not. */
  status: "pushed" | "would-push" | "fresh" | "skipped" | "failed";
  /** Why, in one line, for every status but `pushed`. */
  reason?: string;
  /** Age of the stored answer when measured, or null before the first push. */
  ageSeconds?: number | null;
  /** The bound this feed is actually held to, and where that came from. */
  boundSeconds?: number;
  boundFrom?: "per-feed override" | "global default";
  /** The answer pushed, at the feed's own `decimals()`. */
  answer?: string;
  usd?: number;
  observedAt?: number;
  source?: "hermes" | "coingecko";
  /** Measured against `maxDeviationBps` before spending gas. */
  deviationBps?: number;
  txHash?: string;
  /**
   * Whether a receipt came back. A `pushed` outcome with `confirmed: false` is a
   * transaction that was sent and whose receipt we did not see — which says
   * nothing about whether it landed, so it is reported as sent rather than
   * failed.
   */
  confirmed?: boolean;
}

export interface ChainOutcome {
  chainId: number;
  network: string;
  /**
   * `pushed`      at least one answer was written.
   * `dry-run`     at least one answer passed every guard and was not written.
   * `nothing-to-do` every feed was already fresh, or no source had anything newer.
   * `not-self-hosted` the oracle points at no feed this keeper may push.
   * `unsupported` the chain's oracle takes signed relays, not bare answers.
   * `error`       the run could not be completed; see `error`.
   */
  status:
    | "pushed"
    | "dry-run"
    | "nothing-to-do"
    | "not-self-hosted"
    | "unsupported"
    | "error";
  keeper?: string;
  /** Native balance, so a keeper about to run dry is visible in the receipt. */
  keeperBalance?: string;
  oracle?: string;
  feeds: FeedOutcome[];
  error?: string;
}

export interface PushResult {
  chains: ChainOutcome[];
  pushed: number;
  /** Answers that passed every guard and were withheld because of `dryRun`. */
  wouldPush: number;
  failed: number;
}

/**
 * Chains worth asking at all: an `AggregatorPriceOracle` with a diamond behind
 * it to read bounds from.
 *
 * Derived from the generated registry rather than listed, so it cannot be a
 * chain out of date. `oracleKind` there is copied from the deployment record,
 * which reads it back from the contract's own `oracleKind()` — and this verifies
 * it against the chain again before pushing, because the record is generated at
 * deploy time and the chain is now.
 */
export const SELF_HOSTING_CANDIDATE_CHAINS: readonly number[] = Object.keys(
  DEPLOYMENTS,
)
  .map(Number)
  .filter((chainId) => {
    const c = DEPLOYMENTS[chainId];
    return Boolean(c?.priceOracle) && c?.oracleKind === "aggregator-v3";
  })
  .sort((a, b) => a - b);

/**
 * Feed ids to look for, each with the symbols registered against it.
 *
 * Exported for `pushFeeds.test.ts`, which checks these ids against
 * `smart-contract/scripts/libraries/pyth-feeds.js` — the table the feeds were
 * REGISTERED from. If the two ever disagree about a symbol, this pushes one
 * asset's price onto another asset's feed.
 */
export function candidateFeeds(): { id: string; symbols: string[] }[] {
  const byId = new Map<string, string[]>();
  for (const [symbol, rawId] of Object.entries(PYTH_FEEDS)) {
    const id = rawId.startsWith("0x")
      ? rawId.toLowerCase()
      : `0x${rawId.toLowerCase()}`;
    const hit = byId.get(id);
    if (hit) hit.push(symbol);
    else byId.set(id, [symbol]);
  }
  return [...byId].map(([id, symbols]) => ({ id, symbols }));
}

/**
 * Move a parsed price to exactly `decimals` places, as a BigInt.
 *
 * Port of `hermes-prices.js`'s `scaleParsedPrice`; see the header on why the two
 * must agree. Pyth reports an integer at a signed exponent — $2345.12345678
 * arrives as (234512345678, -8) — and a feed stores an integer at its own
 * `decimals()`. Precision below the target is truncated, which is what
 * `AggregatorPriceOracle._rescale` does for the same reason: finer than 1e-8 of
 * a unit is below the protocol's own rounding, and carrying it would be false
 * exactness.
 *
 * Exported so `pushFeeds.test.ts` can run it and `scaleParsedPrice` over the
 * same table and require identical BigInts. A comment cannot enforce that; the
 * test can, and the cost of the two drifting is a legitimate price that reads as
 * a deviation on a feed the protocol liquidates on.
 */
export function scaleToDecimals(
  priceStr: string,
  expo: number,
  decimals: number,
): bigint {
  const raw = BigInt(priceStr);
  if (raw <= 0n) {
    throw new Error(
      `the source served a non-positive price (${priceStr}) — PushablePriceFeed rejects answer <= 0`,
    );
  }
  const shift = expo + decimals; // -8 + 8 = 0, the common case: no shift
  if (shift >= 0) return raw * 10n ** BigInt(shift);

  const scaled = raw / 10n ** BigInt(-shift);
  if (scaled === 0n) {
    throw new Error(
      `price ${priceStr}e${expo} truncates to zero at ${decimals} decimals`,
    );
  }
  return scaled;
}

/**
 * A decimal price to the (integer, expo) pair `scaleToDecimals` wants.
 *
 * String surgery on a fixed-point rendering rather than multiplying by 1e8,
 * because `2458.93 * 1e8` is `245892999999.99997` in binary floating point and
 * the multiplication would publish a price one ten-millionth off for no reason.
 */
export function decimalToFixedPoint(usd: number): {
  priceStr: string;
  expo: number;
} {
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`not a usable price: ${JSON.stringify(usd)}`);
  }
  const fixed = usd.toFixed(8);
  /* toFixed switches to exponent notation above 1e21, which BigInt cannot parse.
     No asset priced here is within nine orders of magnitude of that, so this
     catches a garbled response rather than a real case. */
  if (!/^\d+\.\d{8}$/.test(fixed)) {
    throw new Error(`price ${usd} does not render as a fixed-point decimal`);
  }
  const [whole, frac] = fixed.split(".");
  return { priceStr: `${whole}${frac}`.replace(/^0+(?=\d)/, ""), expo: -8 };
}

interface Observation {
  /** Integer price at `expo`, before scaling to any feed's decimals. */
  priceStr: string;
  expo: number;
  /** When the publisher observed it, in seconds. Measured, never invented. */
  publishTime: number;
  source: "hermes" | "coingecko";
}

interface HermesFeed {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

/** One row of CoinGecko's `simple/price`, before anything is trusted about it. */
interface CoinGeckoRow {
  usd?: unknown;
  last_updated_at?: unknown;
}

/**
 * Hermes' parsed price per feed id. Never throws for a network reason — a
 * refusal returns nothing so the caller falls through to CoinGecko, which is the
 * behaviour that kept Robinhood priceable when `hermes.pyth.network` began
 * answering 401 on every price path on 2026-08-27.
 */
async function fromHermes(ids: string[]): Promise<Map<string, Observation>> {
  const out = new Map<string, Observation>();
  if (ids.length === 0) return out;

  const qs = ids.map((id) => `ids[]=${id}`).join("&");
  let feeds: HermesFeed[];
  try {
    const res = await fetch(`${HERMES_BASE}/api/latest_price_feeds?${qs}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Hermes ${res.status}`);
    feeds = (await res.json()) as HermesFeed[];
  } catch (err) {
    console.warn(
      `[keeper/pushFeeds] Hermes unavailable (${(err as Error).message}) — falling back to CoinGecko`,
    );
    return out;
  }

  for (const f of feeds) {
    const id = f.id.startsWith("0x") ? f.id.toLowerCase() : `0x${f.id.toLowerCase()}`;
    const priceStr = f.price?.price;
    const expo = f.price?.expo;
    const publishTime = Number(f.price?.publish_time ?? 0);
    /* No price or no publish time is unusable. Dropped rather than repaired, so
       it shows up as a missing id and CoinGecko is asked for it. */
    if (priceStr === undefined || expo === undefined || !publishTime) continue;
    out.set(id, { priceStr: String(priceStr), expo: Number(expo), publishTime, source: "hermes" });
  }
  return out;
}

/**
 * The same feeds from CoinGecko, with `include_last_updated_at` so each answer
 * carries an observation time. An entry without one is dropped: the feed stores
 * that stamp as the age the protocol enforces, and substituting our own clock
 * would assert a freshness never measured.
 */
async function fromCoinGecko(
  wanted: { id: string; symbols: string[] }[],
): Promise<Map<string, Observation>> {
  const out = new Map<string, Observation>();

  const coinByFeed = new Map<string, string>();
  for (const { id, symbols } of wanted) {
    /* Any symbol on the feed will do — they share it because they are the same
       asset — but a wrapper CoinGecko prices as its underlying is refused. */
    const usable = symbols.filter(
      (s) => !NOT_ITS_OWN_COIN.has(s.trim().toUpperCase()),
    );
    const coin = usable.map((s) => feedFor(s)).find(Boolean);
    if (coin) coinByFeed.set(id, coin);
  }
  if (coinByFeed.size === 0) return out;

  const coins = [...new Set(coinByFeed.values())];
  const apiKey = process.env.COINGECKO_API_KEY;
  const url =
    `${COINGECKO}?ids=${encodeURIComponent(coins.join(","))}` +
    "&vs_currencies=usd&include_last_updated_at=true";

  /* Two attempts, as in lib/points/prices.ts and for the same measured reason:
     outbound HTTPS from node intermittently fails as `fetch failed` on the first
     call and succeeds immediately after, and by the time this runs it is the last
     source there is. */
  let body: Record<string, CoinGeckoRow> | null = null;
  let lastError = "no response";
  for (let attempt = 0; attempt < 2 && body === null; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      body = (await res.json()) as Record<string, CoinGeckoRow>;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  if (body === null) {
    console.warn(`[keeper/pushFeeds] CoinGecko unavailable (${lastError})`);
    return out;
  }

  for (const [id, coin] of coinByFeed) {
    const entry = body[coin];
    const usd = entry?.usd;
    const observedAt = Number(entry?.last_updated_at ?? 0);
    if (typeof usd !== "number" || !Number.isInteger(observedAt) || observedAt <= 0) {
      continue;
    }
    const { priceStr, expo } = decimalToFixedPoint(usd);
    out.set(id, { priceStr, expo, publishTime: observedAt, source: "coingecko" });
  }
  return out;
}

/**
 * Hermes first, CoinGecko only for the ids Hermes did not serve.
 *
 * So a working Hermes behaves exactly as it did before the fallback existed, and
 * a partial outage is filled per id rather than all-or-nothing.
 */
async function observePrices(
  wanted: { id: string; symbols: string[] }[],
): Promise<Map<string, Observation>> {
  const out = await fromHermes(wanted.map((w) => w.id));
  const missing = wanted.filter((w) => !out.has(w.id));
  if (missing.length === 0) return out;

  for (const [id, obs] of await fromCoinGecko(missing)) {
    if (!out.has(id)) out.set(id, obs);
  }
  return out;
}

/** Absolute deviation in basis points, exactly as `_deviationBps` computes it. */
export function deviationBps(prev: bigint, next: bigint): bigint {
  const diff = next > prev ? next - prev : prev - next;
  return (diff * 10_000n) / prev;
}

/**
 * Serialises pushes per chain across concurrent invocations of one instance.
 *
 * Two callers arriving together would read the same pending nonce, and the second
 * transaction would replace the first rather than follow it — one feed silently
 * unpushed while both callers were told it worked. Same guard, same reason, as
 * `/api/gas-drip`.
 */
const chainLocks = new Map<number, Promise<unknown>>();

function serialise<T>(chainId: number, work: () => Promise<T>): Promise<T> {
  const prior = chainLocks.get(chainId) ?? Promise.resolve();
  const next = prior.then(work, work);
  /* Swallowed on the stored copy only: the returned promise still rejects to the
     caller, but an unhandled rejection here would take the process down. */
  chainLocks.set(
    chainId,
    next.catch(() => undefined),
  );
  return next;
}

export interface PushOptions {
  /** Which chains to run. Defaults to every candidate in the registry. */
  chainIds?: number[];
  /**
   * Push every feed regardless of age, rather than only those already over their
   * bound.
   *
   * Defaults to true, because a scheduler wants freshness and not repair: a
   * keeper that only pushes what is already stale leaves the feed stale for part
   * of every interval, which is the condition it exists to prevent. It costs
   * nothing when the source has published nothing new — that push is skipped
   * before it reaches the chain.
   */
  pushAll?: boolean;
  /** Limit to feeds carrying one of these symbols. */
  symbols?: string[];
  /**
   * Run every read and every guard, then stop short of the transaction.
   *
   * The point of it is that the guards are where the interesting failures are —
   * a feed that has not granted the keeper, a source serving a stale
   * observation, a deviation that would be rejected — and all of them are
   * decidable before spending anything. So an operator can ask what a run would
   * do, and a new scheduler can be pointed at this before it is trusted with
   * gas.
   */
  dryRun?: boolean;
}

/** Refresh one chain's self-hosted feeds. Never throws; failure is a status. */
export async function pushChainFeeds(
  chainId: number,
  options: PushOptions = {},
): Promise<ChainOutcome> {
  const meta = getChainMeta(chainId);
  const contracts = getContracts(chainId);
  const network = meta?.shortName ?? meta?.name ?? `chain ${chainId}`;
  const outcome: ChainOutcome = { chainId, network, status: "error", feeds: [] };

  if (!meta || !contracts.priceOracle) {
    outcome.error = "no oracle deployed on this chain";
    return outcome;
  }
  if (contracts.oracleKind === "pyth") {
    /* Not a failure. A PythPriceOracle verifies a Wormhole-signed blob on chain
       and only Pyth can produce one, so no amount of price data helps here —
       scripts/push-prices.js relays it, and as of 2026-09-01 that is blocked on
       Hermes returning 401 rather than on anything this route could do. */
    outcome.status = "unsupported";
    outcome.error =
      "oracle is the Pyth backend: it takes a signed relay, not a pushed answer";
    return outcome;
  }

  const privateKey = process.env.KEEPER_PRIVATE_KEY;
  if (!privateKey) {
    outcome.error = "KEEPER_PRIVATE_KEY is not set";
    return outcome;
  }
  /* The diamond owner can call diamondCut and the feed owner can call
     forceAnswer. Neither belongs on a key reachable over HTTP; refusing is the
     only safe response to finding one here. */
  if (
    privateKey === process.env.PRIVATE_KEY ||
    privateKey === process.env.DEPLOYER_PRIVATE_KEY
  ) {
    outcome.error =
      "KEEPER_PRIVATE_KEY equals an owner key — refusing to sign with it";
    return outcome;
  }

  const only = (options.symbols ?? [])
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const pushAll = options.pushAll ?? true;
  const dryRun = options.dryRun ?? false;

  /* This route's own provider rather than config/provider.ts's cache, which
     exists for the browser read path and pins one chain. staticNetwork skips an
     eth_chainId round trip per request. */
  const provider = new ethers.JsonRpcProvider(
    meta.rpcUrls[0],
    { chainId, name: meta.name },
    { staticNetwork: true },
  );

  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const oracle = new ethers.Contract(contracts.priceOracle, ORACLE_ABI, provider);
    outcome.keeper = wallet.address;
    outcome.oracle = contracts.priceOracle;

    /* Verify the backend against the chain, not only against the generated
       record: the record is written at deploy time and a chain can be
       re-pointed. */
    const [kind, block, balance] = await retryRpc(() =>
      Promise.all([
        oracle.oracleKind() as Promise<string>,
        provider.getBlock("latest"),
        provider.getBalance(wallet.address),
      ]),
    );
    if (kind !== "aggregator-v3") {
      outcome.status = "unsupported";
      outcome.error = `oracle reports oracleKind() = "${kind}", not "aggregator-v3"`;
      return outcome;
    }
    if (!block) {
      outcome.error = "the chain served no latest block";
      return outcome;
    }
    const blockTime = Number(block.timestamp);
    outcome.keeperBalance = ethers.formatEther(balance);

    /* Bounds come from the diamond where there is one: getFeedMaxAge returns 0
       when no per-feed override is installed, in which case the global applies —
       the same fallback the facet's own ageing uses. The intended bounds in
       aggregator-feeds.js are not necessarily the installed ones, which is the
       whole reason they are read here. */
    const protocol = contracts.diamond
      ? new ethers.Contract(contracts.diamond, PROTOCOL_ABI, provider)
      : null;
    const globalMaxAge = protocol
      ? Number(await retryRpc(() => protocol.getPriceMaxAge() as Promise<bigint>))
      : null;

    /* ── Which feeds this keeper may push ───────────────────────────────────
       Resolved per candidate id and in parallel: the oracle's aggregator, then
       the two views only a PushablePriceFeed answers. */
    const wanted = candidateFeeds().filter(
      (f) => only.length === 0 || f.symbols.some((s) => only.includes(s.toUpperCase())),
    );

    interface Target {
      id: string;
      symbols: string[];
      address: string;
      feed: ethers.Contract;
      decimals: number;
      maxDeviationBps: bigint;
      prevAnswer: bigint;
      updatedAt: number;
      age: number | null;
      bound: number;
      boundFrom: "per-feed override" | "global default";
    }

    const targets: Target[] = [];

    /** Either a feed to push, or a reason this candidate is not one. */
    type Resolution =
      | { kind: "absent" }
      | {
          kind: "skip";
          symbols: string[];
          feedId: string;
          aggregator: string;
          reason: string;
        }
      | { kind: "target"; feedId: string; target: Omit<Target, "bound" | "boundFrom"> };

    const resolved: Resolution[] = await Promise.all(
      wanted.map(async (candidate): Promise<Resolution> => {
        let address: string;
        try {
          address = await retryRpc(
            () => oracle.feedAggregator(candidate.id) as Promise<string>,
          );
        } catch (err) {
          return {
            kind: "skip",
            symbols: candidate.symbols,
            feedId: candidate.id,
            aggregator: ethers.ZeroAddress,
            reason: `the oracle would not answer feedAggregator (${(err as Error).message})`,
          };
        }
        /* Not registered on this chain. Silent: most of the five ids are absent
           from most oracles, and reporting each would bury the ones that matter. */
        if (!address || address === ethers.ZeroAddress) return { kind: "absent" };

        const feed = new ethers.Contract(address, FEED_ABI, wallet);
        try {
          const [decimals, maxDev, pusher, owner, round] = await retryRpc(() =>
            Promise.all([
              feed.decimals() as Promise<bigint>,
              feed.maxDeviationBps() as Promise<bigint>,
              feed.isPusher(wallet.address) as Promise<boolean>,
              feed.owner() as Promise<string>,
              feed.latestRoundData() as Promise<
                [bigint, bigint, bigint, bigint, bigint]
              >,
            ]),
          );

          /* The owner may push without an isPusher entry (PushablePriceFeed.sol:347),
             so both are checked — but a keeper that IS the owner is a
             misconfiguration this refuses above, so in practice this is the
             grant. */
          if (
            !pusher &&
            ethers.getAddress(owner) !== ethers.getAddress(wallet.address)
          ) {
            return {
              kind: "skip",
              symbols: candidate.symbols,
              feedId: candidate.id,
              aggregator: address,
              reason:
                `this feed has not granted ${wallet.address} — an owner runs ` +
                "setPusher(keeper, true), as scripts/grant-pusher.js does",
            };
          }

          const updatedAt = Number(round[3]);
          return {
            kind: "target",
            feedId: candidate.id,
            target: {
              id: candidate.id,
              symbols: candidate.symbols,
              address,
              feed,
              decimals: Number(decimals),
              maxDeviationBps: maxDev,
              prevAnswer: round[1],
              updatedAt,
              age: updatedAt === 0 ? null : blockTime - updatedAt,
            },
          };
        } catch {
          /* No `maxDeviationBps`, no `isPusher`: a third-party aggregator, which
             publishes its own prices and would reject ours. Reported rather than
             hidden, because "Chainlink is registered here" is the answer to
             "why did nothing get pushed". */
          return {
            kind: "skip",
            symbols: candidate.symbols,
            feedId: candidate.id,
            aggregator: address,
            reason:
              "not a PushablePriceFeed — a third-party aggregator publishes this " +
              "feed and there is nothing for a keeper to do",
          };
        }
      }),
    );

    for (const entry of resolved) {
      if (entry.kind === "absent") continue;
      if (entry.kind === "skip") {
        outcome.feeds.push({
          symbols: entry.symbols,
          feedId: entry.feedId,
          aggregator: entry.aggregator,
          status: "skipped",
          reason: entry.reason,
        });
        continue;
      }

      const bound = protocol
        ? Number(
            await retryRpc(
              () => protocol.getFeedMaxAge(entry.feedId) as Promise<bigint>,
            ),
          )
        : 0;
      targets.push({
        ...entry.target,
        bound: bound === 0 ? (globalMaxAge ?? 0) : bound,
        boundFrom: bound === 0 ? "global default" : "per-feed override",
      });
    }

    if (targets.length === 0) {
      outcome.status = "not-self-hosted";
      return outcome;
    }

    /* ── Prices, once, for everything that might be pushed ───────────────── */

    const due = pushAll
      ? targets
      : targets.filter((t) => t.age === null || t.age > t.bound);

    for (const t of targets) {
      if (!due.includes(t)) {
        outcome.feeds.push({
          symbols: t.symbols,
          feedId: t.id,
          aggregator: t.address,
          status: "fresh",
          ageSeconds: t.age,
          boundSeconds: t.bound,
          boundFrom: t.boundFrom,
          reason: "inside its bound, and onlyStale was asked for",
        });
      }
    }

    if (due.length === 0) {
      outcome.status = "nothing-to-do";
      return outcome;
    }

    const observed = await observePrices(
      due.map((t) => ({ id: t.id, symbols: t.symbols })),
    );

    /* ── Push, one transaction per feed ─────────────────────────────────── */

    for (const t of due) {
      const base: FeedOutcome = {
        symbols: t.symbols,
        feedId: t.id,
        aggregator: t.address,
        status: "skipped",
        ageSeconds: t.age,
        boundSeconds: t.bound,
        boundFrom: t.boundFrom,
      };

      const obs = observed.get(t.id);
      if (!obs) {
        outcome.feeds.push({ ...base, reason: "no source served a price" });
        continue;
      }

      let answer: bigint;
      try {
        answer = scaleToDecimals(obs.priceStr, obs.expo, t.decimals);
      } catch (err) {
        outcome.feeds.push({ ...base, status: "failed", reason: (err as Error).message });
        continue;
      }

      const observedAge = Math.max(0, blockTime - obs.publishTime);
      if (observedAge > t.bound) {
        /* Pushing this lands a price that reverts on the bound anyway. The
           publishers this source aggregates are stale for the asset, which a
           keeper cannot fix. */
        outcome.feeds.push({
          ...base,
          source: obs.source,
          observedAt: obs.publishTime,
          reason: `the freshest ${obs.source} has is ${observedAge}s old, already over the ${t.bound}s bound`,
        });
        continue;
      }

      /* `observedAt` must be strictly newer than what the feed holds — the feed
         rejects anything else as a replay (PushablePriceFeed._validate). On a
         schedule tighter than the source's own update interval this is the normal
         case, not an error, and it is why a run can cost no gas at all. */
      if (obs.publishTime <= t.updatedAt) {
        outcome.feeds.push({
          ...base,
          source: obs.source,
          observedAt: obs.publishTime,
          reason: `${obs.source} has published nothing newer than the stored answer (${t.updatedAt})`,
        });
        continue;
      }

      /* Dry-run the deviation guard rather than discovering it in a reverted
         transaction. A rejection is the guard working: either a units bug here
         or a real move after an outage, and a keeper must not decide which. */
      if (t.maxDeviationBps !== 0n && t.prevAnswer > 0n) {
        const dev = deviationBps(t.prevAnswer, answer);
        if (dev > t.maxDeviationBps) {
          outcome.feeds.push({
            ...base,
            source: obs.source,
            observedAt: obs.publishTime,
            answer: answer.toString(),
            deviationBps: Number(dev),
            reason:
              `${dev} bps from the stored ${t.prevAnswer} exceeds the feed's ` +
              `${t.maxDeviationBps} bps guard. An owner re-baselines ONCE with ` +
              "forceAnswer if the move is real; do not loosen the guard to make a push land",
          });
          continue;
        }
        base.deviationBps = Number(dev);
      }

      /* Clamp to block time: the feed rejects a future stamp because the facet
         underflows ageing one, taking every priced operation offline until a
         later block passes it. */
      const observedAt = Math.min(obs.publishTime, blockTime);

      if (dryRun) {
        /* Everything above is a read, and everything that could refuse this push
           has already had its say. The only thing left out is the transaction. */
        outcome.feeds.push({
          ...base,
          status: "would-push",
          answer: answer.toString(),
          usd: Number(answer) / 10 ** t.decimals,
          observedAt,
          source: obs.source,
        });
        continue;
      }

      try {
        const tx: ethers.ContractTransactionResponse = await serialise(
          chainId,
          () => t.feed.pushAnswer(answer, observedAt),
        );
        let confirmed = false;
        try {
          confirmed = (await tx.wait(1)) !== null;
        } catch {
          /* The send happened. A wait that fails is a client-side event that says
             nothing about whether the transaction landed, so this is reported as
             sent-unconfirmed rather than failed. */
        }
        outcome.feeds.push({
          ...base,
          status: "pushed",
          answer: answer.toString(),
          usd: Number(answer) / 10 ** t.decimals,
          observedAt,
          source: obs.source,
          txHash: tx.hash,
          confirmed,
        });
      } catch (err) {
        outcome.feeds.push({
          ...base,
          status: "failed",
          answer: answer.toString(),
          observedAt,
          source: obs.source,
          reason:
            (err as { shortMessage?: string })?.shortMessage ??
            (err as Error).message,
        });
      }
    }

    const pushed = outcome.feeds.filter((f) => f.status === "pushed").length;
    const wouldPush = outcome.feeds.filter((f) => f.status === "would-push").length;
    outcome.status =
      pushed > 0 ? "pushed" : wouldPush > 0 ? "dry-run" : "nothing-to-do";
    return outcome;
  } catch (err) {
    outcome.status = "error";
    /* Named, not raw: an RPC error carries the endpoint URL and a signing failure
       can carry signer detail. Same reasoning as /api/gas-drip. */
    outcome.error =
      (err as { shortMessage?: string })?.shortMessage ?? (err as Error).message;
    console.error(`[keeper/pushFeeds] ${network} failed`, err);
    return outcome;
  } finally {
    /* A serverless invocation can be frozen rather than torn down, and a live
       provider holds a socket and a poller across the freeze. */
    provider.destroy();
  }
}

/**
 * Refresh every chain that self-hosts its feeds.
 *
 * Chains run concurrently — they share no nonce and no rate limit — so one slow
 * endpoint does not decide the whole run's duration. `pushChainFeeds` resolves
 * rather than throws, so one dead chain cannot take the others down.
 */
export async function pushSelfHostedFeeds(
  options: PushOptions = {},
): Promise<PushResult> {
  const chainIds = options.chainIds?.length
    ? options.chainIds
    : [...SELF_HOSTING_CANDIDATE_CHAINS];

  const chains = await Promise.all(
    chainIds.map((chainId) => pushChainFeeds(chainId, options)),
  );

  let pushed = 0;
  let wouldPush = 0;
  let failed = 0;
  for (const c of chains) {
    for (const f of c.feeds) {
      if (f.status === "pushed") pushed += 1;
      if (f.status === "would-push") wouldPush += 1;
      if (f.status === "failed") failed += 1;
    }
    if (c.status === "error") failed += 1;
  }

  return { chains, pushed, wouldPush, failed };
}
