import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/serverClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Record one question and which net answered it. See
 * supabase/migrations/20260910000000_agent_questions.sql for why.
 *
 * FIRE-AND-FORGET FROM THE CLIENT, AND IT MUST NEVER HURT THE TURN. The page
 * calls this after it has already answered, with `keepalive` so a navigation
 * does not cancel it, and ignores the result. So this route never returns an
 * error the page could act on: a bad body, a missing service key and a failed
 * insert all end in the same 204, logged server-side. A logging endpoint that
 * can fail a user's question has its priorities backwards.
 *
 * WHAT IS ACCEPTED. The question, capped at 500 characters — the table checks
 * the same bound, and a longer one is truncated here rather than refused, since
 * the first 500 characters of a question are still the question. A route label
 * from a closed vocabulary shape, so the table cannot fill with arbitrary
 * strings. An optional chain and address; the address is hashed before it is
 * stored and the hash is short on purpose.
 */
const ROUTE = /^(faq|docs|command|asks):[a-zA-Z0-9_-]{1,32}$|^model$/;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
    const route = typeof body?.route === "string" ? body.route : "";
    if (!question || !ROUTE.test(route)) return new NextResponse(null, { status: 204 });

    const chainId = typeof body?.chainId === "number" && Number.isInteger(body.chainId) ? body.chainId : null;
    const address = typeof body?.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.address) ? body.address : null;
    const askerHash = address
      ? createHash("sha256").update(address.toLowerCase()).digest("hex").slice(0, 16)
      : null;

    if (!supabaseAdmin) return new NextResponse(null, { status: 204 });
    const { error } = await supabaseAdmin
      .from("agent_questions")
      .insert({ question, route, chain_id: chainId, asker_hash: askerHash });
    if (error) console.error("[agent/log] insert failed:", error.message);
  } catch (err) {
    console.error("[agent/log]", (err as Error).message);
  }
  return new NextResponse(null, { status: 204 });
}
