export type TaskStatus =
  | "created"
  | "researching"
  | "awaiting_input"
  | "preparing"
  | "checking"
  | "awaiting_approval"
  | "submitting"
  | "confirming"
  | "completed"
  | "partially_completed"
  | "paused"
  | "cancelled"
  | "failed";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed";

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStepStatus;
  txHash?: string;
  error?: string;
}

export interface AgentTask {
  id: string;
  idempotencyKey: string;
  objective: string;
  contextVersion: string;
  status: TaskStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  steps: TaskStep[];
  appliedEventIds: string[];
  lastError?: string;
}

export interface CreateTaskInput {
  id: string;
  idempotencyKey: string;
  objective: string;
  contextVersion: string;
  steps?: TaskStep[];
  now?: string;
}

export interface TaskTransitionInput {
  eventId: string;
  status: TaskStatus;
  now?: string;
  error?: string;
  steps?: TaskStep[];
}

export interface TaskStore {
  get(idempotencyKey: string): Promise<AgentTask | null>;
  put(task: AgentTask, expectedRevision: number): Promise<AgentTask>;
}

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["researching", "awaiting_input", "cancelled"],
  researching: ["awaiting_input", "preparing", "paused", "cancelled", "failed"],
  awaiting_input: ["preparing", "paused", "cancelled"],
  preparing: ["checking", "paused", "cancelled", "failed"],
  checking: ["awaiting_approval", "submitting", "paused", "cancelled", "failed"],
  awaiting_approval: ["submitting", "paused", "cancelled"],
  submitting: ["confirming", "partially_completed", "paused", "failed"],
  confirming: ["completed", "partially_completed", "paused", "failed"],
  completed: [],
  partially_completed: ["preparing", "confirming", "paused", "cancelled", "failed", "completed"],
  paused: ["researching", "awaiting_input", "preparing", "checking", "awaiting_approval", "submitting", "confirming", "cancelled"],
  cancelled: [],
  failed: ["researching", "preparing", "cancelled"],
};

function validTimestamp(value: string | undefined): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

export function createTask(input: CreateTaskInput): AgentTask {
  if (!input.id || !input.idempotencyKey || !input.objective || !input.contextVersion) {
    throw new Error("Task id, idempotency key, objective, and context version are required.");
  }
  const now = validTimestamp(input.now);
  return {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    objective: input.objective.trim(),
    contextVersion: input.contextVersion,
    status: "created",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    steps: input.steps?.map((step) => ({ ...step })) ?? [],
    appliedEventIds: [],
  };
}

/** Apply one idempotent event. Replaying the same event cannot advance twice. */
export function transitionTask(task: AgentTask, input: TaskTransitionInput): AgentTask {
  if (!input.eventId) throw new Error("Task transition eventId is required.");
  if (task.appliedEventIds.includes(input.eventId)) return task;
  if (task.status === input.status) {
    return {
      ...task,
      revision: task.revision + 1,
      updatedAt: validTimestamp(input.now),
      appliedEventIds: [...task.appliedEventIds, input.eventId],
      ...(input.steps ? { steps: input.steps.map((step) => ({ ...step })) } : {}),
      ...(input.error ? { lastError: input.error } : {}),
    };
  }
  if (!TRANSITIONS[task.status].includes(input.status)) {
    throw new Error(`Invalid task transition: ${task.status} → ${input.status}.`);
  }
  return {
    ...task,
    status: input.status,
    revision: task.revision + 1,
    updatedAt: validTimestamp(input.now),
    appliedEventIds: [...task.appliedEventIds, input.eventId],
    ...(input.steps ? { steps: input.steps.map((step) => ({ ...step })) } : {}),
    ...(input.error ? { lastError: input.error } : {}),
  };
}

/**
 * Store seam for a worker implementation. The optimistic revision prevents
 * two Hostinger workers from advancing the same task concurrently.
 */
export async function persistTask(
  store: TaskStore,
  task: AgentTask,
): Promise<AgentTask> {
  return store.put(task, task.revision - 1);
}
