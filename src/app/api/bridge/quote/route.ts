import { NextRequest, NextResponse } from "next/server";
import {
  lifiMonetizationParams,
  lifiAuthHeaders,
} from "@/lib/bridge/lifiServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/bridge/quote — the browser's keyed path to a LI.FI bridge quote.
 *
 * getBridgeExecution (lib/ai/bridgeQuotes.ts) runs in the browser as well as on
 * the server, and the integrator fee is authorised by an API key that must stay
 * a server secret. So the browser cannot call li.quest directly with the key; it
 * calls here instead. This route forwards ONLY the neutral quote params the
 * client sent, then adds our integrator, our fee, and the API-key header itself —
 * server-side, from lib/bridge/lifiServer — and returns li.quest's response
 * verbatim so the caller parses the identical shape whether it came direct
 * (server) or through here (browser).
 *
 * The integrator and fee are set HERE, not read from the request, on purpose: a
 * caller can neither drop our fee to route around it nor forge one, and the key
 * is never exposed. The upstream status is passed through unchanged so a 400
 * ("integrator not configured for fees") still surfaces to getBridgeExecution as
 * a non-ok response, i.e. "no route", exactly as a direct server call would.
 */

const LIFI_QUOTE = "https://li.quest/v1/quote";

/* Only these pass through. Everything else the client might append — an
   `integrator`, a `fee`, an `apiKey` — is dropped and replaced by our own, so
   this endpoint cannot be turned into an open relay for someone else's fee. */
const FORWARD_PARAMS = [
  "fromChain",
  "toChain",
  "fromToken",
  "toToken",
  "fromAmount",
  "fromAddress",
  "order",
  "denyBridges",
  "slippage",
];

export async function GET(req: NextRequest) {
  const incoming = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const key of FORWARD_PARAMS) {
    const value = incoming.get(key);
    if (value !== null) qs.set(key, value);
  }
  // Our monetization, decided server-side and last so it wins over any attempt
  // to smuggle these in through the forwarded set.
  for (const [key, value] of Object.entries(lifiMonetizationParams())) {
    qs.set(key, value);
  }

  try {
    const res = await fetch(`${LIFI_QUOTE}?${qs.toString()}`, {
      headers: lifiAuthHeaders(),
    });
    // Pass the upstream body and status straight through — including a 4xx, so
    // the caller reads the same "no route" it would from a direct call.
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { message: "bridge quote upstream unreachable" },
      { status: 502 },
    );
  }
}
