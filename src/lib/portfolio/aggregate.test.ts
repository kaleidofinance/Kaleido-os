import { aggregateByToken, allocation, amountOf } from "./aggregate";
import type { Position, PositionGroup } from "@/hooks/usePortfolio";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
};

const row = (label: string, chainId: number, amount: string, valueUsd: number | null): Position => ({
  id: `wallet-${chainId}-${label}`,
  kind: "wallet",
  label,
  sublabel: "",
  amount,
  valueUsd,
  apy: null,
  state: { tone: "ok", text: "Idle" },
  chainId,
});

const agg = aggregateByToken([
  row("USDC", 8453, "1,240", 1240),
  row("WETH", 8453, "0.28", 900),
  row("USDC", 1, "820", 820),
  row("usdc", 4663, "300", 300),
  row("KLD", 5042, "50", null),
]);

check("folds USDC across three chains into one row", agg.filter((t) => t.key === "USDC").length === 1);
const usdc = agg.find((t) => t.key === "USDC")!;
check("USDC total value is summed", usdc.valueUsd === 2360);
check("USDC amount is summed", usdc.amount === 2360);
check("USDC keeps all three chains", usdc.chains.length === 3);
check("children sorted largest first", usdc.chains[0].chainId === 8453 && usdc.chains[2].chainId === 4663);
check("largest token first", agg[0].key === "USDC" && agg[1].key === "WETH");
check("unpriced token sorts last", agg[agg.length - 1].key === "KLD");
check("unpriced token value stays null, never zero", agg.find((t) => t.key === "KLD")!.valueUsd === null);

const mixed = aggregateByToken([row("EURC", 1, "10", 11), row("EURC", 5042, "5", null)]);
check("one unpriced child makes the total unknown", mixed[0].valueUsd === null);

check("amountOf parses commas", amountOf(row("X", 1, "1,234.5", 1)) === 1234.5);
check("amountOf tolerates a suffix", amountOf(row("X", 1, "1.2K", 1)) === 1.2);

const g = (id: string, subtotalUsd: number | null) =>
  ({ id, title: id, subtotalUsd, unpriced: [], rows: [], empty: "", href: "/" }) as unknown as PositionGroup;
const al = allocation([g("wallet", 300), g("lending", 100), g("borrowing", -50), g("stable", null), g("staking", 0)]);
check("allocation skips negative, null and zero groups", al.length === 2);
check("allocation shares sum to 1", Math.abs(al.reduce((s, a) => s + a.share, 0) - 1) < 1e-9);
check("allocation largest first", al[0].id === "wallet" && al[0].share === 0.75);
check("allocation empty when nothing priced", allocation([g("wallet", null)]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
