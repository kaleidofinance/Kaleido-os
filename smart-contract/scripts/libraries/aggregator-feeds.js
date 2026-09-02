/**
 * Chainlink and API3 aggregator addresses, per chain, and the freshness bound
 * each one needs.
 *
 * This is the companion to pyth-feeds.js, for the three deploy targets where
 * Pyth is not a usable backend. It is chain-keyed and that table is not, which
 * is the whole difference between the two providers:
 *
 *   Pyth      one contract per chain, feed ids global. The id IS the asset.
 *   Chainlink one contract per feed per chain, no global id at all. The
 *   / API3    ADDRESS is the asset, and it differs on every chain.
 *
 * ── Why the bytes32 keys are still Pyth's ──────────────────────────────────
 *
 * `ProtocolFacet.s_priceFeeds[token]` is a bytes32, written by
 * `addCollateralToken(address,bytes32)`, and `_priceScaled18` passes it to
 * `oracle.getPrice(bytes32)`. That bytes32 is the protocol's only name for an
 * asset, so it has to exist on both backends — and Chainlink supplies no
 * candidate. Rather than invent a second identifier scheme (and then have to map
 * between them at every call site), AggregatorPriceOracle takes the Pyth feed id
 * as its lookup key and maps it to an aggregator address.
 *
 * The consequence worth stating: on an aggregator chain the Pyth id is a *label*,
 * not a data source. Nothing verifies that the aggregator at the other end of it
 * prices the same asset the id names — `verifyAggregatorFeed` below does that job,
 * by reading the aggregator's own `description()` and comparing it to the symbol,
 * because there is no equivalent of Hermes to ask.
 *
 * ── Provenance ─────────────────────────────────────────────────────────────
 *
 * Every address here was probed live on 2026-08-21: `getCode` non-empty,
 * `decimals()` and `description()` read back, and `latestRoundData()` called to
 * measure how old the answer was. The Chainlink addresses additionally match
 * Chainlink's published testnet feed list. The Robinhood API3 proxy answered
 * `decimals()` and `description()` but reverted on the data read, which is the
 * expected state for a dAPI whose Api3Market plan has not been bought — see the
 * note on chain 46630.
 *
 * `observedAgeSeconds` is a SINGLE measurement, not a heartbeat. It says the feed
 * was that old at one moment; the publisher's actual interval may be longer. So
 * `maxAge` is derived from the provider's documented update policy where one
 * exists, and from the observation plus generous slack where it does not — each
 * entry says which. Re-measure over a longer window before treating any of these
 * bounds as a mainnet risk parameter.
 */

const { FEEDS } = require("./pyth-feeds.js");

/**
 * Which oracle backend each chain gets.
 *
 * Not a preference — it follows from what each chain actually carries:
 *
 *   84532   Base Sepolia. Pyth is deployed and publishes ETH/USD every ~20s — and
 *           does NOT publish USDC/USD at all. Measured through our own deployed
 *           PythPriceOracle on 2026-08-21, sampling both feeds four times over a
 *           minute: ETH/USD settled to 20s with conf 4-5bps, while USDC/USD was
 *           310,163s old (3.6 days) and unmoving. A per-chain "Pyth publishes
 *           every ~90s" reading of this chain is an average across one live
 *           pusher and one absent one. Chainlink publishes both. See the 84532
 *           block below for why a per-feed bound could not rescue the Pyth path.
 *   5042002 Arc Testnet. Pyth deployed and, on the strength of one ETH/USD
 *           reading, "publishing every ~104s" — which is what this line used to
 *           say, and it is the same average-of-a-live-and-a-dead-pusher mistake
 *           the 84532 note above warns about. Measured per feed on 2026-08-21:
 *           ETH/USD 4s, BTC/USD 4s, BNB/USD 349s, USDC/USD 58,510s (16h 15m),
 *           USDT/USD and USDE/USD both 8,375,146s (97 days), WBTC/USD absent from
 *           the receiver entirely.
 *           Arc's NATIVE CURRENCY is USDC, so the asset every borrower here posts
 *           as collateral has the stalest priced feed on the chain.
 *           Still Pyth, for the reason Base Sepolia is not: a per-feed bound CAN
 *           rescue this one. 58,510s fits under Constants.MAX_FEED_PRICE_AGE
 *           (90,000) where Base Sepolia's 310,163s does not, so PYTH_BOUNDS in
 *           scripts/libraries/pyth-feeds.js can legally cover it and the two
 *           97-day feeds are simply refused registration. Chainlink has no
 *           deployment here to fall back to either way.
 *           Two corrections to the above, both from 2026-08-22 and both about what
 *           an age on a PULL oracle means. First, USDC/USD's 58,510s was not a
 *           cadence: re-measured at 102,608s and then 103,683s ~18 minutes later,
 *           it grows one second per second, so it fits under 90,000 only while
 *           something pushes it — see the USDC entry in pyth-feeds.js. Second,
 *           none of these numbers is a property of the chain. Hermes serves all
 *           three "hopeless" ids at 1s, and one run of scripts/push-prices.js took
 *           USDT and USDE from 8,421,322s to 15s and CREATED the WBTC feed the
 *           receiver had never held, for 3 wei total. So the choice recorded here
 *           still stands — Pyth on Arc, with a ceiling bound on the dollar — but it
 *           stands on "we can relay this", not on "these feeds are fine and those
 *           are impossible". No Chainlink fallback also means no alternative to
 *           relaying.
 *   11155111 Sepolia. Pyth's Sepolia feeds are not maintained on a schedule that
 *            fits any usable bound; Chainlink's are the reference feeds on that
 *            chain and every other testnet protocol reads them.
 *   97      BSC Testnet. Same reasoning; Chainlink is canonical on BNB.
 *   46630   Robinhood Chain Testnet. 0x2880aB…7B43 holds code here but it is NOT
 *           Pyth — `getValidTimePeriod()` reverts on it, so the address was
 *           copied between chains and happens to collide with something else.
 *           This line used to end "API3 is the only oracle with a deployment on
 *           this chain", which was the conclusion of a contract search and is
 *           misleading. Robinhood's own docs
 *           (docs.robinhood.com/chain/oracles-and-price-feeds) name CHAINLINK as
 *           the chain's oracle and name no one else — and they are right, for
 *           MAINNET. Chainlink's reference directory publishes 57 feeds for
 *           `robinhood-mainnet` and has no `robinhood-testnet` file at all
 *           (checked 2026-08-22: the mainnet URL answers 200, the testnet one
 *           404s, and Chainlink's docs show only a "Robinhood Chain Mainnet"
 *           network section). Chain 4663 feeds, all 8 decimals, 86400s heartbeat
 *           and a 0.5% deviation trigger:
 *               ETH / USD   0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9
 *               BTC / USD   0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251
 *               USDC / USD  0x9e6f4605992a899eE2999999F3Ec80C41F452546
 *               USDT / USD  0xbf3550B6fAe1671da7C238Af12e03Ac586BEf3B1
 *               LINK / USD  0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9
 *           plus ~40 tokenized-equity feeds (Robinhood GOOGL/USD, TSM/USD,
 *           QQQ/USD, COIN/USD …), which is the interesting part of this chain and
 *           not in scope this wave.
 *           So the API3 entry below is a TESTNET STAND-IN for a feed that does not
 *           exist on testnet, not the chain's oracle. Two consequences: a mainnet
 *           deploy must read the Chainlink proxies above and must NOT inherit the
 *           API3 addresses or their 18-decimal rescale, and the 86400s heartbeat
 *           means even mainnet needs a bound near MAX_FEED_PRICE_AGE — Chainlink
 *           here is not the ~1800s-heartbeat feed set that Sepolia and BSC have.
 */
