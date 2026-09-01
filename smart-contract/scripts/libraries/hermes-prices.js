/**
 * Fetch parsed prices for the feeds we publish ourselves, and rescale them to a
 * fixed number of decimal places. Hermes first, CoinGecko when Hermes will not
 * answer.
 *
 * Shared by the two scripts that publish a PushablePriceFeed and MUST agree to
 * the last digit:
 *
 *   deploy-pushable-feeds.js  seeds a feed's FIRST answer.
 *   push-aggregator.js        pushes every answer after that.
 *
 * If the two scaled a price differently, the first keeper push would move the
 * stored answer for no market reason — which reads as a jump and, if it crossed
 * the feed's deviation guard, would be rejected outright. One function, one
 * answer; that is the whole reason this is not inlined in either script. It is
 * also why the fallback lives here rather than in a caller: a second source that
 * only one of the two scripts could reach would break that agreement.
 *
 * ── Parsed prices, not signed blobs ─────────────────────────────────────────
 *
 * push-prices.js relays the Wormhole-signed blob to a Pyth receiver, which
 * verifies it on-chain. A PushablePriceFeed takes a bare integer — there is
 * nothing to verify and no reason to carry the batch. The trust model is
 * entirely "we computed this off-chain and wrote it", which is exactly what the
 * self-hosted feed is and exactly what it costs. So this reads Hermes' PARSED
 * price, not its binary update.
 *
 * ── Why there is a second source at all ─────────────────────────────────────
 *
 * Because a parsed price has no provenance to lose. `hermes.pyth.network` began
 * answering 401 on every price path on 2026-08-27, which took the self-hosted
 * feeds on Robinhood offline: nothing else refreshes them, and by 2026-09-01
 * every priced operation on that chain reverted Protocol__StalePrice at 6.9 days.
 * Pyth cannot be substituted for push-prices.js — only Pyth can produce a blob
 * its receiver will verify — but it CAN be substituted here, where the feed
 * accepts whatever integer its owner writes. Adding a source changes nothing
 * about who is trusted: the answer was already ours.
 *
 * Hermes stays first because it is what seeded every feed and what the deviation
 * guard's history was built from, and because its publish_time is a publisher's
 * observation rather than an aggregator's cache time.
 */

const HERMES_ENDPOINT =
  process.env.HERMES_ENDPOINT || "https://hermes.pyth.network";

const COINGECKO_ENDPOINT =
  process.env.COINGECKO_ENDPOINT ||
  "https://api.coingecko.com/api/v3/simple/price";

/**
 * Token symbol -> CoinGecko coin id, for the fallback only.
 *
 * The same ids the app prices from in src/lib/v2/prices/feeds.ts, kept as the
 * same values on purpose: a chart and a collateral valuation disagreeing about
 * which coin "ETH" is would be a bug nobody would think to look for.
 *
 * A wrapped asset maps to its underlying for the reason pyth-feeds.js gives for
 * sharing a feed id — the wrapper is redeemable 1:1 by contract, not by market.
 *
 * Two symbols pyth-feeds.js carries are deliberately absent:
 *
 *   USDE  no CoinGecko id has been verified for it here, and an unverified id is
 *         the failure that does not revert (see pyth-feeds.js on provenance).
 *   WBTC  CoinGecko is asked for `bitcoin` by the app, which is fine for a chart
 *         and wrong for collateral: a wrapper that can depeg would be priced as
 *         if it could not, invisibly, for every liquidation.
 *
 * Both are absent from the map rather than approximated, so a feed that needs one
 * fails loudly with nothing to push instead of quietly publishing a number that
 * is not its price. Neither is registered on a chain that uses these feeds today.
 */
const COINGECKO_IDS = {
  ETH: "ethereum",
  WETH: "ethereum",
  BTC: "bitcoin",
  BNB: "binancecoin",
  USDC: "usd-coin",
  WUSDC: "usd-coin",
  USDT: "tether",
};

/**
 * Pyth feed id -> CoinGecko coin id.
 *
 * Joined through pyth-feeds.js rather than written out, because a feed id typed a
 * second time is a feed id that can be typed wrong, and a wrong one here would
 * publish the wrong asset's price to a real feed. Built per call so a test that
 * stubs FEEDS is not defeated by a cached table.
 */
function coinGeckoIdByFeedId() {
  const { FEEDS } = require("./pyth-feeds.js");
  const out = new Map();
  for (const [symbol, feed] of Object.entries(FEEDS)) {
    const coin = COINGECKO_IDS[symbol];
    if (!coin || !feed?.id) continue;
    out.set(feed.id.toLowerCase(), coin);
  }
  return out;
}

