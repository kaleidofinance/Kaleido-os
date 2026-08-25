/**
 * Pyth price-feed ids, and the machinery for proving one is what it claims.
 *
 * Feed ids are GLOBAL. The same ETH/USD id is used on Ethereum, Base, BNB and
 * every other chain Pyth supports — only the Pyth *contract address* is
 * per-chain. That is why this table is not chain-keyed and why
 * contracts/utils/constants/constant.sol deliberately no longer carries these
 * as Solidity constants: they are not per-chain, but the token addresses they
 * pair with are, so both belong at the registration call site.
 *
 * ── Provenance, and why it matters ─────────────────────────────────────────
 *
 * A wrong feed id is the worst kind of wrong value in this protocol. It does
 * not revert. `addCollateralToken(token, feedId)` stores whatever bytes32 it is
 * given, and if those bytes happen to name a real but different feed, the
 * protocol will price that collateral off the wrong asset — permanently, for
 * every health-factor check and every liquidation, until someone notices the
 * numbers are wrong. Registering ETH's id against USDC would value one USDC at
 * several thousand dollars and let a borrower drain the pool.
 *
 * So each entry below records where its id came from, and nothing gets
 * registered on the strength of the table alone:
 *
 *   source: "repo"   the id is already declared in this repository, in
 *                    contracts/utils/oracle/PythPriceOracle.sol, and has been
 *                    read from there. Also confirmed against Hermes below.
 *   source: "hermes" confirmed against Pyth's own live feed registry by calling
 *                    HermesClient.getPriceFeeds({assetType:"crypto"}) and
 *                    matching id -> attributes.symbol. Every id in this table
 *                    was checked that way on 2026-08-20 against the 585 crypto
 *                    feeds Hermes then listed, and all eight matched their
 *                    declared symbol. Re-run the check with
 *                    `npm run probe:pyth` rather than trusting this note.
 *
 * `verifyFeed` below is what turns either into a fact, and it is called before
 * every registration:
 *
 *   1. On-chain — `pyth.getPriceUnsafe(id)` against the real Pyth contract on
 *      the target chain. Pyth reverts with PriceFeedNotFound for an id it does
 *      not carry, so this proves the id exists *and* that this chain serves it.
 *   2. Off-chain — Hermes is asked what symbol that id belongs to. This is the
 *      check that catches a plausible-but-wrong id: one that exists, so step 1
 *      passes, but names a different asset.
 *
 * Step 2 needs outbound HTTPS to hermes.pyth.network. Where that is
 * unavailable the caller may skip it, and every id in the table has already
 * been through it once (see "hermes" above) — but an id supplied by
 * FEED_<SYMBOL> has not, so the callers say so loudly rather than quietly
 * continuing.
 */

const HERMES_ENDPOINT = process.env.HERMES_ENDPOINT || "https://hermes.pyth.network";

/**
 * @typedef {Object} Feed
 * @property {string} symbol   Pyth's own symbol for the feed, e.g. "Crypto.ETH/USD".
 * @property {string} id       32-byte feed id, 0x-prefixed.
 * @property {"repo"|"hermes"|"override"} source Where the id in this file came from.
 */