const ORACLE_BACKEND = {
  11155111: "aggregator-v3",
  84532: "aggregator-v3",
  97: "aggregator-v3",
  46630: "aggregator-v3",
  5042002: "pyth",
};

/**
 * Pyth's own receiver contract, per chain.
 *
 * Only 5042002 still selects the Pyth backend. 84532's address is kept because it
 * was measured and is correct — Pyth really is deployed there and really does
 * serve ETH/USD — and because `ORACLE_BACKEND=pyth` is an env override that a
 * one-off deploy can pass. Deleting the address would make that override fail
 * with "no Pyth contract recorded" on a chain where the contract plainly exists,
 * which reads as a missing entry rather than a deliberate choice.
 */
const PYTH_CONTRACTS = {
  84532: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729",
  5042002: "0x2880aB155794e7179c9eE2e38200202908C17B43",
};

/**
 * @typedef {Object} Aggregator
 * @property {string} aggregator        Feed contract address on this chain.
 * @property {"chainlink"|"api3"} provider
 * @property {number} decimals          As reported by `decimals()`, measured.
 * @property {number|null} observedAgeSeconds  One measurement, 2026-08-21.
 * @property {number} maxAge            Bound to install via setFeedMaxAge, seconds.
 * @property {string} maxAgeBasis       How maxAge was derived. Read this before changing it.
 * @property {string} descriptionHint   Substring expected in `description()`.
 */

