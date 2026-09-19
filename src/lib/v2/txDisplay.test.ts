import {
  displayTxDetail,
  displayTxTitle,
  formatTxAmount,
} from "./txDisplay.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${label}:`, { actual, expected });
  } else {
    console.log(`ok   ${label}`);
  }
}

check(
  "large amount uses grouping and bounded precision",
  formatTxAmount("11613.4852943464157702"),
  "11,613.485294",
);
check(
  "short integer stays compact",
  displayTxTitle("Swap 2 USDC for ARGUS"),
  "Swap 2 USDC → ARGUS",
);
check(
  "long swap amount is readable",
  displayTxTitle("Swap 11613.4852943464157702 ARGUS for USDC"),
  "Swap 11,613.485294 ARGUS → USDC",
);
check(
  "slippage detail becomes a minimum received label",
  displayTxDetail("At least 217.373647 USDC after slippage."),
  "Min. received 217.373647 USDC",
);
check(
  "route detail is compact without losing the path",
  displayTxDetail(
    "Through USDC → WETH → ARGUS. At least 217.373647 ARGUS after slippage.",
  ),
  "Through USDC → WETH → ARGUS · Min. received 217.373647 ARGUS",
);
check(
  "approval detail is concise",
  displayTxDetail("One-time approval."),
  "Approval",
);

if (failures) process.exit(1);