/** @type {Record<string, Feed>} keyed by the token symbol we register it against. */
const FEEDS = {
  /* Read from PythPriceOracle.sol:11 (`ethPriceId`). Also the feed used by
   * getEthLatestPrice(), so it is exercised by the oracle's own probe. */
  ETH: {
    symbol: "Crypto.ETH/USD",
    id: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    source: "repo",
  },
  /* WETH is priced off ETH/USD. Pyth publishes no separate WETH feed, and one
   * would be redundant — WETH is redeemable 1:1 by contract, not by market. */
  WETH: {
    symbol: "Crypto.ETH/USD",
    id: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    source: "repo",
  },
  /* Read from PythPriceOracle.sol:12 (`usdcPriceId`). */
  USDC: {
    symbol: "Crypto.USDC/USD",
    id: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    source: "repo",
  },
  /* Wrapped USDC, which exists because Arc Testnet's native currency IS USDC and
   * so its wrapped native is a wrapped dollar rather than a wrapped ether. Priced
   * off USDC/USD for exactly the reason WETH is priced off ETH/USD: the wrapper is
   * redeemable 1:1 by contract, not by market. That is measured rather than
   * assumed here — depositing 0.01 native into Arc's canonical WUSDC
   * (0x911b4000D3422F482F4062a913885f7b035382Df) minted 0.01e18 and withdraw()
   * returned it.
   *
   * Pyth publishes no WUSDC feed and should not: there is nothing for a market to
   * price. An entry pointing at some other dollar feed would be the mistake the
   * provenance rules at the top of this file exist to prevent. */
  WUSDC: {
    symbol: "Crypto.USDC/USD",
    id: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    source: "repo",
  },
  USDT: {
    symbol: "Crypto.USDT/USD",
    id: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
    source: "hermes",
  },
  USDE: {
    symbol: "Crypto.USDE/USD",
    id: "0x6ec879b1e9963de5ee97e9c8710b742d6228252a5e2ca12d4ae81d7fe5ee8c5d",
    source: "hermes",
  },
  BNB: {
    symbol: "Crypto.BNB/USD",
    id: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
    source: "hermes",
  },
  BTC: {
    symbol: "Crypto.BTC/USD",
    id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    source: "hermes",
  },
  WBTC: {
    symbol: "Crypto.WBTC/USD",
    id: "0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33",
    source: "hermes",
  },
};

/**
 * kfUSD and kafUSD have no Pyth feed and never will — they are our own tokens,
 * and Pyth publishes what exchanges trade.
 *
 * This is not an oversight to be worked around by pointing them at USDC/USD.
 * kfUSD is a yield-bearing claim whose value is a function of the treasury, not
 * a dollar peg, and kafUSD wraps it. Pricing either off USDC would tell the
 * lending facet that a share of an appreciating vault is worth exactly one
 * dollar, which is wrong in whichever direction the vault has moved.
 *
 * So they are deliberately NOT registered as collateral or loanable assets in
 * this wave. Doing it properly needs an oracle that reads the vault's own
 * exchange rate, which does not exist yet. Note that registry.ts's
 * BORROW_CURRENCIES still lists kfUSD — that table is a frontend list and does
 * not imply the facet accepts it; a borrow against kfUSD reverts today with
 * Protocol__TokenNotAllowed, which is the correct behaviour and not a bug to
 * "fix" by registering a wrong feed.
 */
const NO_FEED = {
  KFUSD: "yield-bearing claim on YieldTreasury; needs a vault-rate oracle, not a Pyth feed",
  KAFUSD: "wraps kfUSD; same problem, one layer out",
  KLD: "no market and no Pyth feed; staking is out of scope this wave",
  STKLD: "wraps KLD; same",
};