/** @type {Record<number, Record<string, Aggregator>>} chainId -> token symbol -> feed */
const AGGREGATORS = {
  /* ── Sepolia ─────────────────────────────────────────────────────────────
   * The chain that forced per-feed bounds to exist. ETH/USD measured 1,594s old
   * and USDC/USD 13,438s in the same block — an 8x spread. One global bound
   * cannot cover both: loose enough for USDC means accepting a four-hour-old ETH
   * price to liquidate against, and tight enough for ETH means USDC never prices
   * and /borrow is dead on the chain. */
  11155111: {
    ETH: {
      aggregator: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 1594,
      maxAge: 5400,
      maxAgeBasis:
        "Chainlink's Sepolia ETH/USD heartbeat is 1 hour (3600s) with a 1% " +
        "deviation trigger; 5400 is that plus 30 minutes of slack for a testnet " +
        "publisher that is not SLA-backed. This is LOOSE for a volatile asset " +
        "and is a testnet-only figure: a 90-minute-old ETH price is a bad basis " +
        "for a liquidation. The alternative on this chain is no lending at all. " +
        "Base Sepolia's ETH/USD is on a 1200s heartbeat and bounded at 1800 — " +
        "compare against that, not against this.",
      descriptionHint: "ETH / USD",
    },
    WETH: {
      aggregator: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 1594,
      maxAge: 5400,
      maxAgeBasis: "Same contract as ETH — WETH is redeemable 1:1 by contract, not by market.",
      descriptionHint: "ETH / USD",
    },
    USDC: {
      aggregator: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 13438,
      maxAge: 90000,
      maxAgeBasis:
        "Observed 13438s (3h44m), which already exceeds the 3600s ceiling on the " +
        "GLOBAL bound — this feed is the reason Constants.MAX_FEED_PRICE_AGE " +
        "exists. Chainlink's documented heartbeat for it is 86400s, and this was " +
        "86400 to match; raised to 90000 because a bound equal to the heartbeat " +
        "leaves no room for a late publish, and Base Sepolia's identically " +
        "configured USDT/USD was caught at 70,702s, proving these 24h feeds do run " +
        "close to their limit. 90000 is MAX_FEED_PRICE_AGE, the ceiling. " +
        "Defensible here and on the other pegged feeds only: USDC is pegged, so a " +
        "day-old answer is wrong by basis points rather than by percent. Do not " +
        "copy this number onto a volatile feed to stop it reverting.",
      descriptionHint: "USDC / USD",
    },
    BTC: {
      aggregator: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 5400,
      maxAgeBasis: "Same publisher policy as Sepolia ETH/USD. Age not measured; assumed equal.",
      descriptionHint: "BTC / USD",
    },
  },

  /* ── Base Sepolia ────────────────────────────────────────────────────────
   * The chain that was on the Pyth backend until its Pyth USDC feed was measured.
   *
   * Pyth is deployed here (0xA2aa501b…B5729) and ETH/USD is genuinely good on it:
   * 20s old, confidence 4-5bps against our 100bps bound. USDC/USD on the same
   * contract was 310,163s old — 3.6 days — and did not move across a minute of
   * sampling. Base Sepolia's Pyth has an ETH pusher and no USDC pusher.
   *
   * A per-feed bound cannot cover that, which is the point worth recording:
   * 310,163s is 3.4x Constants.MAX_FEED_PRICE_AGE (90,000), so
   * `setFeedMaxAge(USDC_USD, 310163)` reverts Protocol__InvalidPriceBounds. The
   * mechanism that rescues Sepolia's 13,438s Chainlink feed is not available at
   * this magnitude. That left three options: run a cron calling
   * PythPriceOracle.updatePrice forever, drop USDC from the chain's lending
   * assets (which is /borrow and all of kfUSD), or read Chainlink, which
   * maintains both feeds itself. Chainlink.
   *
   * What the switch costs, stated because it is a security property and not a
   * detail: AggregatorPriceOracle returns conf = 0, so PRICE_MAX_CONF_BPS is
   * inert on this chain, and ETH freshness goes from Pyth's ~20s to a 1200s
   * heartbeat. Both are worse than the Pyth path for ETH alone. Neither is worse
   * than USDC not pricing at all. A composite oracle reading Pyth for ETH and
   * Chainlink for USDC would keep both — it is the mainnet answer if the
   * confidence bound has to mean something, and it is a third contract to write
   * and verify for a testnet gain.
   *
   * USDe has no Chainlink feed on this chain, so the USDe that deploy-stablecoin.js
   * mints cannot be registered here — the same gap as on Sepolia, not new. Do not
   * close it by pointing USDe's feed id at USDC/USD: verifyAggregatorFeed's
   * description() check refuses it, correctly, since a synthetic dollar tracking
   * its own market is not USDC. */
  84532: {
    ETH: {
      aggregator: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 42,
      maxAge: 1800,
      maxAgeBasis:
        "Chainlink publishes this feed on a documented 1200s heartbeat with a " +
        "0.15% deviation trigger, and it measured 42s old — so the deviation " +
        "trigger, not the heartbeat, is what fires in practice. 1800 is the " +
        "heartbeat plus 50%. Tighter than Sepolia's 5400 because the heartbeat " +
        "here is 1200s rather than 3600s, which makes this the best ETH bound in " +
        "the wave and the one to compare the others against.",
      descriptionHint: "ETH / USD",
    },
    WETH: {
      aggregator: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 42,
      maxAge: 1800,
      maxAgeBasis: "Same contract as ETH — WETH is redeemable 1:1 by contract, not by market.",
      descriptionHint: "ETH / USD",
    },
    USDC: {
      aggregator: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 25526,
      maxAge: 90000,
      maxAgeBasis:
        "Documented heartbeat is exactly 86400s. 90000 rather than 86400 because " +
        "a bound equal to the heartbeat has zero tolerance for a late publish, and " +
        "these feeds demonstrably do run to the full heartbeat: the sibling " +
        "USDT/USD on this chain measured 70,702s (19h39m) in the same block. A " +
        "bound of 86400 would price USDC correctly almost always and revert every " +
        "deposit and health-factor read for the minutes around a late round, which " +
        "is the intermittent failure that is hardest to diagnose. 90000 equals " +
        "Constants.MAX_FEED_PRICE_AGE — this is the ceiling, there is no more " +
        "slack available, and it is only defensible because USDC is pegged.",
      descriptionHint: "USDC / USD",
    },
    USDT: {
      aggregator: "0x3ec8593F930EA45ea58c968260e6e9FF53FC934f",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 70702,
      maxAge: 90000,
      maxAgeBasis:
        "Same 86400s heartbeat and same reasoning as USDC on this chain. This is " +
        "the feed that measured 70,702s old and so supplied the evidence for both " +
        "bounds. Registering the USDT that deploy-stablecoin.js mints needs this " +
        "entry; Sepolia has no USDT/USD feed, so USDT is registerable here and not " +
        "there.",
      descriptionHint: "USDT / USD",
    },
    BTC: {
      aggregator: "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 98,
      maxAge: 1800,
      maxAgeBasis:
        "1200s heartbeat and 0.1% deviation trigger, measured 98s old. Same " +
        "derivation as ETH on this chain. No token is registered against it yet; " +
        "it is installed so a WBTC market does not need an oracle change.",
      descriptionHint: "BTC / USD",
    },
  },

  /* ── BSC Testnet ─────────────────────────────────────────────────────────
   * The crypto feeds looked markedly fresher than Sepolia's — BNB/ETH/BTC measured
   * 355s (2026-08-21) to ~1,000-1,300s (2026-08-23) — and that reading was an
   * artefact of when we happened to look. A single age tells you how long ago the
   * last round landed; it cannot tell you how long the gaps are, and on this chain
   * the gaps are long: BNB/USD's median is 60.0m and BTC/USD's max is 116.5m
   * (measured 2026-09-01 by walking getRoundData backwards, per feed below). The
   * 1800 override those sightings produced was therefore below the publisher's own
   * cadence, and BNB — the chain's native currency and its main collateral — spent
   * most of most hours reverting Protocol__StalePrice while every component was
   * working correctly. BNB is now 5400, matching Sepolia for the same publisher;
   * ETH/WETH/BTC keep 1800 because no token is registered against them, with the
   * measurement recorded on each so nobody registers one against a bound already
   * known to fail. The general lesson is worth keeping: an age is one sample of a
   * distribution, and a bound is a claim about the distribution. Walk the rounds.
   *
   * The two stablecoin feeds were added 2026-08-23 to make this a Base-equivalent
   * market rather than a BNB-only one (a BNB/WBNB-only market has nothing to
   * borrow, so /borrow and kfUSD would be dead here); they are the usual 24h-class
   * publishers — USDC 55,684s and USDT 54,558s old in one block — and take the
   * 90000 ceiling. Same pegged/volatile split as every other chain in this file. */
  97: {
    BNB: {
      aggregator: "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 5400,
      maxAgeBasis:
        "Was 1800, derived from a single 355s sighting of the sibling ETH/USD with " +
        "5x slack, and that derivation was wrong in a way one sighting cannot " +
        "show. Walked the round history instead on 2026-09-01 via " +
        "getRoundData(roundId-n): the gaps between consecutive answers are 60.5m " +
        "x5, 60.0m x2, 44.0m, 42.0m, 33.5m and 9.6m — median 60.0m, and TEN OF " +
        "ELEVEN over the 1800s bound. So BNB and WBNB, which share this id and are " +
        "two of the four registered collateral tokens on this chain, reverted " +
        "Protocol__StalePrice for most of most hours with nothing wrong anywhere: " +
        "the publisher was simply slower than the bound. 5400 is Sepolia's number " +
        "for the same publisher on the same policy, and covers the observed 60.5m " +
        "worst gap with ~49% headroom.\n\n" +
        "Loosening a volatile feed's bound is the move setFeedMaxAge's own " +
        "docstring warns against, and the warning does not apply here. It is about " +
        "silencing a feed we could have kept fresh — the Robinhood ETH case, where " +
        "we are the publisher and a stale price is our keeper's failure. Nobody " +
        "pays for a faster Chainlink round on BSC Testnet, so this price is the " +
        "freshest that exists and refusing it protects no one: it takes the " +
        "chain's main collateral offline and prices nothing more accurately.",
      descriptionHint: "BNB / USD",
    },
    ETH: {
      aggregator: "0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 355,
      maxAge: 1800,
      maxAgeBasis:
        "Observed 355s, x5 slack. Not a documented heartbeat — and that is the " +
        "same derivation that proved wrong on BNB above, on this chain and from " +
        "this publisher, so treat 1800 here as unverified rather than as policy. " +
        "The round history has not been walked for this feed because no token is " +
        "registered against it. Walk it before registering one.",
      descriptionHint: "ETH / USD",
    },
    WETH: {
      aggregator: "0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 355,
      maxAge: 1800,
      maxAgeBasis: "Same contract as ETH on this chain — and the same caveat.",
      descriptionHint: "ETH / USD",
    },
    BTC: {
      aggregator: "0x5741306c21795FdCBb9b265Ea0255F499DFe515C",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 1800,
      maxAgeBasis:
        "1800 IS KNOWN TO BE UNMEETABLE ON THIS FEED, and is left in place only " +
        "because no token is registered against it, so it currently gates nothing. " +
        "The same round-history walk that corrected BNB above measured this one on " +
        "2026-09-01: max gap 116.5m, median 49.0m, 7 of 11 gaps over 1800s. Note " +
        "that BNB's new 5400 would not cover it either — 116.5m is 6,990s. Anyone " +
        "registering WBTC here must pick a bound from that history first (7200 " +
        "covers the observed max by 3%, which is thin; 9000 is the defensible " +
        "number) and must not assume BNB's applies.",
      descriptionHint: "BTC / USD",
    },
    USDC: {
      aggregator: "0x90c069C4538adAc136E051052E14c1cD799C41B7",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 55684,
      maxAge: 90000,
      maxAgeBasis:
        "Probed 2026-08-23, not the file's 2026-08-21 sweep: getCode 9571 bytes, " +
        "decimals() 8, description() \"USDC / USD\", price $1.00, answer 55,684s " +
        "(15h28m) old. That is ~40x the crypto feeds on this chain (BNB/ETH/BTC " +
        "all ~1,000-1,300s in the same block) — the same pegged/volatile split " +
        "every testnet in this file shows — so the stablecoin needs the ceiling " +
        "bound while the crypto feeds keep 1800. 90000 is " +
        "Constants.MAX_FEED_PRICE_AGE and is only defensible because USDC is " +
        "pegged: a day-old answer is wrong by basis points, not percent. Same " +
        "number and same argument as USDC on Sepolia and Base Sepolia. Registering " +
        "the mock USDC that deploy-mock-tokens.js/deploy-stablecoin.js mint needs " +
        "this entry.",
      descriptionHint: "USDC / USD",
    },
    USDT: {
      aggregator: "0xEca2605f0BCF2BA5966372C99837b1F182d3D620",
      provider: "chainlink",
      decimals: 8,
      observedAgeSeconds: 54558,
      maxAge: 90000,
      maxAgeBasis:
        "Probed 2026-08-23 alongside USDC: 9571 bytes, decimals() 8, description() " +
        "\"USDT / USD\", price $0.9999, answer 54,558s (15h9m) old. Same 24h-class " +
        "heartbeat and same pegged-stable reasoning as USDC on this chain. 90000 is " +
        "the ceiling — see the USDC basis above. deploy-stablecoin.js mints a USDT " +
        "and this is the feed that lets it be registered.",
      descriptionHint: "USDT / USD",
    },
  },

  /* ── Robinhood Chain Testnet ─────────────────────────────────────────────
   * Nobody publishes a price on this chain, so we publish it ourselves. These
   * three entries point at PushablePriceFeed contracts of our own, and the
   * `aggregator: null` is filled in at resolve time from the deploy record — see
   * resolveSelfHosted below. Deploy them with scripts/deploy-pushable-feeds.js
   * BEFORE deploy-oracle.js, or the oracle has nothing to be configured against.
   *
   * ── How the chain ended up here ─────────────────────────────────────────
   *
   * Read the ORACLE_BACKEND note for 46630 above first. The short version, all
   * measured on 2026-08-22 rather than read off a coverage page:
   *
   *   Chainlink  Robinhood's own docs name it and name no one else, and they are
   *              right — for MAINNET. 57 feeds on chain 4663; the reference
   *              directory has a feeds-robinhood-mainnet.json (200) and no
   *              feeds-robinhood-testnet.json (404). Nothing here to point at.
   *   Pyth       no deployment. The address Pyth uses on Arc holds 1,067 bytes of
   *              something else here and getValidTimePeriod() reverts.
   *   API3       0xe201212b…C597 is a real Api3ReaderProxyV1 for ETH/USD — 4,724
   *              bytes, decimals() 18, description() empty, latestRoundData()
   *              REVERTS. That is the documented state of a dAPI whose Api3Market
   *              plan has not been bought. See API3_MARKET below; it is kept as
   *              the recorded fallback, not as what is deployed.
   *
   * ── What choosing our own feed costs ────────────────────────────────────
   *
   * The price stops being an oracle's and becomes ours: one key writes it, and
   * whoever holds that key decides every collateral valuation and therefore who
   * is liquidatable. On the Pyth chains that is not possible — a push must carry
   * a Wormhole-signed batch, so an attacker with the key can only pay for
   * freshness. Here the key IS the price. The wave's deployer key is public, so
   * until ownership moves, ETH's price on this chain is writable by anyone who
   * reads the repo history. That is tolerable for a testnet whose lending assets
   * are mocks we minted and is the reason this must not reach mainnet, where
   * Chainlink publishes and the addresses to repoint at are recorded above.
   *
   * The gain, and it is real: a bound of our choosing. API3's only heartbeat
   * option is 24 hours, so that path forced 90000s on ETH — the protocol's
   * absolute ceiling, on a volatile asset, which Constants.MAX_FEED_PRICE_AGE's
   * own docstring warns against. Publishing ourselves buys 3600s instead, and
   * costs a keeper that has to keep it. It also does not expire after seven days.
   *
   * 8 decimals, not API3's 18, and that is deliberate: it is what Chainlink
   * reports, including on the Robinhood mainnet feeds these stand in for. So the
   * eventual swap to Chainlink is a change of address and nothing else, and the
   * 18->8 rescale inside AggregatorPriceOracle stays out of use on this chain in
   * both configurations rather than switching on and off with the backend. */
  46630: {
    ETH: {
      aggregator: null,
      provider: "kaleido-push",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 3600,
      maxAgeBasis:
        "NOT an observation — it is a commitment. Nothing publishes ETH/USD on " +
        "this chain, so the age of the feed is whatever our keeper last made it, " +
        "and this number is the promise scripts/push-aggregator.js has to keep. " +
        "One hour on a volatile asset, against the 90000s (25h) the API3 " +
        "alternative would have forced because 24h is its only heartbeat option. " +
        "That 25x tightening is the main technical gain of publishing ourselves, " +
        "and it is worth nothing if the keeper is not scheduled: at 3600s the " +
        "market fails closed one hour after the last push. Tighten it and the " +
        "keeper must run more often; loosen it and liquidations price off a " +
        "staler ETH. Do not carry this entry to mainnet at all — Chainlink " +
        "publishes ETH/USD on chain 4663 and a self-published price has no place " +
        "there.",
      descriptionHint: "ETH / USD",
    },
    WETH: {
      aggregator: null,
      provider: "kaleido-push",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 3600,
      maxAgeBasis: "Same feed contract as ETH — one Pyth id, one aggregator.",
      descriptionHint: "ETH / USD",
    },
    USDC: {
      aggregator: null,
      provider: "kaleido-push",
      decimals: 8,
      observedAgeSeconds: null,
      maxAge: 90000,
      maxAgeBasis:
        "Looser than ETH on the same chain, pushed by the same keeper, and that " +
        "asymmetry is deliberate rather than an oversight. A keeper that misses " +
        "its window should take the volatile asset offline before the pegged one: " +
        "a day-old dollar is wrong by basis points, a day-old ether by percent. " +
        "So USDC survives an outage that stops ETH pricing, which keeps the " +
        "stablecoin path alive while /borrow fails closed. 90000 is " +
        "Constants.MAX_FEED_PRICE_AGE, the ceiling, and is only defensible " +
        "because the asset is pegged — the same argument every other 90000 in " +
        "this file rests on. The USDC being priced here is a mock we mint: " +
        "Robinhood's canonical dollar is USDG and it exists on MAINNET ONLY.",
      descriptionHint: "USDC / USD",
    },
  },
};

