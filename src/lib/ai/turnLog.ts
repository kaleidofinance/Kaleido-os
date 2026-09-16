import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * The durable record of one model turn — see
 * supabase/migrations/20260913000000_agent_turns.sql for what it holds and why.
 *
 * Called from /api/chat once a turn has ended, on every ending: a clean answer,
 * an auditor refusal, a provider failure, an exhausted quota, a safety block. It
 * is the operational half of the two logs — how the service behaved — and stores
 * no text a user typed, only the machine facts of the turn plus a short hash of
 * the address.
 *
 * AWAITED, not fire-and-forget. A serverless function can freeze the moment it
 * responds, so an un-awaited insert may never land; the insert is fast next to
 * the model call it records, so the turn awaits it. But it can NEVER hurt the
 * turn: a missing service key, a bad row and a network error all end in a logged
 * no-op, never a throw the handler would have to catch.
 */
export interface AgentTurnRecord {
  status: string;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  failedOver?: boolean | null;
  planSteps?: number | null;
  auditOk?: boolean | null;
  /** Read-rounds the loop ran (0 for a direct answer). See runAgent. */
  rounds?: number | null;
  /** Total read-tool calls across the turn — the trace length. */
  readCount?: number | null;
  stream?: boolean | null;
  chainId?: number | null;
  address?: string | null;
  /** A short error class, never a raw message or user data. */
  error?: string | null;
}

const hashAddress = (address?: string | null): string | null =>
  address && /^0x[0-9a-fA-F]{40}$/.test(address)
    ? createHash("sha256")
        .update(address.toLowerCase())
        .digest("hex")
        .slice(0, 16)
    : null;

export async function logAgentTurn(rec: AgentTurnRecord): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.from("agent_turns").insert({
      status: rec.status,
      provider: rec.provider ?? null,
      model: rec.model ?? null,
      latency_ms:
        typeof rec.latencyMs === "number" ? Math.round(rec.latencyMs) : null,
      failed_over: rec.failedOver ?? null,
      plan_steps: typeof rec.planSteps === "number" ? rec.planSteps : null,
      audit_ok: rec.auditOk ?? null,
      rounds: typeof rec.rounds === "number" ? rec.rounds : null,
      read_count: typeof rec.readCount === "number" ? rec.readCount : null,
      stream: rec.stream ?? null,
      chain_id: typeof rec.chainId === "number" ? rec.chainId : null,
      asker_hash: hashAddress(rec.address),
      error: rec.error ? rec.error.slice(0, 200) : null,
    });
    if (error) console.error("[turnLog] insert failed:", error.message);
  } catch (err) {
    console.error("[turnLog]", (err as Error).message);
  }
}