/**
 * ── Per-chain staleness bounds, for the Pyth backend ───────────────────────
 *
 * The ids above are global; these are not, and that difference is the whole
 * reason this is a second table rather than a `maxAge` field on the entries
 * above. A feed id names an asset, and the asset is the same everywhere. How
 * recently that id was last *relayed on-chain* is a property of one chain's
 * relayers, and on a testnet it varies by five orders of magnitude between feeds
 * sitting on the same Pyth contract.
 *
 * Measured on Arc Testnet (5042002) 2026-08-21, every figure from one run of
 * `npx hardhat run scripts/probe-pyth.js --network arcTestnet`:
 *
 *     ETH/USD              4s
 *     BTC/USD              4s
 *     BNB/USD            349s
 *     USDC/USD        58,510s   (16h 15m)
 *     USDT/USD     8,375,146s   (97 days)
 *     USDE/USD     8,375,146s   (97 days)
 *     WBTC/USD     not served
 *
 * Arc's native currency IS USDC, so the asset every borrower on that chain posts
 * as collateral has the stalest priced feed on it. This is not a peripheral asset
 * going quiet.
 *
 * ── What those numbers are NOT ─────────────────────────────────────────────
 *
 * Read them as one chain's RELAY history, not as what Pyth publishes. Every id in
 * that table — including WBTC, the one marked "not served" — is served by Hermes
 * at 1s (measured 2026-08-22: USDT $0.999750, USDE $0.999837, WBTC $77,305.83,
 * USDC $0.999983, all 1s old). Pyth's publishers are healthy for all of them.
 * What Arc lacks is anything relaying them on-chain.
 *
 * That distinction is easy to lose, and losing it produced two wrong conclusions
 * that used to be recorded here as facts:
 *
 *   1. "USDC's 58,510s leaves 31,490s of headroom under the 90,000s ceiling."
 *      No. Re-measured 2026-08-22 at 102,608s and again ~18 minutes later at
 *      103,683s — the age grows one second per second, which is what an
 *      unrelayed feed looks like. An unrelayed age has no upper bound, so no
 *      fixed bound has headroom over it. See the USDC entry.
 *
 *   2. "USDT/USDE cannot be bounded legally, so the token must not be
 *      registered." That followed from the 97-day age, and the 97-day age is a
 *      consequence of nobody relaying rather than a property of the asset. A push
 *      makes the on-chain age seconds old, after which a TIGHT bound is legal.
 *      They are excluded now by operational choice, not impossibility.
 *
 * Because this is a PULL oracle, "this chain does not serve this feed" is not a
 * property of the chain either: `updatePriceFeeds` writes the price for every id
 * in a verified batch whether or not the receiver has held that id before, so
 * relaying a Hermes blob CREATES the feed. Confirmed against Arc's receiver at
 * 0x2880aB155794e7179c9eE2e38200202908C17B43 — see the WBTC entry.
 *
 * So the question a bound answers is not "does this chain have the feed" but
 * "who keeps it fresh, and how often". scripts/push-prices.js is the answer for
 * Arc; nothing schedules it yet.
 *
 * Why this table has to exist at all: without it every Arc feed is judged against
 * the global PRICE_MAX_AGE_SECONDS (300), because register-tokens.js only seeded
 * `setFeedMaxAge` from the *aggregator* table and there was no Pyth equivalent to
 * read. So `_priceScaled18` would revert on every deposit, borrow, health-factor
 * read and liquidation touching USDC, while `addCollateralToken` reported success
 * — it does no priced read. A silent bound of 300s on a 16-hour feed is the exact
 * failure the aggregator table was built to prevent, reached by the other door.
 *
 * `maxAge: null` means the feed cannot be bounded legally AS THINGS STAND, so the
 * token must not be registered. Constants.MAX_FEED_PRICE_AGE is 90,000s and
 * `setFeedMaxAge` reverts Protocol__InvalidPriceBounds above it, so there is no
 * value that turns a 97-day-old price into a working market. The refusal is still
 * correct and still harder than the warning a merely-stale feed gets — but it is
 * conditional on the current relay state, and pushing changes that state. Do not
 * read null as "this asset can never be priced here"; read it as "not until
 * something relays it, and then only at a bound tight enough to depend on that
 * relaying continuing".
 *
 * A symbol with no entry inherits the global bound, which is the right answer for
 * a chain whose feeds are all warm — the table is for exceptions, not inventory.
 */

/**
 * @typedef {Object} PythBound
 * @property {number|null} maxAge   Bound to install via setFeedMaxAge, seconds.
 *                                  null = cannot be bounded, do not register.
 * @property {number|null} observedAgeSeconds  One measurement, not an interval.
 * @property {string} basis         How maxAge was derived. Read this before changing it.
 */

