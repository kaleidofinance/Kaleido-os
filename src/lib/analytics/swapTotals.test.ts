import assert from "node:assert/strict";
import { summarizeSwapTotals } from "./swapTotals";
const swaps = [
  { tx_hash: "0xAAA", usd_value: 100, fee_paid: true },
  { tx_hash: "0xbbb", usd_value: 50, fee_paid: false },
];
const result = summarizeSwapTotals(swaps, [
  { tx_hash: "0xaaa", usd_value: 99 },
  { tx_hash: "0xaaa", usd_value: 98 },
  { tx_hash: "0xbbb", usd_value: 50 },
  { tx_hash: "0xccc", usd_value: 25 },
]);
assert.deepEqual(result, { volumeUsd: 175, feeVolumeUsd: 100, swapCount: 3, partial: false });
const multi = summarizeSwapTotals([], [
  { tx_hash: "0xaaa", usd_value: 100 },
  { tx_hash: "0xaaa", usd_value: 99 },
]);
assert.deepEqual(multi, { volumeUsd: 100, feeVolumeUsd: 0, swapCount: 1, partial: true });
assert.deepEqual(summarizeSwapTotals([], []), { volumeUsd: 0, feeVolumeUsd: 0, swapCount: 0, partial: false });
console.log("PASS: native-only trades included; routed overlap deduplicated; LP legs not charged protocol fees; multi-hop uncertainty flagged.");
