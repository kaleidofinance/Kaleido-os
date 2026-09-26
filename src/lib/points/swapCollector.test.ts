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
  userOpSenders,
  USER_OPERATION_EVENT_TOPIC,
  usdcLegValue,
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
  /* A bridge's integrator fee: it arrives from the bridge's own contract and the
     tx touches no swap venue. NOT a swap. */
  const bridge = parseSwapInput({
    tx: { to: OTHER, from: WALLET },
    transfers: [t(USDC, WALLET, OTHER, 50_000000n), t(USDC, OTHER, RECEIVER, 100_000n)],
    kyberRouter: ROUTER,
  });
  check("a bridge fee (no swap venue touched) is skipped as not-a-swap",
    "skip" in bridge && bridge.skip === "not-a-swap", j(bridge));
  /* A router call with no transfer FROM the user — nothing to size the swap on. */
  const noInput = parseSwapInput({ tx: { to: ROUTER, from: WALLET }, transfers, kyberRouter: ROUTER });
  check("a router tx with no user input leg is skipped",
    "skip" in noInput && noInput.skip === "no-input-leg", j(noInput));
}

console.log("\n— bundled trades (EIP-5792) credit the USER, not the relayer —");
{
  const RELAYER = "0x7777777777777777777777777777777777777777";
  const ENTRYPOINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const ACCOUNT = "0x5555555555555555555555555555555555555555";
  const kyber = (user: string) => [
    t(USDC, user, ROUTER, 100_000000n),
    t(EURC, ROUTER, RECEIVER, 174_000n),
    t(EURC, ROUTER, user, 86_962000n),
  ];
  /* EIP-7702, self-sent: the tx goes to the user's own (delegated) address. */
  const selfSent = parseSwapInput({ tx: { to: WALLET, from: WALLET }, transfers: kyber(WALLET), kyberRouter: ROUTER, feeReceiver: RECEIVER });
  check("7702 self-sent bundle → credits the user", "wallet" in selfSent && selfSent.wallet === WALLET.toLowerCase(), j(selfSent));
  /* EIP-7702 via a relayer: from = relayer (sends no tokens), to = the user. */
  const relayed = parseSwapInput({ tx: { to: WALLET, from: RELAYER }, transfers: kyber(WALLET), kyberRouter: ROUTER, feeReceiver: RECEIVER });
  check("7702 relayed bundle → credits the user, never the relayer",
    "wallet" in relayed && relayed.wallet === WALLET.toLowerCase(), j(relayed));
  /* ERC-4337: bundler → EntryPoint; the account is named by UserOperationEvent. */
  const senders = userOpSenders([
    { address: ENTRYPOINT, topics: [USER_OPERATION_EVENT_TOPIC, "0x" + "ab".repeat(32), pad(ACCOUNT), pad(RELAYER)], data: "0x" },
    transferLog(USDC, ACCOUNT, ROUTER, 1n),
  ]);
  check("userOpSenders reads the smart account from UserOperationEvent", senders.join() === ACCOUNT.toLowerCase(), senders.join());
  const aa = parseSwapInput({ tx: { to: ENTRYPOINT, from: RELAYER }, transfers: kyber(ACCOUNT), kyberRouter: ROUTER, accountSenders: senders, feeReceiver: RECEIVER });
  check("4337 bundle → credits the smart account", "wallet" in aa && aa.wallet === ACCOUNT.toLowerCase(), j(aa));
}

console.log("\n— Argus trades (Uniswap v4 via the PoolManager) are swaps too —");
{
  const PM = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
  const UR = "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1";
  const GLITCH = "0x08AdbF431569A1AaCAC2606d2aDCD18F4eBF2A71";
  /* BUY: Permit2 pulls the fee user → receiver and the settle user → PoolManager
     (tx.to is the UniversalRouter, which moves no tokens itself). */
  const buy = [
    t(USDC, WALLET, RECEIVER, 20_000n),
    t(USDC, WALLET, PM, 9_980_000n),
    t(GLITCH, PM, WALLET, 240_000n * 10n ** 18n),
  ];
  const b = parseSwapInput({ tx: { to: UR, from: WALLET }, transfers: buy, kyberRouter: ROUTER, venues: [PM], feeReceiver: RECEIVER });
  check("an Argus buy is a swap, credited to the trader", "wallet" in b && b.wallet === WALLET.toLowerCase(), j(b));
  const bv = usdcLegValue({ wallet: WALLET, transfers: buy, usdc: USDC, usdcDecimals: 6 });
  check("…sized at the whole USDC input (swap + fee = $10)", bv === 10, String(bv));
  /* SELL: token user → PoolManager; TAKE_PORTION pays the fee and the rest out of it. */
  const sell = [
    t(GLITCH, WALLET, PM, 240_000n * 10n ** 18n),
    t(USDC, PM, RECEIVER, 19_000n),
    t(USDC, PM, WALLET, 9_481_000n),
  ];
  const s = parseSwapInput({ tx: { to: UR, from: WALLET }, transfers: sell, kyberRouter: ROUTER, venues: [PM], feeReceiver: RECEIVER });
  check("an Argus sell is a swap, credited to the trader", "wallet" in s && s.wallet === WALLET.toLowerCase(), j(s));
  const sv = usdcLegValue({ wallet: WALLET, transfers: sell, usdc: USDC, usdcDecimals: 6 });
  check("…sized at the USDC received", sv === 9.481, String(sv));
  /* Without the PoolManager as a venue it would not count — the old behaviour. */
  const old = parseSwapInput({ tx: { to: UR, from: WALLET }, transfers: buy, kyberRouter: ROUTER });
  check("(control) without the Argus venue, the same tx is not-a-swap", "skip" in old && old.skip === "not-a-swap", j(old));
}