/** @type {Record<number, Record<string, PythBound>>} chainId -> token symbol -> bound */
const PYTH_BOUNDS = {
  /* ── Arc Testnet ─────────────────────────────────────────────────────────
   * The only chain on the Pyth backend (see ORACLE_BACKEND in
   * scripts/libraries/aggregator-feeds.js — the other four read Chainlink or
   * API3), and therefore the only chain these bounds apply to today. */
  5042002: {
    ETH: {
      maxAge: 600,
      observedAgeSeconds: 4,
      basis:
        "Relayed at 4s when measured, so 600 is roughly 150 missed rounds of " +
        "slack. Written explicitly rather than left to inherit the identical-in- " +
        "spirit global 300s, because the global is one knob for every feed: " +
        "raising PRICE_MAX_AGE_SECONDS to help a pegged asset would silently " +
        "loosen ETH along with it, and a per-feed bound pins a volatile asset " +
        "where it was put. 600s is still a bad basis for a liquidation and is a " +
        "testnet figure; the reason it is tolerable is that it fails closed.",
    },
    WETH: {
      maxAge: 600,
      observedAgeSeconds: 4,
      basis: "Same feed id as ETH — WETH is redeemable 1:1 by contract, not by market.",
    },
    USDC: {
      maxAge: 90000,
      observedAgeSeconds: 103683,
      basis:
        "90,000 is Constants.MAX_FEED_PRICE_AGE, the ceiling — there is no legal " +
        "value above it, so this is the loosest bound the contract permits.\n" +
        "This entry used to justify that number as leaving '31,490s of headroom' " +
        "over a 58,510s observation. Three measurements later that framing is " +
        "wrong, and how it is wrong matters more than the number:\n" +
        "    2026-08-21           58,510s\n" +
        "    2026-08-22 08:5x    102,608s   (register-tokens.js)\n" +
        "    2026-08-22 09:1x    103,683s   (push-prices.js, ~18 min later)\n" +
        "The age grew by ~1,075s across an ~18-minute gap — one second per second. " +
        "This feed is not slow, it is UNRELAYED: nothing on Arc has published " +
        "Crypto.USDC/USD since before the first measurement, so its age has no " +
        "upper bound and no fixed bound can cover it. It had already passed 90,000 " +
        "by the second measurement, which is the moment the original justification " +
        "stopped holding.\n" +
        "The failure is Arc-local, and that is the useful part: Hermes serves this " +
        "exact id at 3s old (measured in the same push-prices.js run). Pyth's " +
        "publishers are healthy; Arc has no relayer for this feed. So the repair is " +
        "relaying, not a different price source — scripts/push-prices.js took it " +
        "from 103,683s to 7s for 1 wei of fee, and Arc's Pyth receiver accepted the " +
        "update, which also proves its guardian set is current.\n" +
        "So read 90,000 as a CEILING WE MUST KEEP THE FEED UNDER, not as a " +
        "description of how the feed behaves. It is defensible only because " +
        "updatePrice is permissionless — anyone, including a borrower's own " +
        "transaction, can restore it. Without something pushing on a schedule " +
        "tighter than 90,000s, every priced operation on Arc's native dollar " +
        "reverts. Do not copy this number onto a volatile feed: on a pegged asset a " +
        "day-old answer is wrong by basis points, and Sepolia's Chainlink USDC/USD " +
        "carries the same figure for that reason. On a volatile one it is a gift to " +
        "a liquidator.",
    },
    BTC: {
      maxAge: 600,
      observedAgeSeconds: 4,
      basis: "Same relayer cadence as ETH/USD on this chain, measured in the same run.",
    },
    /* Arc's canonical wrapped native, 0x911b4000…82Df. Same feed and therefore the
     * same bound as USDC above — pythBoundPlanFor dedupes by id, so the two entries
     * install one bound, and giving them different numbers would be the conflict its
     * guard throws on.
     *
     * Worth stating why this shares USDC's uncomfortable 90,000s rather than getting
     * a tighter one: the bound is a property of the FEED, not of the token. WUSDC
     * being a well-behaved 1:1 wrapper says nothing about how often Arc's relayers
     * publish Crypto.USDC/USD, and that is the only number in play. */
    WUSDC: {
      maxAge: 90000,
      observedAgeSeconds: 103683,
      basis:
        "Same Crypto.USDC/USD feed as native USDC, so the same dead relayer and the " +
        "same ceiling bound. See the USDC entry for the three measurements that " +
        "prove the feed is unrelayed rather than slow, and for why 90,000 is a " +
        "ceiling to be kept under by pushing rather than headroom over an " +
        "observation. Must not be copied onto a volatile feed.",
    },
    USDT: {
      maxAge: null,
      observedAgeSeconds: 8421322,
      basis:
        "UNREGISTERED BY CHOICE, not by impossibility. The distinction matters " +
        "because this entry used to claim the latter, and acting on that claim " +
        "would mean never revisiting it.\n" +
        "What is true: 8,421,322s (97 days) is 93x MAX_FEED_PRICE_AGE, so no legal " +
        "bound covers the age this feed CURRENTLY shows — setFeedMaxAge reverts " +
        "Protocol__InvalidPriceBounds for any value that would. What is false is the " +
        "conclusion that was drawn from it: that age is a relay history, not a " +
        "property of the asset or of the chain. Hermes serves Crypto.USDT/USD at 1s " +
        "($0.999750, measured 2026-08-22), and scripts/push-prices.js relayed it here " +
        "for 1 wei of fee: 8,421,322s -> 15s, tx 0x21171480…64651f, block 58274081. " +
        "A tight bound is legal the moment anything pushes.\n" +
        "So the reason to leave it unregistered is a KEEPER BUDGET, not a ceiling. " +
        "USDC's 90,000s survives a pusher that runs daily; a dollar feed bounded at " +
        "600s needs one every few minutes, and on a chain with no relayer at all that " +
        "is our cron or nothing. Registering is irreversible — nothing removes a " +
        "loanable token — so the order is: schedule the pusher, prove it holds, THEN " +
        "set a bound from a post-push age and register. deploy-stablecoin.js still " +
        "mints USDT here meanwhile; it is tradable on the DEX, just not borrowable.\n" +
        "Do NOT close the gap by pointing USDT's id at USDC/USD: verifyFeed asks " +
        "Hermes what the id actually names and refuses the mismatch, correctly.",
    },
    USDE: {
      maxAge: null,
      observedAgeSeconds: 8421322,
      basis:
        "Identical to USDT on this chain, to the second — the same absent relayer, " +
        "and pushed in the same transaction (8,421,322s -> 15s). Hermes serves " +
        "Crypto.USDE/USD at 1s, $0.999837. See the USDT entry: excluded on keeper " +
        "cadence, not because no legal bound exists.",
    },
    WBTC: {
      maxAge: null,
      observedAgeSeconds: null,
      basis:
        "Arc's Pyth receiver had never held this feed — getPriceUnsafe reverted " +
        "PriceFeedNotFound. That is what 'never populated' means on a PULL oracle, " +
        "and it is NOT the same as 'not served by Pyth on this chain', which is what " +
        "this entry used to say.\n" +
        "Measured, not reasoned: updatePriceFeeds writes latestPriceInfo for every id " +
        "in a verified batch with no prior-existence requirement, so relaying a " +
        "Hermes blob CREATES the feed. Confirmed on 2026-08-22 — one push through " +
        "scripts/push-prices.js took Crypto.WBTC/USD from unserved to 15s old on the " +
        "receiver at 0x2880aB155794e7179c9eE2e38200202908C17B43 (tx 0x21171480…64651f, " +
        "gas 302,953 for three feeds). Hermes serves it at 1s, $77,305.83.\n" +
        "It stays unregistered for the reason in the USDT entry plus a harder one: it " +
        "is the only VOLATILE asset of the three, so it cannot take USDC's loose " +
        "bound, and a bitcoin price bounded at 600s on a chain with no relayer means " +
        "our pusher is the sole thing standing between a liquidation and a stale " +
        "print. verifyFeed will still refuse it while the receiver is empty, which is " +
        "correct — a feed that only exists because we pushed it once is not a feed.",
    },
  },
};