/**
 * The API3 market contracts, kept as the recorded fallback for chain 46630.
 *
 * NOT what is deployed. The chain runs PushablePriceFeed contracts of our own —
 * see the AGGREGATORS note above for why, and what that costs. This entry stays
 * because it is the one third-party feed that exists on the chain at all, and
 * finding it took a contract search: if publishing our own price ever becomes
 * unacceptable and Chainlink still has no testnet deployment, this is the address
 * to activate, and `AggregatorPriceOracle.setFeed` can be repointed at it without
 * touching the diamond.
 */
const API3_MARKET = {
  46630: {
    market: "0x26B7446a3a7c21495d389055FE9e80C4A71A3552",
    proxyFactory: "0x67E2E466A188f278a23337AB40B988c80aB45099",
    ethUsdProxy: "0xe201212b76f0C82FBf5ff17D8Ee009C9d4e9C597",
    note:
      "Unactivated as of 2026-08-22: the proxy holds 4,724 bytes, decimals() " +
      "answers 18 and latestRoundData() reverts. A 7-day plan (~$0.05/day) " +
      "activates it. Two things to fix if it is ever adopted: 18 decimals means " +
      "the oracle's 18->8 rescale comes into use, and 24h is API3's only " +
      "heartbeat option, so ETH's bound would have to go from 3600s back to the " +
      "90000s ceiling.",
  },
};

