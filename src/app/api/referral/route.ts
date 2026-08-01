import { NextRequest, NextResponse } from "next/server"
import { ethers, isAddress } from "ethers"
import kaleidoAbi from "@/abi/ProtocolFacet.json"
import { envVars } from "@/constants/envVars"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * POST /api/referral — registers an upliner→downliner link on-chain.
 *
 * registerUpliner is owner-gated (LibDiamond.enforceIsContractOwner), so the
 * caller must be the Diamond owner. That key therefore MUST stay server-side:
 * it can also call diamondCut. It is read from PRIVATE_KEY — deliberately
 * without a NEXT_PUBLIC_ prefix, which would inline it into the browser bundle.
 *
 * This is intentionally a thin, self-contained seam. A fuller referral system
 * (tiers, attribution windows, reward accrual, off-chain indexing) should
 * replace the body of registerReferral() below without changing this route's
 * contract with the client.
 */

/** Minimum ms between registrations from one downliner address. */
const RATE_LIMIT_MS = 60_000

/**
 * In-memory rate limit. Adequate for a single instance; it resets on deploy
 * and is not shared across serverless instances. Move to Supabase or Redis
 * when the real referral system lands.
 */
const lastSeen = new Map<string, number>()

type Failure = { status: number; error: string }

const fail = (status: number, error: string): Failure => ({ status, error })

export async function POST(request: NextRequest) {
  let upliner: unknown
  let downliner: unknown

  try {
    const body = await request.json()
    upliner = body?.upliner
    downliner = body?.downliner
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 })
  }

  // --- Validation. Mirrors the contract's own guards so we fail fast and
  // cheaply rather than paying gas to revert. ---
  if (typeof upliner !== "string" || !isAddress(upliner)) {
    return NextResponse.json({ error: "upliner must be a valid address." }, { status: 400 })
  }
  if (typeof downliner !== "string" || !isAddress(downliner)) {
    return NextResponse.json({ error: "downliner must be a valid address." }, { status: 400 })
  }
  if (upliner.toLowerCase() === downliner.toLowerCase()) {
    return NextResponse.json({ error: "An address cannot refer itself." }, { status: 400 })
  }

  const key = downliner.toLowerCase()
  const previous = lastSeen.get(key)
  if (previous && Date.now() - previous < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 },
    )
  }

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    console.error("[referral] PRIVATE_KEY is not set — cannot sign.")
    return NextResponse.json(
      { error: "Referral registration is unavailable." },
      { status: 503 },
    )
  }

  const diamond = envVars.lendbitDiamondAddress
  if (!diamond) {
    console.error("[referral] NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS is not set.")
    return NextResponse.json(
      { error: "Referral registration is unavailable." },
      { status: 503 },
    )
  }

  try {
    const provider = new ethers.JsonRpcProvider(envVars.httpRPCab || envVars.httpRPC)
    const signer = new ethers.Wallet(privateKey, provider)
    const contract = new ethers.Contract(diamond, kaleidoAbi, signer)

    // Dry-run first. The contract reverts if the downliner already has an
    // upliner, so this distinguishes "already registered" from a real failure
    // without spending gas.
    try {
      await contract.registerUpliner.staticCall(upliner, downliner)
    } catch (error) {
      const reason = String((error as Error)?.message ?? "")
      if (reason.includes("DownlinerAlreadyHasUpliner")) {
        // Already linked. The desired end state holds, so report success —
        // the client re-fires this on every page load with a stored referral.
        return NextResponse.json({ status: "already_registered" })
      }
      if (reason.includes("UplinerCannotBeDownliner")) {
        return NextResponse.json({ error: "An address cannot refer itself." }, { status: 400 })
      }
      if (reason.includes("InvalidAddress")) {
        return NextResponse.json({ error: "Invalid address." }, { status: 400 })
      }
      console.error("[referral] staticCall reverted:", reason)
      return NextResponse.json({ error: "Referral could not be registered." }, { status: 400 })
    }

    lastSeen.set(key, Date.now())

    const tx = await contract.registerUpliner(upliner, downliner)
    const receipt = await tx.wait()

    return NextResponse.json({
      status: "registered",
      transactionHash: receipt?.hash ?? tx.hash,
    })
  } catch (error) {
    // Never surface the raw error — it can carry RPC URLs and signer detail.
    console.error("[referral] registration failed:", error)
    return NextResponse.json({ error: "Referral could not be registered." }, { status: 500 })
  }
}
