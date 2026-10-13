/**
 * Server-only LI.FI credentials and the monetization params they authorise.
 *
 * The integrator fee is attributed by an API key tied to our portal.li.fi
 * account, and that key is a secret: it must never reach the browser bundle. So
 * everything here is read from PLAIN env (never `NEXT_PUBLIC_`), which means on
 * the client these all read undefined. That is deliberate and load-bearing —
 * it is exactly why the browser routes bridge quotes through /api/bridge/quote
 * instead of calling li.quest itself: the proxy runs on the server, where these
 * values exist, and adds the fee and the key there. See getBridgeExecution in
 * lib/ai/bridgeQuotes.ts for the two paths.
 *
 * `LIFI_INTEGRATOR` — our registered integrator string ("kaleido-routes"). Not a
 *   secret, but kept here beside the others because the fee only means anything
 *   paired with the exact string the key is registered under.
 * `LIFI_FEE` — the fee as a decimal share (e.g. "0.002" = 0.2%). UNSET until fee
 *   collection is enabled on the portal AND `LIFI_API_KEY` is set: LI.FI returns
 *   400 for a `fee` on an unconfigured integrator, which getBridgeExecution turns
 *   into "no route", so an unset fee keeps every corridor working.
 * `LIFI_API_KEY` — the portal API key that authorises the fee. Without it LI.FI
 *   will not collect a fee even for a configured integrator.
 */

/** Our LI.FI integrator string, defaulting to the registered "kaleido-routes". */
export function lifiIntegrator(): string {
  return process.env.LIFI_INTEGRATOR || "kaleido-routes";
}

/**
 * The `integrator` (always) and `fee` (only once configured) query params. The
 * caller can neither omit the integrator nor forge the fee — both are decided
 * here, server-side.
 */
export function lifiMonetizationParams(): Record<string, string> {
  const params: Record<string, string> = { integrator: lifiIntegrator() };
  const fee = process.env.LIFI_FEE;
  if (fee) params.fee = fee;
  return params;
}

/** The API-key header, or nothing when no key is set (quotes still work). */
export function lifiAuthHeaders(): Record<string, string> {
  const key = process.env.LIFI_API_KEY;
  return key ? { "x-lifi-api-key": key } : {};
}