/**
 * Which backend a chain uses, honouring an env override.
 *
 * ORACLE_BACKEND=pyth|aggregator-v3 forces it. The override exists because the
 * table above is a snapshot of what each chain carried on one day: if Pyth turns
 * up on Robinhood, or Sepolia's Pyth feeds start being maintained, the deploy
 * should not need a code change to follow.
 */
function backendFor(chainId) {
  const override = (process.env.ORACLE_BACKEND || "").trim().toLowerCase();
  if (override) {
    if (override !== "pyth" && override !== "aggregator-v3") {
      throw new Error(
        `ORACLE_BACKEND must be "pyth" or "aggregator-v3", got "${override}".`,
      );
    }
    return override;
  }
  const known = ORACLE_BACKEND[chainId];
  if (!known) {
    throw new Error(
      `No oracle backend recorded for chain ${chainId}.\n` +
        "Add it to scripts/libraries/aggregator-feeds.js, or pass\n" +
        "ORACLE_BACKEND=pyth or ORACLE_BACKEND=aggregator-v3 for a one-off.\n" +
        `Known chains: ${Object.keys(ORACLE_BACKEND).join(", ")}`,
    );
  }
  return known;
}

/** Where deploy records are written — smart-contract/, two levels up from here. */
const RECORDS_DIR = require("node:path").resolve(__dirname, "..", "..");