/**
 * The bound recorded for one token symbol on one chain, or null if none is.
 *
 * Null means "inherit the global bound" and is not an error — most feeds on a
 * healthy chain need no override. A record with `maxAge: null` is the opposite: a
 * deliberate refusal, which the caller must treat as "do not register this token".
 * Read that refusal as being about the feed's CURRENT relay state rather than
 * about the asset — on a pull oracle an unrelayed feed is repairable by pushing,
 * so a null is a decision that can be revisited once a keeper exists, not a
 * permanent verdict. Each entry's `basis` says which it is.
 */
function pythBoundFor(chainId, symbol) {
  const bound = PYTH_BOUNDS[chainId]?.[symbol.toUpperCase()];
  return bound ? { ...bound } : null;
}

/**
 * Every installable bound for a chain, deduplicated by feed id.
 *
 * Keyed by id rather than symbol because that is how `s_feedMaxAge` is keyed:
 * ETH and WETH share one id, so they are one bound, and two entries asking for
 * different values is a table bug that can only half-apply. Throwing here catches
 * it before any transaction is sent rather than after the first of two.
 *
 * Resolves through `feedFor` so that a `FEED_<SYMBOL>` override is respected —
 * reading `FEEDS[symbol].id` directly would install the bound on the table's id
 * while the token was registered against the overridden one, leaving the override
 * silently unbounded.
 */
