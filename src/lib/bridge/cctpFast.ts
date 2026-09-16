import { cctpDomainForChain } from "./cctp";

/**
 * CCTP Fast Transfer economics — the fee cap and the allowance check a fast
 * burn needs before it can be built.
 *
 * A fast burn (finality threshold 1000) settles in seconds instead of waiting
 * for the source chain's hard finality, at the cost of a small fee Circle
 * deducts from the amount at mint, and only while Circle's rolling Fast Transfer
 * Allowance has room. Both are read from Circle's Iris API, whose shapes are
 * verified on the wire (2026-09-16):
 *
 *   GET /v2/burn/USDC/fees/{srcDomain}/{destDomain}
 *     -> [{ finalityThreshold: 1000, minimumFee: <bps> }, { 2000, 0 }]
 *      (bps, may be fractional — Arc->Base was 0, Ethereum->Arc 0.25)
 *   GET /v2/fastBurn/USDC/allowance
 *     -> { allowance: <USDC, human units>, lastUpdated }
 *
 * Isomorphic (fetch injectable) like the attestation reader, so the browser and
 * server planners can both quote a fast route. `maxFee` is a CAP: Circle deducts
 * the actual corridor fee up to it, so a small buffer over the quote is safe and
 * only protects against the fee ticking up between quote and burn.
 */

const IRIS_MAINNET = "https://iris-api.circle.com";

/** The fast-fee cap (in burn-token units) and the bps it was derived from. */
export type CctpFastQuote =
  | { ok: true; maxFeeUnits: bigint; feeBps: number }
  /** Fast is not possible right now — the caller falls back to a standard burn. */
  | { ok: false; unavailable: true; reason: string }
  /** The quote could not be read at all. */
  | { ok: false; error: string };

/**
 * Quote a fast burn, or say why it isn't available.
 *
 * `units` is the amount in the burn token's base units (USDC, 6 dp). Returns the
 * `maxFeeUnits` to pass to buildCctpBurnRoute, or `unavailable` (allowance spent,
 * corridor not fast-enabled) so the caller degrades to Standard rather than
 * refusing the bridge.
 */
export async function resolveCctpFastFee(params: {
  sourceChainId: number;
  destChainId: number;
  units: bigint;
  fetchImpl?: typeof fetch;
}): Promise<CctpFastQuote> {
  const { sourceChainId, destChainId, units } = params;
  const doFetch = params.fetchImpl ?? fetch;

  const src = cctpDomainForChain(sourceChainId);
  const dst = cctpDomainForChain(destChainId);
  if (src === undefined || dst === undefined)
    return { ok: false, error: "That corridor is not a CCTP corridor." };
  if (units <= 0n)
    return { ok: false, error: "A fast burn needs a positive amount." };

  // --- fee (bps) for the fast finality level ---
  let feeBps: number;
  try {
    const r = await doFetch(`${IRIS_MAINNET}/v2/burn/USDC/fees/${src}/${dst}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok)
      return {
        ok: false,
        unavailable: true,
        reason: `Circle's fast-fee service returned ${r.status}.`,
      };
    const body: unknown = await r.json();
    const rows = Array.isArray(body)
      ? (body as { finalityThreshold?: number; minimumFee?: number }[])
      : [];
    const fast = rows.find((x) => x.finalityThreshold === 1000);
    if (!fast || typeof fast.minimumFee !== "number")
      return {
        ok: false,
        unavailable: true,
        reason: "This corridor doesn't offer a fast transfer.",
      };
    feeBps = fast.minimumFee;
  } catch {
    return {
      ok: false,
      unavailable: true,
      reason: "Couldn't reach Circle's fast-fee service.",
    };
  }

  // --- allowance: is there room for this amount right now? ---
  try {
    const r = await doFetch(`${IRIS_MAINNET}/v2/fastBurn/USDC/allowance`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (r.ok) {
      const body = (await r.json()) as { allowance?: number };
      if (typeof body.allowance === "number") {
        // allowance is human USDC; units is 6-dp base units.
        const allowanceUnits = BigInt(Math.floor(body.allowance * 1e6));
        if (units > allowanceUnits)
          return {
            ok: false,
            unavailable: true,
            reason: "Circle's fast-transfer allowance is used up right now.",
          };
      }
    }
    // A missing/unreadable allowance is not fatal: the burn still succeeds and
    // simply falls back to standard finality if the fast lane is full, so we do
    // not block fast on an allowance read we could not make.
  } catch {
    /* ignore — see above */
  }

  // maxFee = ceil(units * feeBps / 10_000), fractional bps carried at 1e6, with
  // a 2x buffer. It is a cap Circle deducts up to, so a generous buffer only
  // protects against the fee rising; the recipient still pays the actual fee.
  const feeBpsScaled = BigInt(Math.round(feeBps * 1e6)); // bps * 1e6
  // units * (bps/10000) = units * feeBpsScaled / 1e10
  const base = (units * feeBpsScaled + 10_000_000_000n - 1n) / 10_000_000_000n;
  const maxFeeUnits = base * 2n;

  return { ok: true, maxFeeUnits, feeBps };
}