/**
 * Fill in the address of a feed we deployed ourselves.
 *
 * Entries with `provider: "kaleido-push"` carry `aggregator: null`, because the
 * address is not knowable until `deploy-pushable-feeds.js` has run. Hand-writing
 * it back into the table afterwards is exactly the transcription step
 * scripts/README.md argues against — a mistyped address here is still twenty
 * well-formed bytes, `setFeed`'s decimals() check would pass against any
 * aggregator, and the first symptom is a token priced off the wrong asset. So the
 * deploy record is the source and this reads it.
 *
 * Matched on the chainId INSIDE the record rather than on the filename. The
 * filename carries a hardhat network name and this function only has a chain id;
 * mapping between them would be a second table to keep in step, and the record
 * already states which chain it describes.
 *
 * Deliberately named pricefeeds-*.json rather than deployment-*.json, the same
 * choice push-prices.js made: gen-registry.mjs globs deployment-*.json to build
 * src/constants/deployments.generated.ts, and these addresses are not ones the
 * frontend resolves. The protocol reads prices through the diamond, and the
 * authoritative record of which aggregator serves a feed id is the oracle's own
 * `feedAggregator(bytes32)` — which is what the keeper reads, so this file being
 * lost costs a deploy-time convenience and not the ability to operate the chain.
 */
function resolveSelfHosted(chainId, symbol) {
  const { readdirSync, readFileSync } = require("node:fs");
  const path = require("node:path");

  let names;
  try {
    names = readdirSync(RECORDS_DIR);
  } catch {
    names = [];
  }

  const candidates = names.filter(
    (n) => n.startsWith("pricefeeds-") && n.endsWith(".json"),
  );
  for (const name of candidates) {
    let record;
    try {
      record = JSON.parse(readFileSync(path.join(RECORDS_DIR, name), "utf8"));
    } catch {
      continue; /* A half-written record is not an error worth aborting on. */
    }
    if (Number(record?.chainId) !== Number(chainId)) continue;
    const hit = (record?.feeds || []).find((f) =>
      (f?.symbols || []).some((s) => String(s).toUpperCase() === symbol),
    );
    if (hit?.aggregator) return { aggregator: hit.aggregator, from: name };
  }

  throw new Error(
    `${symbol} on chain ${chainId} is served by a price feed of ours, and no ` +
      `record of it was found in ${RECORDS_DIR}.\n` +
      "Deploy it first:\n" +
      "  npx hardhat run scripts/deploy-pushable-feeds.js --network <net>\n" +
      "That writes pricefeeds-<network>.json, which this reads. Nothing " +
      "publishes a price on this chain, so there is no third-party address to " +
      "fall back to — see the AGGREGATORS note for chain 46630.\n" +
      `Looked at: ${candidates.length ? candidates.join(", ") : "no pricefeeds-*.json files at all"}`,
  );
}

/**
 * Resolve the aggregator for a symbol on a chain, honouring an env override.
 *
 * AGGREGATOR_<SYMBOL>=0x… takes precedence, the same escape hatch FEED_<SYMBOL>
 * gives the Pyth table. An overridden entry carries no maxAge of its own, so it
 * inherits the protocol's global bound — deliberately, because a bound is a risk
 * parameter and inventing one for an address typed on a command line would be
 * guessing. Pass FEED_MAX_AGE_<SYMBOL> alongside it to set one.
 */
function aggregatorFor(chainId, symbol) {
  const key = symbol.toUpperCase();
  const override = (process.env[`AGGREGATOR_${key}`] || "").trim();

  if (override) {
    const { isAddress, getAddress } = require("ethers");
    if (!isAddress(override)) {
      throw new Error(`AGGREGATOR_${key} is not a valid address: ${override}`);
    }
    const ageOverride = (process.env[`FEED_MAX_AGE_${key}`] || "").trim();
    return {
      aggregator: getAddress(override),
      provider: "override",
      decimals: null,
      observedAgeSeconds: null,
      maxAge: ageOverride ? Number(ageOverride) : 0,
      maxAgeBasis: ageOverride
        ? `FEED_MAX_AGE_${key} passed on the command line`
        : "not set — inherits the protocol's global PRICE_MAX_AGE_SECONDS bound",
      descriptionHint: null,
      overridden: true,
    };
  }

  const chain = AGGREGATORS[chainId];
  if (!chain) {
    throw new Error(
      `No aggregator feeds recorded for chain ${chainId}.\n` +
        `Add them to scripts/libraries/aggregator-feeds.js, or pass AGGREGATOR_${key}=0x…\n` +
        `Chains with feeds: ${Object.keys(AGGREGATORS).join(", ")}`,
    );
  }

  const feed = chain[key];
  if (!feed) {
    throw new Error(
      `No ${key} aggregator recorded for chain ${chainId}.\n` +
        `Known on this chain: ${Object.keys(chain).join(", ")}\n` +
        `Pass AGGREGATOR_${key}=0x… for a one-off.`,
    );
  }

  /* A feed of ours carries no address in the table — it is not knowable until the
   * feed is deployed. Resolve it from the deploy record, and let the throw from
   * there surface: a missing record means the chain has no price at all, which is
   * a stop rather than something to work around. */
  if (feed.provider === "kaleido-push" && !feed.aggregator) {
    const { aggregator, from } = resolveSelfHosted(chainId, key);
    return { ...feed, aggregator, resolvedFrom: from };
  }

  return { ...feed };
}

