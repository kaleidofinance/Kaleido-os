import { NextResponse } from "next/server"
import crypto from "crypto"
import { envVars } from "@/constants/envVars"

export async function GET(req: Request) {
  const state = crypto.randomBytes(32).toString("hex")
  const codeVerifier = crypto.randomBytes(32).toString("base64url")

  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")

  const url = new URL("https://x.com/i/oauth2/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", envVars.twitterClientId!)
  url.searchParams.set("redirect_uri", envVars.twitterRedirectUri!)
  url.searchParams.set("scope", "tweet.read users.read offline.access")
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("prompt", "consent")

  const { origin } = new URL(req.url)
  const isProduction = origin.includes("kaleidofinance.xyz")

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
    ...(isProduction && { domain: ".kaleidofinance.xyz" }),
  }

  const response = NextResponse.redirect(url.toString())

  response.cookies.set("twitter_oauth_state", state, cookieOptions)
  response.cookies.set("twitter_code_verifier", codeVerifier, cookieOptions)

  console.log("Setting cookies:", { state, codeVerifier, origin, isProduction })

  return response
}
