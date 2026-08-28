import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { CODE_LENGTH, normaliseCode } from "@/lib/beta";

/**
 * Verifies a private-testnet access code.
 *
 * WHY THIS IS A SERVER ROUTE AND NOT A STRING COMPARISON IN THE COMPONENT.
 * This repository is public. A code compared in the browser has to ship in the
 * browser bundle, which means it is one Ctrl-F away in a `.js` chunk — and if it
 * were committed to source instead, it would be readable on GitHub without even
 * loading the app. Either way anyone can walk past the waitlist form the code
 * exists to reward, which is the whole point of the gate. So the code lives in
 * `BETA_ACCESS_CODE`, a server-only variable (no NEXT_PUBLIC_ prefix, or Next
 * would inline it), and the only thing that crosses to the browser is yes or no.
 *
 * WHAT THIS IS NOT. It is not an authorization boundary. The gate it serves is a
 * blur over the app shell, so the page behind it still renders and still reads
 * public chain state, and a determined visitor can set the localStorage flag by
 * hand and skip the card. That is the nature of what was asked for — a screen in
 * front of the product, not a wall around it. Making it a real boundary means
 * refusing to serve the app's HTML at all, which is a middleware plus an
 * httpOnly cookie set here, and it costs the blurred-app-behind-the-card effect.
 *
 * The comparison is constant-time over SHA-256 digests, matching
 * /api/push/send's shared-secret check: hashing first is what guarantees
 * timingSafeEqual gets equal-length buffers, since it throws on a length
 * mismatch and catching that throw would leak the code's length.
 *
 * There is no rate limit here, deliberately. 36^6 is 2.2 billion codes and this
 * runs on a serverless platform where in-process counters do not survive between
 * invocations, so a counter would be theatre. If the code is ever shortened, or
 * more than one is issued, that changes and the limiter belongs in front.
 */

const CODE = normaliseCode(process.env.BETA_ACCESS_CODE ?? "");

function codeMatches(provided: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(CODE).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  /*
   * Two distinct misconfigurations, both answered with a 503 and a sentence
   * naming the variable, because both look identical from the card otherwise:
   * every code entered comes back wrong and there is nothing on screen to say
   * the deployment is missing its configuration rather than the visitor
   * mistyping. The client surfaces this as its own message for that reason.
   *
   * Refusing rather than falling open: a deployment that has lost its access
   * code should keep everyone out, not let everyone in.
   */
  if (!CODE) {
    return NextResponse.json(
      {
        ok: false,
        reason: "unconfigured",
        error: "BETA_ACCESS_CODE is not set on this deployment.",
      },
      { status: 503 },
    );
  }
  if (CODE.length !== CODE_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        reason: "unconfigured",
        error: `BETA_ACCESS_CODE normalises to ${CODE.length} characters; the card can only submit ${CODE_LENGTH}.`,
      },
      { status: 503 },
    );
  }

  let provided = "";
  try {
    const body: unknown = await request.json();
    const raw = (body as { code?: unknown } | null)?.code;
    if (typeof raw === "string") provided = normaliseCode(raw);
  } catch {
    /* No body, or not JSON. Falls through as an empty code and 401s. */
  }

  /* Length checked before the digest compare. It leaks nothing: the card shows
     six boxes, so the length is already on screen. */
  if (provided.length !== CODE_LENGTH || !codeMatches(provided)) {
    return NextResponse.json({ ok: false, reason: "wrong" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