/**
 * Every (feedId, aggregator) pair a chain should be configured with.
 *
 * Keyed by the Pyth feed id from pyth-feeds.js, because that is what the
 * protocol stores per token. Symbols that share an id — ETH and WETH — collapse
 * to one entry, which is correct: the oracle maps ids, not symbols, and setting
 * the same id twice would just be a redundant write.
 */
function feedPlanFor(chainId) {
  const chain = AGGREGATORS[chainId];
  if (!chain) return [];

  const byId = new Map();
  for (const symbol of Object.keys(chain)) {
    const pythFeed = FEEDS[symbol];
    if (!pythFeed) {
      throw new Error(
        `${symbol} has an aggregator on chain ${chainId} but no feed id in ` +
          "pyth-feeds.js. The id is what ProtocolFacet stores per token, so " +
          "there is nothing to register this aggregator against.",
      );
    }
    /* Resolved through aggregatorFor, not read from the table directly, so that
     * AGGREGATOR_<SYMBOL> and FEED_MAX_AGE_<SYMBOL> reach this function. Reading
     * the raw table here meant deploy-oracle.js (which calls feedPlanFor) ignored
     * every override while register-tokens.js (which calls aggregatorFor) honoured
     * them — so an override would deploy an oracle mapped to the table address and
     * then fail registration against it, after the oracle was already configured.
     * One resolver, one answer. */
    const feed = aggregatorFor(chainId, symbol);
    const id = pythFeed.id.toLowerCase();
    const existing = byId.get(id);
    if (existing) {
      /* Two symbols, one id. Consistent by construction in the table (ETH/WETH
       * point at the same contract), but an override applied to one and not the
       * other makes them diverge — and then the deployment would install
       * whichever came last in object order, silently. */
      if (existing.aggregator.toLowerCase() !== feed.aggregator.toLowerCase()) {
        throw new Error(
          `Feed id ${id} maps to two different aggregators on chain ${chainId}: ` +
            `${existing.symbols.join("/")} -> ${existing.aggregator} and ` +
            `${symbol} -> ${feed.aggregator}. One id can hold one address.\n` +
            `If this came from an AGGREGATOR_ override, ${existing.symbols.join("/")} ` +
            `and ${symbol} share a feed id — override all of them or none.`,
        );
      }
      if (existing.maxAge !== feed.maxAge) {
        throw new Error(
          `Feed id ${id} is given two different maxAge bounds on chain ${chainId}: ` +
            `${existing.symbols.join("/")} -> ${existing.maxAge}s and ` +
            `${symbol} -> ${feed.maxAge}s. The bound is stored per id, not per symbol.\n` +
            "An overridden aggregator is given maxAge 0 deliberately (inherit the " +
            "global bound), so overriding one symbol of a shared id trips this too. " +
            `Set FEED_MAX_AGE_${symbol} and FEED_MAX_AGE_${existing.symbols[0]} to ` +
            "the same value, or override neither.",
        );
      }
      existing.symbols.push(symbol);
      continue;
    }
    byId.set(id, { id, symbols: [symbol], ...feed });
  }
  return [...byId.values()];
}

/**
 * The distinct feeds a chain publishes ITSELF, de-duplicated by Pyth feed id.
 *
 * The counterpart to feedPlanFor for `kaleido-push` feeds, and it differs in the
 * one way that matters: it carries NO aggregator address. feedPlanFor resolves
 * one (from the deploy record, via resolveSelfHosted) because registration needs
 * it; this deliberately does not, because its two callers run at moments when the
 * address is either not knowable yet or better read from elsewhere:
 *
 *   deploy-pushable-feeds.js  runs BEFORE the record exists — it is what creates
 *                             the addresses — so it must not depend on resolving
 *                             one.
 *   push-aggregator.js        reads the authoritative address from the oracle
 *                             on-chain (feedAggregator), so a table/record
 *                             address would only be a thing to drift from.
 *
 * Both need the same list of {id, symbols, decimals, description, maxAge}, and
 * both must agree on how ETH and WETH collapse to one ETH/USD contract — so the
 * de-dup lives here once rather than in each script. Symbols sharing an id must
 * agree on decimals, description and bound; a disagreement is a table bug and is
 * thrown rather than silently resolved to whichever came last.
 */
function selfHostedPlanFor(chainId) {
  const chain = AGGREGATORS[chainId] || {};
  const byId = new Map();

  for (const [symbol, feed] of Object.entries(chain)) {
    if (feed.provider !== "kaleido-push") continue;

    const pythFeed = FEEDS[symbol];
    if (!pythFeed) {
      throw new Error(
        `${symbol} is a self-hosted feed on chain ${chainId} but has no feed id ` +
          "in pyth-feeds.js. The id is the asset key ProtocolFacet stores and the " +
          "id the keeper fetches from Hermes, so there is nothing to price it against.",
      );
    }

    const id = pythFeed.id.toLowerCase();
    const existing = byId.get(id);
    if (existing) {
      if (existing.decimals !== feed.decimals) {
        throw new Error(
          `Feed id ${id} is given ${existing.decimals} decimals by ` +
            `${existing.symbols.join("/")} and ${feed.decimals} by ${symbol}.`,
        );
      }
      if (existing.description !== feed.descriptionHint) {
        throw new Error(
          `Feed id ${id} is given description "${existing.description}" by ` +
            `${existing.symbols.join("/")} and "${feed.descriptionHint}" by ${symbol}.`,
        );
      }
      if (existing.maxAge !== feed.maxAge) {
        throw new Error(
          `Feed id ${id} is given maxAge ${existing.maxAge}s by ` +
            `${existing.symbols.join("/")} and ${feed.maxAge}s by ${symbol}. The bound ` +
            "is stored per id, so the two symbols cannot disagree.",
        );
      }
      existing.symbols.push(symbol);
      continue;
    }

    byId.set(id, {
      id,
      symbols: [symbol],
      decimals: feed.decimals,
      description: feed.descriptionHint,
      maxAge: feed.maxAge,
    });
  }

  return [...byId.values()];
}