function pythBoundPlanFor(chainId) {
  const table = PYTH_BOUNDS[chainId];
  if (!table) return [];

  const byId = new Map();
  for (const [symbol, bound] of Object.entries(table)) {
    /* null (unboundable) and 0 (inherit the global) both mean "write nothing".
     * They differ for the caller deciding whether to register the token, not
     * here. */
    if (!bound.maxAge) continue;

    const feed = feedFor(symbol);
    const prior = byId.get(feed.id);
    if (prior && prior.maxAge !== bound.maxAge) {
      throw new Error(
        `PYTH_BOUNDS[${chainId}] gives feed ${feed.id.slice(0, 10)}… two ` +
          `different bounds: ${prior.symbols.join("/")} at ${prior.maxAge}s and ` +
          `${symbol} at ${bound.maxAge}s. s_feedMaxAge is keyed by feed id, not ` +
          "by token, so these cannot both hold. Reconcile them in " +
          "scripts/libraries/pyth-feeds.js.",
      );
    }
    byId.set(feed.id, {
      id: feed.id,
      symbol: feed.symbol,
      maxAge: bound.maxAge,
      maxAgeBasis: bound.basis,
      symbols: [...(prior?.symbols || []), symbol],
    });
  }
  return [...byId.values()];
}

/**
 * Resolve a feed for a token symbol, honouring an env override.
 *
 * The override exists so a wrong literal in this file can never block a deploy:
 * FEED_USDT=0x... takes precedence and is verified exactly the same way. Its
 * provenance is "override" rather than "hermes" no matter what it contains —
 * being typed by an operator is not corroboration, and unlike the table entries
 * it has not been through the symbol check.
 */
function feedFor(symbol) {
  const key = symbol.toUpperCase();

  const override = (process.env[`FEED_${key}`] || "").trim();
  if (override) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(override)) {
      throw new Error(
        `FEED_${key} is not a 32-byte hex id: ${override}\n` +
          "Pyth feed ids are 32 bytes (66 characters including 0x).",
      );
    }
    return {
      symbol: FEEDS[key]?.symbol ?? `(unknown symbol for ${key})`,
      id: override.toLowerCase(),
      source: "override",
      overridden: true,
    };
  }

  if (NO_FEED[key]) {
    throw new Error(`${symbol} has no Pyth feed by design: ${NO_FEED[key]}`);
  }

  const feed = FEEDS[key];
  if (!feed) {
    throw new Error(
      `No Pyth feed recorded for ${symbol}.\n` +
        `Add it to scripts/libraries/pyth-feeds.js, or pass FEED_${key}=0x... ` +
        "for a one-off.\n" +
        `Known: ${Object.keys(FEEDS).join(", ")}`,
    );
  }
  return { ...feed };
}