/**
 * Move a parsed price to exactly `targetDecimals` decimal places, as a BigInt.
 *
 * Pyth reports an integer `price` at exponent `expo`: $2345.12345678 arrives as
 * price = 234512345678, expo = -8. A PushablePriceFeed stores 8-decimal
 * integers, so that same ether is 234512345678 there too. When expo does not
 * equal -targetDecimals the value is shifted; below the target the extra
 * precision is truncated — the same thing AggregatorPriceOracle._rescale does,
 * for the same reason: precision finer than 1e-8 of a unit is below the
 * protocol's own rounding, and carrying it would be false exactness.
 *
 * The CoinGecko path converts its decimal into this same (integer, expo) shape
 * before calling in, so both sources scale through one function and cannot
 * disagree about a rounding.
 *
 * Truncating to zero is refused rather than returned, because a zero answer
 * divides by zero in getTokenAmountFromUsd downstream — the same failure
 * _rescale guards with PriceTruncatedToZero.
 */
function scaleParsedPrice(priceStr, expo, targetDecimals) {
  const raw = BigInt(priceStr);
  if (raw <= 0n) {
    throw new Error(
      `The price source served a non-positive price (${priceStr}). A feed ` +
        "cannot be seeded or pushed with it — PushablePriceFeed rejects " +
        "answer <= 0.",
    );
  }

  const shift = Number(expo) + Number(targetDecimals); // e.g. -8 + 8 = 0, no shift
  let scaled;
  if (shift >= 0) {
    scaled = raw * 10n ** BigInt(shift);
  } else {
    scaled = raw / 10n ** BigInt(-shift);
    if (scaled === 0n) {
      throw new Error(
        `Price ${priceStr}e${expo} truncates to zero at ${targetDecimals} ` +
          "decimals — the asset is priced below the feed's smallest unit.",
      );
    }
  }
  return scaled;
}

/**
 * Hermes' latest parsed price per id, scaled. Never throws for a network reason —
 * returns `{ prices, error }` so the caller can fall through to another source
 * instead of dying at the first refusal.
 *
 * A malformed price still throws (via scaleParsedPrice): that is a bug or a
 * corrupt payload, not an unavailable source, and falling back would hide it.
 */
async function fetchFromHermes(ids, targetDecimals) {
  const prices = new Map();

  let updates;
  try {
    const { HermesClient } = require("@pythnetwork/hermes-client");
    const client = new HermesClient(HERMES_ENDPOINT, { timeout: 20000 });
    updates = await client.getLatestPriceUpdates(ids, { encoding: "hex" });
  } catch (err) {
    return { prices, error: err?.message || String(err) };
  }

  for (const p of updates?.parsed || []) {
    const id = p.id.startsWith("0x")
      ? p.id.toLowerCase()
      : `0x${p.id.toLowerCase()}`;
    const priceStr = p.price?.price;
    const expo = p.price?.expo;
    const publishTime = Number(p.price?.publish_time ?? 0);
    /* A parsed entry with no price or no publish time is unusable; drop it and
     * let it show up as a missing id, which the caller already handles. */
    if (priceStr === undefined || expo === undefined || !publishTime) continue;
    prices.set(id, {
      answer: scaleParsedPrice(priceStr, expo, targetDecimals),
      publishTime,
      rawPrice: String(priceStr),
      rawExpo: Number(expo),
      source: "hermes",
    });
  }
  return { prices, error: null };
}

/**
 * A decimal price string -> the (integer, expo) pair scaleParsedPrice wants.
 *
 * Done as string surgery on a fixed-point rendering rather than by multiplying by
 * 1e8, because 2458.93 * 1e8 is 245892999999.99997 in binary floating point and
 * the multiplication would publish a price one ten-millionth off for no reason.
 * Fixing the exponent at -8 matches what Pyth serves for every asset here, so the
 * two sources hand scaleParsedPrice the same shape.
 */
function decimalToPythShape(usd) {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    throw new Error(`Not a usable price: ${JSON.stringify(usd)}`);
  }
  const fixed = usd.toFixed(8);
  /* toFixed switches to exponent notation above 1e21, which BigInt cannot parse.
   * No asset priced here is within nine orders of magnitude of that, so this is a
   * guard against a garbled response rather than a real case. */
  if (!/^\d+\.\d{8}$/.test(fixed)) {
    throw new Error(`Price ${usd} does not render as a fixed-point decimal.`);
  }
  const [whole, frac] = fixed.split(".");
  return { priceStr: `${whole}${frac}`.replace(/^0+(?=\d)/, ""), expo: -8 };
}

