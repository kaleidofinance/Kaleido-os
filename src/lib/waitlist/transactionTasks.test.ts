import {
  TRANSACTION_TASK_POINTS,
  transactionTaskColumn,
  transactionTaskCreditHash,
} from "./transactionTasks";

const checks: [string, boolean][] = [
  ["Arc task is worth 300", TRANSACTION_TASK_POINTS.arcMainnet === 300],
  ["Kaleido task is worth 500", TRANSACTION_TASK_POINTS.agent === 500],
  ["bridge task is worth 500", TRANSACTION_TASK_POINTS.bridge === 500],
  [
    "Arc task uses the Arc column",
    transactionTaskColumn("arcMainnet") === "arc_mainnet_tx_at",
  ],
  [
    "task credit hash is wallet-scoped and stable",
    transactionTaskCreditHash("0xABC", "agent") === "waitlist:task:agent:0xabc",
  ],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`ok: ${name}`);
}
