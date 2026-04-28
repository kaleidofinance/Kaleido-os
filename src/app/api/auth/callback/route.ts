import { envVars } from "@/constants/envVars"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    console.log("Search params:", Object.fromEntries(searchParams))

    const code = searchParams.get("code")
    const state = searchParams.get("state")

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 })
    }

    if (!state) {
      return NextResponse.json({ error: "Missing state" }, { status: 400 })
    }

    // Retrieve cookies with detailed logging
    const cookieStore = cookies()
    const allCookies = cookieStore.getAll()
    console.log(
      "All cookies:",
      allCookies.map((c) => ({ name: c.name, hasValue: !!c.value })),
    )

    const storedState = cookieStore.get("twitter_oauth_state")?.value
    const codeVerifier = cookieStore.get("twitter_code_verifier")?.value

    console.log("Cookie values:", {
      storedState: storedState ? "present" : "missing",
      codeVerifier: codeVerifier ? "present" : "missing",
      receivedState: state ? "present" : "missing",
    })

    if (!storedState) {
      return NextResponse.json(
        {
          error: "Missing stored state",
          debug: { allCookies: allCookies.map((c) => c.name) },
        },
        { status: 400 },
      )
    }

    if (state !== storedState) {
      return NextResponse.json(
        {
          error: "Invalid state",
          debug: { stateMatch: false },
        },
        { status: 400 },
      )
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
      )
    }

    const basicAuth = Buffer.from(`${envVars.twitterClientId}:${envVars.twitterApiKey}`).toString("base64")

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
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      console.error("Token exchange failed:", error)
      return NextResponse.json({ error: "Token exchange failed", details: error }, { status: 500 })
    }

    const tokenData = await tokenResponse.json()

    const userResponse = await fetch("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    })

    if (!userResponse.ok) {
      const error = await userResponse.text()
      return NextResponse.json({ error: "Failed to fetch user info", details: error }, { status: 500 })
    }

    const userData = await userResponse.json()

    const response = NextResponse.redirect(new URL("/verify", req.url))

    response.cookies.delete("twitter_oauth_state")
    response.cookies.delete("twitter_code_verifier")

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
        maxAge: 60 * 10, // 10 minutes
      },
    )

    return response
  } catch (err) {
    console.error("API error:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
