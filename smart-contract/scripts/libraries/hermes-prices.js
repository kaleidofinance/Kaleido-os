/**
 * Fetch parsed Pyth prices from Hermes and rescale them to a fixed number of
 * decimal places.
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
 * answer; that is the whole reason this is not inlined in either script.
 *
 * ── Parsed prices, not signed blobs ─────────────────────────────────────────
 *
 * push-prices.js relays the Wormhole-signed blob to a Pyth receiver, which
 * verifies it on-chain. A PushablePriceFeed takes a bare integer — there is
 * nothing to verify and no reason to carry the batch. The trust model is
 * entirely "we computed this off-chain and wrote it", which is exactly what the
 * self-hosted feed is and exactly what it costs. So this reads Hermes' PARSED
 * price, not its binary update.
 */

const HERMES_ENDPOINT =
  process.env.HERMES_ENDPOINT || "https://hermes.pyth.network";

/**
 * Move a Pyth parsed price to exactly `targetDecimals` decimal places, as a
 * BigInt.
 *
 * Pyth reports an integer `price` at exponent `expo`: $2345.12345678 arrives as
 * price = 234512345678, expo = -8. A PushablePriceFeed stores 8-decimal
 * integers, so that same ether is 234512345678 there too. When expo does not
 * equal -targetDecimals the value is shifted; below the target the extra
 * precision is truncated — the same thing AggregatorPriceOracle._rescale does,
 * for the same reason: precision finer than 1e-8 of a unit is below the
 * protocol's own rounding, and carrying it would be false exactness.
 *
 * Truncating to zero is refused rather than returned, because a zero answer
 * divides by zero in getTokenAmountFromUsd downstream — the same failure
 * _rescale guards with PriceTruncatedToZero.
 */
function scaleParsedPrice(priceStr, expo, targetDecimals) {
  const raw = BigInt(priceStr);
  if (raw <= 0n) {
    throw new Error(
      `Hermes served a non-positive price (${priceStr}). A feed cannot be ` +
        "seeded or pushed with it — PushablePriceFeed rejects answer <= 0.",
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
 * Fetch the latest parsed price for each feed id, scaled to `targetDecimals`.
 *
 * Returns a Map keyed by lowercase 0x id ->
 *   { answer: BigInt, publishTime: Number(seconds), rawPrice: string, rawExpo: Number }
 *
 * An id Hermes does not serve is simply ABSENT from the map. The caller decides
 * whether that is fatal, because "seed all of them" (a missing one is a dead
 * feed) and "push the stale ones" (a missing one is nothing to relay) treat it
 * differently.
 */
async function fetchScaledPrices(ids, targetDecimals) {
  const { HermesClient } = require("@pythnetwork/hermes-client");
  const client = new HermesClient(HERMES_ENDPOINT, { timeout: 20000 });

  let updates;
  try {
    updates = await client.getLatestPriceUpdates(ids, { encoding: "hex" });
  } catch (err) {
    throw new Error(
      `Hermes at ${HERMES_ENDPOINT} would not serve prices for these ids: ${err.message}\n` +
        "Without a price there is nothing to publish — the chain cannot\n" +
        "manufacture one. Check outbound HTTPS, or set HERMES_ENDPOINT.",
    );
  }

  const out = new Map();
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
    out.set(id, {
      answer: scaleParsedPrice(priceStr, expo, targetDecimals),
      publishTime,
      rawPrice: String(priceStr),
      rawExpo: Number(expo),
    });
  }
  return out;
}

module.exports = { HERMES_ENDPOINT, scaleParsedPrice, fetchScaledPrices };