/**
 * Prove an aggregator is live and prices the asset its feed id names.
 *
 * The aggregator counterpart to pyth-feeds.js's verifyFeed, and it has to work
 * differently in one important way: there is no Hermes. Pyth publishes a registry
 * that maps id -> symbol, so a wrong-but-real id is catchable off-chain. Chainlink
 * and API3 publish no such thing, so the only available cross-check is the feed's
 * own `description()` string — which is self-reported, and therefore evidence
 * rather than proof. A mismatch refuses; agreement is not a guarantee; and no
 * answer at all — a revert, or the empty string an API3 reader proxy returns — is
 * a warning, because absence of evidence is not evidence of the wrong asset.
 *
 * @param {object} opts
 * @param {object|null} opts.oracle  ethers Contract bound to AggregatorPriceOracle,
 *        or null to skip the price probe. Null is the pre-registration case: the
 *        decimals and description checks must run BEFORE `setFeeds` is sent, since
 *        their whole purpose is to stop a wrong address being installed, but
 *        `getPrice` cannot answer until the feed exists in the oracle. Passing the
 *        oracle in at that point would report "no readable price yet" for every
 *        feed and train the operator to ignore it.
 * @param {object} opts.aggregatorContract ethers Contract bound to IAggregatorV3.
 * @param {string} opts.feedId       the bytes32 the protocol will store.
 * @param {Aggregator} opts.feed     as returned by aggregatorFor().
 * @param {number} opts.blockTime    latest block timestamp, for staleness.
 */
async function verifyAggregatorFeed({ oracle, aggregatorContract, feedId, feed, blockTime }) {
  const reasons = [];
  const warnings = [];
  let ageSeconds = null;

  /* 1. Decimals, against what the table recorded. A feed that silently changed
   *    decimals would rescale every price by a power of ten, and the oracle
   *    caches the value at registration, so a stale table entry here means the
   *    number in the table is not the number in use. */
  let decimals = null;
  try {
    decimals = Number(await aggregatorContract.decimals());
    if (feed.decimals !== null && decimals !== feed.decimals) {
      reasons.push(
        `reports ${decimals} decimals but the table records ${feed.decimals}. ` +
          "Every price from it would be off by a factor of " +
          `1e${Math.abs(decimals - feed.decimals)}.`,
      );
    }
  } catch (err) {
    reasons.push(`decimals() reverted (${err.shortMessage || err.message}) — not an aggregator`);
    return { ok: false, reasons, warnings, ageSeconds, decimals };
  }

  /* 2. Is it the asset the feed id names? Self-reported, see above. */
  if (feed.descriptionHint) {
    try {
      const described = await aggregatorContract.description();
      const a = described.replace(/[\s/]/g, "").toUpperCase();
      const b = feed.descriptionHint.replace(/[\s/]/g, "").toUpperCase();
      /* An empty answer is absence of evidence, not evidence of the wrong asset,
       * and the difference decides whether a chain can deploy at all.
       *
       * This was a plain `a !== b` and it made Robinhood 46630 undeployable:
       * API3's reader proxy implements description() and returns "", so the
       * comparison read `calls itself "" but was expected to be "ETH/USD"` and
       * refused a correct address. Chainlink populates the string, so treating a
       * blank as a mismatch was applying Chainlink semantics to an API3 proxy.
       *
       * Downgraded to the same warning the revert branch already produces, because
       * the two states are identical in what they tell us — nothing — and the
       * revert branch had it right. What is NOT downgraded is a non-empty string
       * naming a different asset: that is the case this check exists for. */
      if (!a) {
        warnings.push(
          `description() returned an empty string, so the asset it prices is ` +
            `unverified on-chain. Expected from an API3 reader proxy. Confirm ` +
            `${feed.aggregator} is the ${feed.descriptionHint} proxy against the ` +
            `API3 market listing before trusting a price from it.`,
        );
      } else if (a !== b) {
        reasons.push(
          `calls itself "${described}" but was expected to be ` +
            `"${feed.descriptionHint}". Registering it would price the token off ` +
            "the wrong asset permanently.",
        );
      }
    } catch {
      warnings.push("description() reverted, so the asset it prices is unverified");
    }
  }

  /* 3. Does it answer, and how old is the answer? Not fatal: an unactivated API3
   *    dAPI reverts here by design and must still be registerable. Skipped
   *    entirely when `oracle` is null — see the note on the parameter. */
  if (oracle) {
    try {
      const price = await oracle.getPrice(feedId);
      ageSeconds = blockTime - Number(price.publishTime);
      /* `feed.maxAge` of 0 means "no override, inherit the global bound" — the same
       * meaning ProtocolFacet gives `s_feedMaxAge[id] == 0`. Comparing against 0
       * directly would warn that every overridden feed is stale the instant its
       * answer is a second old, which is the opposite of what 0 requests. */
      const bound = feed.maxAge || Number(process.env.PRICE_MAX_AGE_SECONDS || 300);
      if (ageSeconds > bound) {
        warnings.push(
          `answer is ${ageSeconds}s old and the bound that will apply is ${bound}s` +
            (feed.maxAge ? "" : " (the global default — this feed has no override)") +
            ", so priced operations on this asset will revert until it refreshes",
        );
      }
    } catch (err) {
      warnings.push(
        `no readable price yet (${err.shortMessage || err.message}). Expected for an ` +
          "API3 dAPI with no active plan; for a Chainlink feed it means this address " +
          "is not serving data on this chain.",
      );
    }
  }

  return { ok: reasons.length === 0, reasons, warnings, ageSeconds, decimals };
}

module.exports = {
  AGGREGATORS,
  ORACLE_BACKEND,
  PYTH_CONTRACTS,
  API3_MARKET,
  backendFor,
  aggregatorFor,
  feedPlanFor,
  selfHostedPlanFor,
  resolveSelfHosted,
  verifyAggregatorFeed,
};
