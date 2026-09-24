import type { ArgusPlanResult } from "@/lib/v2/intents/build";

/**
 * Client → server resolver for an Argus-launchpad buy. POSTs to /api/argus/plan,
 * which reads the launch + pool, quotes tax-aware, applies the Kaleido fee (its
 * receiver is a server-only env) and builds the v4 calldata. Injected as
 * `deps.argusPlan` in useLocalPlanner — the sibling of resolveSwapRoute, and
 * trusted the same way: the `to`/`data` it returns are the origin of an
 * `argusSwap` Intent, come from our own server (not the model) and target a
 * router the auditor pins to the Argus UniversalRouter constant.
 *
 * Returns `{argus:false}` on anything that isn't a tradable Argus buy (not a
 * launch, disabled, a bad response) so the caller falls through to normal
 * routing rather than throwing.
 */
export async function resolveArgusPlan(req: {
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  slippageBps: number;
}): Promise<ArgusPlanResult | null> {
  try {
    const res = await fetch("/api/argus/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return { argus: false };
    const json = (await res.json()) as ArgusPlanResult & { error?: string };
    if (json.error) return { argus: false };
    return json;
  } catch {
    // A network hiccup must not throw mid-plan — fall through to normal routing.
    return { argus: false };
  }
}
