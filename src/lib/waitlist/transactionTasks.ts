export type TransactionTask = "arcMainnet" | "agent" | "bridge";

export const TRANSACTION_TASK_POINTS: Record<TransactionTask, number> = {
  arcMainnet: 300,
  agent: 500,
  bridge: 500,
};

export type TransactionTaskTimestamps = Partial<
  Record<"arc_mainnet_tx_at" | "agent_tx_at" | "bridge_tx_at", string | null>
>;

/** Completed task grants remain visible on the waitlist card after activation. */
export function transactionTaskPointsFor(
  row: TransactionTaskTimestamps,
): number {
  return (
    (row.arc_mainnet_tx_at ? TRANSACTION_TASK_POINTS.arcMainnet : 0) +
    (row.agent_tx_at ? TRANSACTION_TASK_POINTS.agent : 0) +
    (row.bridge_tx_at ? TRANSACTION_TASK_POINTS.bridge : 0)
  );
}

export const transactionTaskColumn = (task: TransactionTask) =>
  task === "arcMainnet"
    ? "arc_mainnet_tx_at"
    : task === "agent"
      ? "agent_tx_at"
      : "bridge_tx_at";

/** Stable idempotency key for a task credit written after activation. */
export const transactionTaskCreditHash = (
  wallet: string,
  task: TransactionTask,
) => `waitlist:task:${task}:${wallet.toLowerCase()}`;