/**
 * Ask Hermes which symbol a feed id belongs to.
 *
 * Returns a Map of lowercase 0x-prefixed id -> symbol, or null if Hermes could
 * not be reached. Null is distinguishable from "id not found" on purpose: the
 * caller must be able to tell "Pyth says this is the wrong asset" (refuse) from
 * "we could not ask" (warn).
 *
 * One request for the whole crypto feed list rather than one per id — the list
 * is a few hundred KB and this runs once per deploy.
 */
async function fetchHermesSymbols() {
  try {
    const { HermesClient } = require("@pythnetwork/hermes-client");
    const client = new HermesClient(HERMES_ENDPOINT, { timeout: 20000 });
    const feeds = await client.getPriceFeeds({ assetType: "crypto" });
    const map = new Map();
    for (const f of feeds) {
      /* Hermes returns ids unprefixed. */
      const id = f.id.startsWith("0x") ? f.id.toLowerCase() : `0x${f.id.toLowerCase()}`;
      map.set(id, f.attributes?.symbol || "(no symbol)");
    }
    return map;
  } catch (err) {
    console.warn(
      `   (could not reach Hermes at ${HERMES_ENDPOINT}: ${err.message})`,
    );
    return null;
  }
}

/**
 * Prove a feed id is real, live on this chain, and the asset it claims to be.
 *
 * @param {object}   opts
 * @param {object}   opts.pyth        ethers Contract bound to IPyth on the target chain.
 * @param {Feed}     opts.feed        as returned by feedFor().
 * @param {Map|null} opts.hermes      as returned by fetchHermesSymbols().
 * @param {number}   opts.blockTime   timestamp of the latest block, for staleness.
 * @returns {Promise<{ok: boolean, reasons: string[], warnings: string[], ageSeconds: number|null}>}
 */
async function verifyFeed({ pyth, feed, hermes, blockTime }) {
  const reasons = [];
  const warnings = [];
  let ageSeconds = null;

  /* 1. Does this chain's Pyth carry the feed? */
  try {
    const price = await pyth.getPriceUnsafe(feed.id);
    ageSeconds = blockTime - Number(price.publishTime);
    if (Number(price.price) <= 0) {
      reasons.push(`Pyth returned a non-positive price (${price.price})`);
    }
  } catch (err) {
    reasons.push(
      "Pyth on this chain does not serve this feed " +
        `(getPriceUnsafe reverted: ${err.shortMessage || err.message})`,
    );
    return { ok: false, reasons, warnings, ageSeconds };
  }

  /* 2. Is it the asset we think it is? */
  if (hermes) {
    const actual = hermes.get(feed.id.toLowerCase());
    if (!actual) {
      warnings.push(
        "Hermes does not list this id among crypto feeds — it may be a " +
          "non-crypto asset type, or the id may be wrong",
      );
    } else if (actual.toUpperCase() !== feed.symbol.toUpperCase()) {
      reasons.push(
        `Pyth calls this feed ${actual}, not ${feed.symbol}. ` +
          "Registering it would price the token off the wrong asset.",
      );
    }
  } else if (feed.source !== "repo") {
    warnings.push(
      `provenance is "${feed.source}" and Hermes was unreachable, so the id ` +
        "is trusted rather than verified — confirm it against Pyth's feed " +
        "list by hand before treating this registration as safe",
    );
  }

  return { ok: reasons.length === 0, reasons, warnings, ageSeconds };
}

module.exports = {
  FEEDS,
  NO_FEED,
  PYTH_BOUNDS,
  feedFor,
  pythBoundFor,
  pythBoundPlanFor,
  fetchHermesSymbols,
  verifyFeed,
  HERMES_ENDPOINT,
};
