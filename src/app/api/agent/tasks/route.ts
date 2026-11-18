import { NextRequest, NextResponse } from "next/server";
import { resolveQuotaIdentity } from "@/lib/ai/quotaIdentity";
import {
  createDurableTaskStore,
  taskPersistenceStatus,
} from "@/lib/ai/taskCheckpoint";
import {
  createTask,
  isTerminalTaskStatus,
  persistTask,
  resumeTask,
  transitionTask,
  type AgentTask,
  type TaskStatus,
  type TaskStep,
} from "@/lib/ai/taskRuntime";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: NextRequest) {
  const rawAddress = request.nextUrl.searchParams.get("address") ?? "";
  if (!VALID_ADDRESS.test(rawAddress)) {
    return NextResponse.json(
      { ok: false, error: "Valid wallet address is required." },
      { status: 400 },
    );
  }
  const address = rawAddress.toLowerCase();
  if (!supabaseAdmin) {
    return NextResponse.json({
      ok: true,
      persistence: taskPersistenceStatus(),
      tasks: [],
    });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("agent_tasks")
      .select("payload")
      .eq("payload->>address", address)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    const tasks = (data ?? [])
      .map((row) => (row as { payload?: AgentTask }).payload)
      .filter((t): t is AgentTask => Boolean(t));
    return NextResponse.json({
      ok: true,
      persistence: taskPersistenceStatus(),
      tasks,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const identity = await resolveQuotaIdentity({
      address: body.address,
      signature: body.quotaSignature,
      signedAt: body.quotaSignedAt,
    });
    if (identity.error) {
      return NextResponse.json({ error: identity.error }, { status: 401 });
    }
    if (!identity.address) {
      return NextResponse.json(
        { error: "Valid wallet address is required." },
        { status: 400 },
      );
    }

    const store = createDurableTaskStore();
    if (!store) {
      return NextResponse.json(
        { error: "Durable task persistence is not configured." },
        { status: 503 },
      );
    }

    const action = String(body.action ?? "");
    const rawKey = String(body.idempotencyKey ?? "").trim();
    if (!rawKey) {
      return NextResponse.json(
        { error: "idempotencyKey is required." },
        { status: 400 },
      );
    }
    const scopedKey = rawKey.startsWith(`${identity.address}:`)
      ? rawKey
      : `${identity.address}:${rawKey}`;

    if (action === "create") {
      const existing = await store.get(scopedKey);
      if (existing) {
        return NextResponse.json({ ok: true, task: existing });
      }
      const task = createTask({
        id: String(body.id ?? `task-${Date.now().toString(36)}`),
        idempotencyKey: scopedKey,
        address: identity.address,
        objective: String(body.objective ?? ""),
        contextVersion: String(body.contextVersion ?? "v1"),
        steps: Array.isArray(body.steps) ? (body.steps as TaskStep[]) : undefined,
      });
      const saved = await store.put(task, -1);
      return NextResponse.json({ ok: true, task: saved });
    }

    const existing = await store.get(scopedKey);
    if (!existing) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (existing.address && existing.address !== identity.address) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const eventId = String(body.eventId ?? `ev-${Date.now().toString(36)}`);

    if (action === "resume") {
      const next = resumeTask(existing, eventId);
      const saved = next === existing ? existing : await persistTask(store, next);
      return NextResponse.json({ ok: true, task: saved });
    }

    if (action === "cancel") {
      if (isTerminalTaskStatus(existing.status)) {
        return NextResponse.json({ ok: true, task: existing });
      }
      const next = transitionTask(existing, {
        eventId,
        status: "cancelled",
      });
      const saved = await persistTask(store, next);
      return NextResponse.json({ ok: true, task: saved });
    }

    if (action === "transition") {
      const status = String(body.status ?? "") as TaskStatus;
      const next = transitionTask(existing, {
        eventId,
        status,
        steps: Array.isArray(body.steps) ? (body.steps as TaskStep[]) : undefined,
        error: typeof body.error === "string" ? body.error : undefined,
      });
      const saved = await persistTask(store, next);
      return NextResponse.json({ ok: true, task: saved });
    }

    return NextResponse.json(
      { error: `Unsupported task action: ${action}` },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
