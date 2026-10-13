import { NextResponse } from "next/server";
import crypto from "crypto";
import { envVars } from "@/constants/envVars";

export async function GET(req: Request) {
  // Without a client id / redirect uri the authorize URL becomes
  // `client_id=undefined`, which X rejects with a confusing "Something went
  // wrong" page. Fail here with a clear message instead. (NEXT_PUBLIC_* is
  // inlined at build time, so setting these needs a redeploy to take effect.)
  if (!envVars.twitterClientId || !envVars.twitterRedirectUri) {
    return NextResponse.json(
      { error: "X sign-in isn't configured on this deployment." },
      { status: 503 },
    );
  }

  const state = crypto.randomBytes(32).toString("hex");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");

  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", envVars.twitterClientId!);
  url.searchParams.set("redirect_uri", envVars.twitterRedirectUri!);
  url.searchParams.set("scope", "tweet.read users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");

  const { origin, searchParams, hostname } = new URL(req.url);
  /*
   * The web domain is kaleidofi.xyz (apex + app.*). Scope the OAuth cookies to
   * `.kaleidofi.xyz` so a flow started on app.kaleidofi.xyz can be completed at
   * the fixed callback on kaleidofi.xyz. (The old check tested for
   * `kaleidofinance.xyz` — the GitHub org, never a web host — so it never matched:
   * cookies were host-only and not `secure`, and Link X only worked on the exact
   * host the callback lands on.)
   */
  const isKaleido =
    hostname === "kaleidofi.xyz" || hostname.endsWith(".kaleidofi.xyz");

  const cookieOptions = {
    httpOnly: true,
    secure: isKaleido,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
    ...(isKaleido && { domain: ".kaleidofi.xyz" }),
  };

  const response = NextResponse.redirect(url.toString());

  response.cookies.set("twitter_oauth_state", state, cookieOptions);
  response.cookies.set("twitter_code_verifier", codeVerifier, cookieOptions);

  /*
   * Return the user to the subdomain they started on. The callback host is fixed
   * (it is the registered redirect_uri), so we store the FULL origin here — this
   * start route runs on whichever subdomain the user is on — and the callback
   * redirects back to it after validating the host. Only a same-origin path is
   * accepted (must start with a single "/"), so this can't become an open
   * redirect. Absent → the callback keeps its /portfolio default (header Link X).
   */
  const returnPath = searchParams.get("returnTo");
  if (returnPath && /^\/(?!\/)/.test(returnPath)) {
    response.cookies.set("twitter_return_to", `${origin}${returnPath}`, cookieOptions);
  }

  /*
   * This used to log `{ state, codeVerifier, origin, isProduction }`.
   *
   * The code verifier is the PKCE secret: it is the one value that proves the
   * party redeeming the authorization code is the party that started the flow,
   * which is the whole reason PKCE exists. Printing it to the server log writes
   * it somewhere with a different retention and a different audience from the
   * httpOnly cookie it was deliberately put in. Nothing debugged with it that
   * "cookie set / not set" does not answer, and the callback already logs that.
   */
  return response;
}
