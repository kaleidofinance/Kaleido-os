"use client";

import { useCallback, useEffect, useState } from "react";
import type { Account } from "thirdweb/wallets";
import { quotaSessionMessage } from "@/lib/ai/quotaIdentity";
import {
  isTerminalTaskStatus,
  type AgentTask,
  type TaskStep,
} from "@/lib/ai/taskRuntime";

async function getQuotaAuth(
  address: string,
  account?: Account | null,
): Promise<{ quotaSignature?: string; quotaSignedAt?: number }> {
  if (!account?.signMessage) return {};
  const lower = address.toLowerCase();
  const key = `luca:quotaSession:${lower}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        signature?: string;
        signedAt?: number;
      };
      if (
        typeof parsed.signature === "string" &&
        typeof parsed.signedAt === "number" &&
        Date.now() - parsed.signedAt < 12 * 60 * 60 * 1000
      ) {
        return {
          quotaSignature: parsed.signature,
          quotaSignedAt: parsed.signedAt,
        };
      }
    }
  } catch {
    /* ignore session read errors */
  }

  try {
    const now = Date.now();
    const message = quotaSessionMessage(lower, now);
    const signature = await account.signMessage({ message });
    try {
      sessionStorage.setItem(key, JSON.stringify({ signature, signedAt: now }));
    } catch {
      /* ignore session write errors */
    }
    return { quotaSignature: signature, quotaSignedAt: now };
  } catch {
    return {};
  }
}

export function useAgentTasks(
  address?: string | null,
  account?: Account | null,
) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/agent/tasks?address=${encodeURIComponent(address)}`,
      );
      const data = await res.json();
      if (data.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        setError(null);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeTask = tasks.find((t) => !isTerminalTaskStatus(t.status)) ?? null;

  const resumeTask = useCallback(
    async (task: AgentTask): Promise<boolean> => {
      if (!address) return false;
      const auth = await getQuotaAuth(address, account);
      try {
        const res = await fetch("/api/agent/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resume",
            idempotencyKey: task.idempotencyKey,
            address,
            ...auth,
          }),
        });
        const data = await res.json();
        if (data.ok && data.task) {
          setTasks((prev) =>
            prev.map((t) => (t.id === data.task.id ? data.task : t)),
          );
          return true;
        }
      } catch {
        // network or server error
      }
      return false;
    },
    [address, account],
  );

  const cancelTask = useCallback(
    async (task: AgentTask): Promise<boolean> => {
      if (!address) return false;
      const auth = await getQuotaAuth(address, account);
      try {
        const res = await fetch("/api/agent/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cancel",
            idempotencyKey: task.idempotencyKey,
            address,
            ...auth,
          }),
        });
        const data = await res.json();
        if (data.ok && data.task) {
          setTasks((prev) =>
            prev.map((t) => (t.id === data.task.id ? data.task : t)),
          );
          return true;
        }
      } catch {
        // network or server error
      }
      return false;
    },
    [address, account],
  );

  const createTask = useCallback(
    async (
      objective: string,
      steps?: TaskStep[],
    ): Promise<AgentTask | null> => {
      if (!address || !objective.trim()) return null;
      const auth = await getQuotaAuth(address, account);
      try {
        const idempotencyKey = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const res = await fetch("/api/agent/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            idempotencyKey,
            address,
            objective,
            steps,
            ...auth,
          }),
        });
        const data = await res.json();
        if (data.ok && data.task) {
          setTasks((prev) => [data.task, ...prev]);
          return data.task;
        }
      } catch {
        // error
      }
      return null;
    },
    [address, account],
  );

  return {
    tasks,
    activeTask,
    loading,
    error,
    refresh,
    resumeTask,
    cancelTask,
    createTask,
  };
}
