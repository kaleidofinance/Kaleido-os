/**
 * The swap-fee collector: decoding transfers, and the two holes — a bridge fee to
 * the shared wallet must NOT be credited as a swap, and the size/recipient must be
 * the user's input leg, not the router's fee.
 *
 * Run with `npx tsx src/lib/points/swapCollector.test.ts`.
 */
import {
  TRANSFER_TOPIC,
  decodeTransferLog,
  parseSwapInput,
  valueInput,
  type TransferLog,
} from "./swapCollector.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const WALLET = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const OTHER = "0xA407AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // e.g. a bridge executor
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const RECEIVER = "0x8f10b468b06c6fd214b65f87778827f7d113f996";

const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
const pad = (a: string) => `0x000000000000000000000000${a.slice(2)}`.toLowerCase();
const transferLog = (token: string, from: string, to: string, value: bigint) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)],
  data: "0x" + value.toString(16),
});
const t = (token: string, from: string, to: string, value: bigint): TransferLog => ({
  token: token.toLowerCase(), from: from.toLowerCase(), to: to.toLowerCase(), value,
});

console.log("\n— decodeTransferLog —");
{
  const d = decodeTransferLog(transferLog(USDC, WALLET, ROUTER, 100_000000n));
  check("a Transfer decodes to token/from/to/value",
    !!d && d.token === USDC.toLowerCase() && d.from === WALLET.toLowerCase() && d.value === 100_000000n,
    j(d));
  check("a non-Transfer topic is dropped",
    decodeTransferLog({ address: USDC, topics: ["0xdead"], data: "0x1" }) === null);
  check("malformed data is dropped",
    decodeTransferLog({ address: USDC, topics: [TRANSFER_TOPIC, pad(WALLET), pad(ROUTER)], data: "nothex" }) === null);
}

console.log("\n— parseSwapInput: a real swap —");
{
  /* USDC in, EURC out; the swapper sends USDC to the router, the router sends the
     EURC output and the fee. Only the first is the user's input leg. */
  const transfers = [
    t(USDC, WALLET, ROUTER, 100_000000n),   // input (from user)
    t(EURC, ROUTER, RECEIVER, 174_000n),    // fee (from router)
    t(EURC, ROUTER, WALLET, 86_962000n),    // output (from router)
  ];
  const r = parseSwapInput({ tx: { to: ROUTER, from: WALLET }, transfers, kyberRouter: ROUTER });
  check("credits the tx sender, not the router",
    "wallet" in r && r.wallet === WALLET.toLowerCase(), j(r));
  check("uses the input leg (USDC 100), not the fee or output",
    "inputToken" in r && r.inputToken === USDC.toLowerCase() && r.inputAmount === 100_000000n, j(r));
}

console.log("\n— parseSwapInput: the holes —");
{
  const transfers = [t(EURC, ROUTER, RECEIVER, 174_000n)]; // a fee to the shared wallet
  /* Same wallet, but the tx called something else — a bridge, say. NOT a swap. */
  const bridge = parseSwapInput({ tx: { to: OTHER, from: WALLET }, transfers, kyberRouter: ROUTER });
  check("a fee from a non-router tx is skipped as not-a-swap",
    "skip" in bridge && bridge.skip === "not-a-swap", j(bridge));
  /* A router call with no transfer FROM the user — nothing to size the swap on. */
  const noInput = parseSwapInput({ tx: { to: ROUTER, from: WALLET }, transfers, kyberRouter: ROUTER });
  check("a router tx with no user input leg is skipped",
    "skip" in noInput && noInput.skip === "no-input-leg", j(noInput));
}

console.log("\n— valueInput —");
{
  const cfg = { usdc: USDC, usdcDecimals: 6 };
  const never = () => { throw new Error("priceUsd must not be called for USDC"); };
  check("USDC input is valued 1:1 with no pricing call",
    valueInput(USDC, 100_000000n, cfg, never) === 100, "");
  check("a non-USDC input is priced via the injected pricer",
    valueInput(EURC, 87_000000n, cfg, () => 100) === 100, "");
  check("an unpriceable input yields null (skip, never a guess)",
    valueInput(EURC, 87_000000n, cfg, () => null) === null, "");
  check("a zero/negative price yields null",
    valueInput(EURC, 87_000000n, cfg, () => 0) === null, "");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
