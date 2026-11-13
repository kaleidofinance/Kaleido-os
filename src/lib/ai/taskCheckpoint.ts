import { supabaseAdmin } from "@/lib/supabase/serverClient";
import type { AgentTask, TaskStore } from "./taskRuntime";

const TABLE = "agent_tasks";

/**
 * Durable task store for workers. The table is optional during rollout: when
 * the service-role client is absent we return null and callers can keep an
 * in-process store, but no task is silently reported as persisted.
 */
export function createDurableTaskStore(): TaskStore | null {
  if (!supabaseAdmin) return null;
  return {
    async get(idempotencyKey) {
      const { data, error } = await supabaseAdmin!
        .from(TABLE)
        .select("payload")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw new Error(`task read failed: ${error.message}`);
      return (data?.payload as AgentTask | null) ?? null;
    },
    async put(task, expectedRevision) {
      const query = supabaseAdmin!.from(TABLE);
      const { data, error } = expectedRevision < 0
        ? await query
            .insert({ task_id: task.id, idempotency_key: task.idempotencyKey, revision: task.revision, payload: task, updated_at: task.updatedAt })
            .select("payload, revision")
            .single()
        : await query
            .update({ task_id: task.id, revision: task.revision, payload: task, updated_at: task.updatedAt })
            .eq("idempotency_key", task.idempotencyKey)
            .eq("revision", expectedRevision)
            .select("payload, revision")
            .maybeSingle();
      if (error) throw new Error(`task write failed at revision ${expectedRevision}: ${error.message}`);
      if (!data) throw new Error(`task revision conflict at ${expectedRevision}`);
      return data?.payload as AgentTask;
    },
  };
}

export function taskPersistenceStatus(): "configured" | "unconfigured" {
  return supabaseAdmin ? "configured" : "unconfigured";
}
