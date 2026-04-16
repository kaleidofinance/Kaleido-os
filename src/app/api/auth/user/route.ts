import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") || ""
  const cookies = Object.fromEntries(
    cookieHeader.split("; ").map((c) => {
      const [key, ...v] = c.split("=")
      return [key, decodeURIComponent(v.join("="))]
    }),
  )

  const userCookie = cookies["twitter_user"]
  if (!userCookie) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const user = JSON.parse(userCookie)
    return NextResponse.json(user)
  } catch {
    return NextResponse.json({ error: "Invalid user data" }, { status: 400 })
  }
}