/**
 * CoinGecko's simple/price for the ids that map to a coin, scaled.
 *
 * One batched request for every coin needed, and `include_last_updated_at` so
 * each answer carries an observation time. That timestamp is not decoration: the
 * caller gates on it (a price already older than the feed's bound is not worth
 * pushing) and PushablePriceFeed stores it as `updatedAt`, so an entry without
 * one is dropped rather than stamped with the current clock — stamping would
 * assert a freshness that was never measured.
 *
 * Two attempts, as in src/lib/points/prices.ts, for the same reason: by the time
 * this runs it is the last source there is.
 */
async function fetchFromCoinGecko(ids, targetDecimals) {
  const prices = new Map();

  const byFeedId = coinGeckoIdByFeedId();
  const wanted = new Map(); // feed id -> coin id
  for (const raw of ids) {
    const id = String(raw).toLowerCase();
    const coin = byFeedId.get(id);
    if (coin) wanted.set(id, coin);
  }
  if (wanted.size === 0) {
    return { prices, error: "no CoinGecko coin id is mapped for any of these feed ids" };
  }

  const coins = [...new Set(wanted.values())];
  const apiKey = process.env.COINGECKO_API_KEY;
  const url =
    `${COINGECKO_ENDPOINT}?ids=${encodeURIComponent(coins.join(","))}` +
    "&vs_currencies=usd&include_last_updated_at=true";

  let body = null;
  let error = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        error = `HTTP ${res.status} ${res.statusText}`;
        continue;
      }
      body = await res.json();
      error = null;
      break;
    } catch (err) {
      error = err?.message || String(err);
    }
  }
  if (!body) return { prices, error: error || "no response" };

  for (const [feedId, coin] of wanted) {
    const entry = body?.[coin];
    const usd = entry?.usd;
    const observedAt = Number(entry?.last_updated_at ?? 0);
    if (typeof usd !== "number" || !Number.isInteger(observedAt) || observedAt <= 0) {
      continue;
    }
    const { priceStr, expo } = decimalToPythShape(usd);
    prices.set(feedId, {
      answer: scaleParsedPrice(priceStr, expo, targetDecimals),
      publishTime: observedAt,
      rawPrice: priceStr,
      rawExpo: expo,
      source: "coingecko",
    });
  }
  return { prices, error: null };
}

/**
 * Fetch the latest price for each feed id, scaled to `targetDecimals`.
 *
 * Returns a Map keyed by lowercase 0x id ->
 *   { answer: BigInt, publishTime: Number(seconds), rawPrice: string,
 *     rawExpo: Number, source: "hermes" | "coingecko" }
 *
 * Hermes is asked first and its answers are kept; CoinGecko is asked only for
 * the ids Hermes did not serve. So a working Hermes behaves exactly as before
 * this fallback existed, and a partial outage is filled per id rather than
 * all-or-nothing.
 *
 * An id neither source serves is simply ABSENT from the map. The caller decides
 * whether that is fatal, because "seed all of them" (a missing one is a dead
 * feed) and "push the stale ones" (a missing one is nothing to relay) treat it
 * differently. Only the case where NOTHING could be priced throws, and it names
 * both refusals — a keeper log that says "Hermes is down" without saying what
 * the second source did would send the reader to the wrong place.
 */
async function fetchScaledPrices(ids, targetDecimals) {
  const hermes = await fetchFromHermes(ids, targetDecimals);
  const out = new Map(hermes.prices);

  const missing = ids.filter((id) => !out.has(String(id).toLowerCase()));
  if (missing.length === 0) return out;

  const fallback = await fetchFromCoinGecko(missing, targetDecimals);
  for (const [id, price] of fallback.prices) {
    if (!out.has(id)) out.set(id, price);
  }
  if (out.size > 0) {
    if (fallback.prices.size > 0) {
      console.log(
        `   ℹ️  ${fallback.prices.size} price(s) came from CoinGecko: Hermes at ` +
          `${HERMES_ENDPOINT} served ${hermes.error ? `an error (${hermes.error})` : "nothing for them"}.`,
      );
    }
    return out;
  }

  throw new Error(
    `No price source would serve any of these ${ids.length} feed id(s).\n` +
      `  Hermes (${HERMES_ENDPOINT}): ${hermes.error || "served no usable entry"}\n` +
      `  CoinGecko (${COINGECKO_ENDPOINT}): ${fallback.error || "served no usable entry"}\n` +
      "Without a price there is nothing to publish — the chain cannot\n" +
      "manufacture one. Check outbound HTTPS, set HERMES_ENDPOINT to an\n" +
      "endpoint that will answer, or set COINGECKO_API_KEY if the free tier is\n" +
      "rate-limiting.",
  );
}

module.exports = {
  HERMES_ENDPOINT,
  COINGECKO_ENDPOINT,
  COINGECKO_IDS,
  scaleParsedPrice,
  fetchScaledPrices,
};
