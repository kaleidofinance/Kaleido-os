import { envVars } from "@/constants/envVars";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    console.log("Search params:", Object.fromEntries(searchParams));

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    if (!state) {
      return NextResponse.json({ error: "Missing state" }, { status: 400 });
    }

    // Retrieve cookies with detailed logging
    const cookieStore = cookies();
    const allCookies = cookieStore.getAll();
    console.log(
      "All cookies:",
      allCookies.map((c) => ({ name: c.name, hasValue: !!c.value })),
    );

    const storedState = cookieStore.get("twitter_oauth_state")?.value;
    const codeVerifier = cookieStore.get("twitter_code_verifier")?.value;

    console.log("Cookie values:", {
      storedState: storedState ? "present" : "missing",
      codeVerifier: codeVerifier ? "present" : "missing",
      receivedState: state ? "present" : "missing",
    });

    if (!storedState) {
      return NextResponse.json(
        {
          error: "Missing stored state",
          debug: { allCookies: allCookies.map((c) => c.name) },
        },
        { status: 400 },
      );
    }

    if (state !== storedState) {
      return NextResponse.json(
        {
          error: "Invalid state",
          debug: { stateMatch: false },
        },
        { status: 400 },
      );
    }

    if (!codeVerifier) {
      return NextResponse.json(
        {
          error: "Missing code verifier",
          debug: {
            allCookies: allCookies.map((c) => c.name),
            expectedCookie: "twitter_code_verifier",
          },
        },
        { status: 400 },
      );
    }

    /*
     * The OAuth client secret, read straight off process.env rather than
     * through envVars.
     *
     * It lived at `envVars.twitterApiKey` (NEXT_PUBLIC_TWITTER_KEY), which
     * shipped it to the browser: Next inlines every NEXT_PUBLIC_ variable at
     * build time, and envVars is imported by client components, so the secret
     * that signs this exchange was a string in the JS bundle. Same rule as the
     * signing key — see the note in src/constants/envVars.ts.
     *
     * Checked before the fetch so an unconfigured deployment says so, instead
     * of sending `Basic <clientId:undefined>` and reporting X's rejection as a
     * generic "Token exchange failed".
     */
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    if (!clientSecret) {
      console.error("TWITTER_CLIENT_SECRET is not set");
      return NextResponse.json(
        { error: "X sign-in isn't configured on this deployment" },
        { status: 500 },
      );
    }

    const basicAuth = Buffer.from(
      `${envVars.twitterClientId}:${clientSecret}`,
    ).toString("base64");

    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: envVars.twitterClientId!,
        redirect_uri: envVars.twitterRedirectUri!,
        code,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      return NextResponse.json(
        { error: "Token exchange failed", details: error },
        { status: 500 },
      );
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      const error = await userResponse.text();
      return NextResponse.json(
        { error: "Failed to fetch user info", details: error },
        { status: 500 },
      );
    }

    const userData = await userResponse.json();

    // The legacy /verify page is gone. The cookie below still drives
    // /api/auth/user, which is what the header's Link X control reads — see
    // src/components/v2/LinkX.tsx.
    const response = NextResponse.redirect(new URL("/portfolio", req.url));

    response.cookies.delete("twitter_oauth_state");
    response.cookies.delete("twitter_code_verifier");

    // Set user cookie
    response.cookies.set(
      "twitter_user",
      JSON.stringify({
        username: userData.data.username,
        name: userData.data.name,
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        /*
         * 30 days, up from 10 minutes.
         *
         * Ten minutes was survivable while the only reader was a /verify page
         * you had just been redirected to. It is not survivable for a header
         * control that shows the linked handle on every page: the pill would
         * revert to "Link X" mid-session, which reads as the link having failed
         * rather than as a cookie having expired, and sends the user back
         * through an OAuth round trip they already completed.
         *
         * Nothing is being extended here except a display fact. This cookie
         * carries `{username, name}` — a public handle — and no access or
         * refresh token: `tokenData` above is used for the one /2/users/me call
         * and then dropped. So the lifetime is a session-length question, not a
         * credential-lifetime one.
         */
        maxAge: 60 * 60 * 24 * 30,
      },
    );

    return response;
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
