import { verifyMessage } from "ethers";
import { cookies } from "next/headers";

import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

/**
 * Waitlist X (Twitter) tasks: link an X account to the wallet, then attest the
 * follow, retweet and comment tasks. Follow/retweet are +100 kPoint and comment
 * is +50 (held ~5h on the client as a nudge, then counted; converted to Season 1
 * only on Arc-mainnet activation). Point values live in api/waitlist/route.ts.
 *
 * GET  -> the current X session from the httpOnly `twitter_user` cookie set by
 *         the OAuth callback: { linked, handle, id }.
 * POST -> record a task for the wallet. Every task is signature-gated (the wallet
 *         must sign the exact task message), so a task can only be recorded by the
 *         wallet's holder. `link` also reads the X cookie to bind the account, and
 *         the X id is unique across wallets, so one X account enriches one wallet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Task = "link" | "follow" | "retweet" | "comment" | "launch";
const TASKS: Task[] = ["link", "follow", "retweet", "comment", "launch"];

/** The exact strings the client signs, rebuilt here from the posted address.
 * Not exported: a route module may only export HTTP handlers + route config, and
 * a stray export fails `next build` (tsc does not catch it). The client keeps its
 * own copy of this in the waitlist page — they must stay in sync. */
const xTaskMessage = (address: string, task: Task) =>
  task === "link"
    ? `Link my X account to the Kaleido waitlist wallet ${address}.`
    : `Confirm my Kaleido waitlist X ${task} for wallet ${address}.`;

const isAddress = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

function xSession(): { linked: boolean; handle: string | null; id: string | null } {
  try {
    const raw = cookies().get("twitter_user")?.value;
    if (!raw) return { linked: false, handle: null, id: null };
    const u = JSON.parse(raw) as { id?: string; username?: string };
    return { linked: Boolean(u.username), handle: u.username ?? null, id: u.id ?? null };
  } catch {
    return { linked: false, handle: null, id: null };
  }
}

export async function GET() {
  return Response.json(xSession());
}

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  const admin = supabaseAdmin;

  let body: { address?: string; signature?: string; task?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const { address, signature, task } = body;
  if (!isAddress(address) || typeof signature !== "string" || !TASKS.includes(task as Task))
    return Response.json({ error: "bad input" }, { status: 400 });
  const t = task as Task;

  // The wallet must sign the exact task message.
  let recovered: string;
  try {
    recovered = verifyMessage(xTaskMessage(address, t), signature);
  } catch {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  if (recovered.toLowerCase() !== address.toLowerCase())
    return Response.json({ error: "signature mismatch" }, { status: 401 });

  const wallet = address.toLowerCase();

  // Must be a registered waitlister.
  const { data: row } = await admin
    .from("waitlist")
    .select(
      "wallet, x_user_id, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_launch_at",
    )
    .eq("wallet", wallet)
    .single();
  if (!row) return Response.json({ error: "not registered" }, { status: 404 });

  const now = new Date().toISOString();

  if (t === "link") {
    // Bind the X account established by the OAuth callback's cookie.
    const sess = xSession();
    if (!sess.linked || !sess.id)
      return Response.json({ error: "link X first" }, { status: 409 });

    // Idempotent: already bound to this wallet → fine.
    if (row.x_user_id && row.x_user_id === sess.id)
      return Response.json({ ok: true, already: true });
    if (row.x_user_id && row.x_user_id !== sess.id)
      return Response.json({ error: "wallet already linked to a different X" }, { status: 409 });

    // One X account → one wallet.
    const { data: taken } = await admin
      .from("waitlist")
      .select("wallet")
      .eq("x_user_id", sess.id)
      .maybeSingle();
    if (taken && taken.wallet !== wallet)
      return Response.json({ error: "this X is already linked to another wallet" }, { status: 409 });

    const { error } = await admin
      .from("waitlist")
      .update({ x_user_id: sess.id, x_handle: sess.handle, x_linked_at: now })
      .eq("wallet", wallet)
      .is("x_linked_at", null);
    if (error) return Response.json({ error: "link failed" }, { status: 500 });
    return Response.json({ ok: true });
  }

  // follow / retweet / comment: X must be linked first.
  if (!row.x_linked_at)
    return Response.json({ error: "link X first" }, { status: 409 });

  const COL: Record<"follow" | "retweet" | "comment" | "launch", string> = {
    follow: "x_followed_at",
    retweet: "x_retweeted_at",
    comment: "x_commented_at",
    launch: "x_launch_at",
  };
  const col = COL[t as "follow" | "retweet" | "comment" | "launch"];
  const existing = row[col as keyof typeof row];
  if (existing) return Response.json({ ok: true, already: true });

  const { error } = await admin
    .from("waitlist")
    .update({ [col]: now })
    .eq("wallet", wallet)
    .is(col, null);
  if (error) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}