console.log("\n— direct native-pool trades (no fee) are swaps too —");
{
  /* A trade our own pool quoted better than KyberSwap runs direct through our v3
     router and pays NO 0.2% fee, so there is no transfer to the fee wallet. The
     pool address is the venue that proves the swap; the router (tx.to) is a venue
     too, so it is never credited. */
  const POOL = "0x542e6e2256270215d667ed43e65d4def8295164a"; // cirBTC/WUSDC
  const V3ROUTER = "0x98d4f47b000000000000000000000000000000ab";
  const CIRBTC = "0xc1a0000000000000000000000000000000000001";
  /* USDC in → cirBTC out, straight through the pool. No fee transfer at all. */
  const trade = [
    t(USDC, WALLET, POOL, 50_000000n), // input from the trader to the pool
    t(CIRBTC, POOL, WALLET, 900_000n), // output from the pool to the trader
  ];
  const r = parseSwapInput({
    tx: { to: V3ROUTER, from: WALLET },
    transfers: trade,
    kyberRouter: ROUTER,
    venues: [V3ROUTER, POOL],
    feeReceiver: RECEIVER,
  });
  check("a direct native-pool trade is a swap, credited to the trader", "wallet" in r && r.wallet === WALLET.toLowerCase(), j(r));
  check("…sized at the USDC input leg", usdcLegValue({ wallet: WALLET, transfers: trade, usdc: USDC, usdcDecimals: 6 }) === 50, j(r));
  /* Without our pool/router as venues, a fee-less pool trade is invisible — the
     exact gap that undercounted Total Volume. */
  const before = parseSwapInput({ tx: { to: V3ROUTER, from: WALLET }, transfers: trade, kyberRouter: ROUTER, feeReceiver: RECEIVER });
  check("(control) without our pool as a venue, the same trade is not-a-swap", "skip" in before && before.skip === "not-a-swap", j(before));

  /* Our pools are quoted in the wrapped-native (0x8c6c), an 18-dec 1:1 face of
     native USDC the aggregator can't price. The cron values such a leg 1:1 by
     calling usdcLegValue with 0x8c6c as the USD token — so a WUSDC→cirBTC pool
     trade is sized from the WUSDC leg, not skipped as unpriced. */
  const WUSDC = "0x8c6c000000000000000000000000000000000000";
  const wusdcTrade = [
    t(WUSDC, WALLET, POOL, 5n * 10n ** 18n), // 5 WUSDC in ($5)
    t(CIRBTC, POOL, WALLET, 90_000n),
  ];
  check(
    "a wrapped-native leg is valued 1:1 at 18 decimals",
    usdcLegValue({ wallet: WALLET, transfers: wusdcTrade, usdc: WUSDC, usdcDecimals: 18 }) === 5,
    j(wusdcTrade),
  );
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

console.log("\n— usdcLegValue: the trade's USDC notional, either side —");
{
  const cfg = { usdc: USDC, usdcDecimals: 6 };
  // USDC in → EURC out: value is the exact USDC the wallet sent.
  const usdcIn = [
    t(USDC, WALLET, ROUTER, 100_000000n), // input from wallet
    t(EURC, ROUTER, RECEIVER, 174_000n),  // fee to fee wallet
    t(EURC, ROUTER, WALLET, 86_962000n),  // output to wallet
  ];
  check("USDC input leg is the notional (exact, before fee)",
    usdcLegValue({ wallet: WALLET, transfers: usdcIn, ...cfg }) === 100, "");

  // EURC in → USDC out: no USDC from the wallet, so the USDC it RECEIVES counts,
  // and the USDC fee to the fee wallet must NOT be counted.
  const usdcOut = [
    t(EURC, WALLET, ROUTER, 90_000000n),   // input (non-USDC)
    t(USDC, ROUTER, RECEIVER, 200000n),    // fee to fee wallet — excluded
    t(USDC, ROUTER, WALLET, 99_800000n),   // output to wallet
  ];
  check("USDC output leg counts when there is no USDC input",
    usdcLegValue({ wallet: WALLET, transfers: usdcOut, ...cfg }) === 99.8, "");
  check("the USDC fee to the fee wallet is never counted",
    usdcLegValue({ wallet: WALLET, transfers: usdcOut, ...cfg }) !== 100, "");

  // token↔token: no USDC touches the wallet → null (caller must price it).
  const tokenToToken = [
    t(EURC, WALLET, ROUTER, 50_000000n),
    t(OTHER, ROUTER, WALLET, 49_000000n),
  ];
  check("a token↔token swap yields null (no USDC leg to value)",
    usdcLegValue({ wallet: WALLET, transfers: tokenToToken, ...cfg }) === null, "");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
