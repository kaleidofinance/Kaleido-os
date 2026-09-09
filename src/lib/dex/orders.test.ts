// Checks on the order arithmetic behind /trade/limit.
// Run with `npx tsx src/lib/dex/orders.test.ts`.
//
// Everything here fails silently in production, which is the reason the file
// exists. An order is a signature over a digest: get any field wrong and the
// wallet signs, the store accepts, the list renders it — and every fill reverts
// on the signature check with nothing to say why. There is no earlier failure to
// catch, because the digest IS what was signed.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. The EIP-712 type string. `ORDER_TYPES` must produce, character for
//      character, the string KaleidoOrders hashes into `ORDER_TYPEHASH`. A
//      renamed field or a `uint256 expiry` where the contract says `uint64` is a
//      different typehash and therefore a digest no wallet has ever signed.
//      Test 1, against the literal copied out of the .sol.
//   2. The decimal shift in `minOutFor`. KLD (18) → USDC (6) is off by 1e12 if
//      the re-basing is missing, and 1e12 is still a number: the order is either
//      unfillable forever or accepts a millionth of the intended output. Test 2.
//   3. The rounding direction. `minOut` is the maker's floor, so a truncated
//      floor hands the difference to the filler. Test 3 asserts it never lands
//      below the exact value.
//   4. Path packing. The contract checks `20 + 23·hops` and the two ends against
//      the signed pair, so a 2-byte fee or a reordered concat is a fill that
//      reverts on `KaleidoOrders_BadPath`. Test 4.
//   5. `buildOrder` refusing what `_shapeValid` refuses. Those orders sign
//      cleanly and can never fill; catching them before the wallet prompt is the
//      only place the user can still act. Test 5.
//   6. `recoverMaker` treating a contract wallet as unverifiable rather than
//      invalid. Getting that backwards rejects every smart-account maker at the
//      API door — and in-app email wallets are smart accounts. Test 7.
//   7. `nextFillAt` transcribing the contract's cadence. Off by an interval and
//      the agent tells the user an order can fill when the contract will refuse
//      it, and the keeper spends gas finding out. Test 9, against
//      KaleidoOrders.sol:239-241.

import { ethers } from "ethers";
import {
  ORDER_TYPES,
  buildOrder,
  describeInterval,
  describeOrder,
  encodePath,
  minOutFor,
  nextFillAt,
  orderHash,
  ordersDomain,
  pathFor,
  priceFromMinOut,
  randomSalt,
  recoverMaker,
  signOrder,
  swapInputFor,
  type Order,
  type StoredOrder,
} from "./orders";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const err = (r: unknown): string | null =>
  r && typeof r === "object" && "error" in r ? String((r as { error: string }).error) : null;

/* ------------------------------------------------------------------ 1 -- */
/* The type string, against the literal from KaleidoOrders.sol's
   ORDER_TYPEHASH. Copied by hand on purpose: importing it would mean deriving
   both sides from one source, which is exactly the check being avoided. */
const SOLIDITY_TYPE_STRING =
  "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn," +
  "uint256 minOut,uint64 startAt,uint64 expiry,uint32 interval," +
  "uint32 maxFills,uint64 epoch,uint256 salt)";

const encoder = ethers.TypedDataEncoder.from(
  ORDER_TYPES as unknown as Record<string, ethers.TypedDataField[]>,
);
check(
  "ORDER_TYPES encodes the contract's type string",
  encoder.encodeType("Order") === SOLIDITY_TYPE_STRING,
  `\n       got  ${encoder.encodeType("Order")}\n       want ${SOLIDITY_TYPE_STRING}`,
);
check(
  "and therefore the contract's typehash",
  ethers.keccak256(ethers.toUtf8Bytes(encoder.encodeType("Order"))) ===
    ethers.keccak256(ethers.toUtf8Bytes(SOLIDITY_TYPE_STRING)),
);

/* The domain, whose four values the contract fixes in its EIP712 constructor and
   its Ownable-independent chainId. A wrong name or version is a valid signature
   over a different domain — indistinguishable from a forgery at the contract. */
const ORDERS = "0x1111111111111111111111111111111111111111";
const domain = ordersDomain(11155111, ORDERS);
check("domain name is the contract's", domain.name === "Kaleido Orders");
check("domain version is the contract's", domain.version === "1");
check("domain carries the chain", domain.chainId === 11155111);
check("domain carries the verifying contract", domain.verifyingContract === ORDERS);

/* ------------------------------------------------------------------ 2 -- */
/* The decimal shift. KLD 18 decimals, USDC 6, at the price the seeded pool
   actually holds (~$0.032). */
const KLD = "0x2222222222222222222222222222222222222222";
const USDC = "0x3333333333333333333333333333333333333333";

const floor = (
  amountIn: bigint,
  price: string,
  basis: "outPerIn" | "inPerOut",
  dIn: number,
  dOut: number,
) => {
  const r = minOutFor({ amountIn, price, basis, decimalsIn: dIn, decimalsOut: dOut });
  if ("error" in r) throw new Error(r.error);
  return r.minOut;
};

check(
  "1000 KLD at 0.032 USDC each is 32 USDC",
  floor(ethers.parseUnits("1000", 18), "0.032", "outPerIn", 18, 6) === BigInt(32_000_000),
  floor(ethers.parseUnits("1000", 18), "0.032", "outPerIn", 18, 6).toString(),
);
check(
  "100 USDC at 31.25 KLD each is 3125 KLD",
  floor(ethers.parseUnits("100", 6), "31.25", "outPerIn", 6, 18) ===
    ethers.parseUnits("3125", 18),
);
check(
  "the same trade quoted the other way round agrees",
  floor(ethers.parseUnits("100", 6), "0.032", "inPerOut", 6, 18) ===
    ethers.parseUnits("3125", 18),
);
/* Equal decimals, so a missing shift would pass. Included because it is the case
   a hand-check is done on, and it must not be the only case. */
check(
  "18 to 18 at 2.0 doubles",
  floor(ethers.parseUnits("5", 18), "2", "outPerIn", 18, 18) ===
    ethers.parseUnits("10", 18),
);
check(
  "6 to 6 at 0.5 halves",
  floor(ethers.parseUnits("10", 6), "0.5", "outPerIn", 6, 6) === BigInt(5_000_000),
);

/* ------------------------------------------------------------------ 3 -- */
/* Rounding. The floor may sit above the exact value by at most one base unit,
   and never below it. */
const WAD = BigInt(10) ** BigInt(18);
for (const [amount, price, dIn, dOut] of [
  ["1234.567891234567891", "0.0321", 18, 6],
  ["7.7", "1450.339", 18, 6],
  ["0.000001", "31.25", 6, 18],
  ["999999", "0.000123", 6, 18],
] as const) {
  const amountIn = ethers.parseUnits(amount, dIn);
  const mine = floor(amountIn, price, "outPerIn", dIn, dOut);
  const exact =
    (amountIn * ethers.parseUnits(price, 18) * BigInt(10) ** BigInt(dOut)) /
    (WAD * BigInt(10) ** BigInt(dIn));
  check(
    `${amount} at ${price} rounds up, not down`,
    mine >= exact && mine - exact <= BigInt(1),
    `mine ${mine} exact ${exact}`,
  );
}
/* One wei at a price small enough to truncate to zero. Zero is the one value the
   contract refuses outright, so the ceiling is load-bearing rather than tidy. */
check(
  "a dust amount still floors at one unit",
  floor(BigInt(1), "0.0000000000000001", "outPerIn", 18, 6) === BigInt(1),
);
check(
  "a price of zero is refused, not accepted as no floor",
  err(minOutFor({ amountIn: BigInt(1000), price: "0", basis: "outPerIn", decimalsIn: 18, decimalsOut: 6 })) !== null,
);
check(
  "an unreadable price is refused",
  err(minOutFor({ amountIn: BigInt(1000), price: "abc", basis: "outPerIn", decimalsIn: 18, decimalsOut: 6 })) !== null,
);
check(
  "a zero amount is refused",
  err(minOutFor({ amountIn: BigInt(0), price: "1", basis: "outPerIn", decimalsIn: 18, decimalsOut: 6 })) !== null,
);

/* priceFromMinOut is display-only, so it is checked for agreeing with the price
   that produced the floor rather than for exactness. */
const disp = priceFromMinOut({
  amountIn: ethers.parseUnits("1000", 18),
  minOut: BigInt(32_000_000),
  basis: "outPerIn",
  decimalsIn: 18,
  decimalsOut: 6,
});
check("the displayed price round-trips", Math.abs(disp - 0.032) < 1e-9, String(disp));

/* ------------------------------------------------------------------ 4 -- */
/* Path packing, against the contract's `path.length < 43 || (length - 20) % 23`. */
const bytesOf = (hex: string) => (hex.length - 2) / 2;
const p1 = encodePath([KLD, USDC], [3000]);
check("a one-hop path is 43 bytes", bytesOf(p1) === 43, String(bytesOf(p1)));
check("and satisfies 20 + 23·hops", (bytesOf(p1) - 20) % 23 === 0);
check(
  "the fee is three big-endian bytes",
  p1.slice(2 + 40, 2 + 46).toLowerCase() === "000bb8",
  p1.slice(2 + 40, 2 + 46),
);
check(
  "tokenIn leads the path",
  ethers.getAddress("0x" + p1.slice(2, 42)) === ethers.getAddress(KLD),
);
check(
  "tokenOut ends it",
  ethers.getAddress("0x" + p1.slice(p1.length - 40)) === ethers.getAddress(USDC),
);
const WETH = "0x4444444444444444444444444444444444444444";
const p2 = encodePath([KLD, WETH, USDC], [3000, 500]);
check("a two-hop path is 66 bytes", bytesOf(p2) === 66, String(bytesOf(p2)));
check("and satisfies 20 + 23·hops", (bytesOf(p2) - 20) % 23 === 0);

let threw = false;
try {
  encodePath([KLD, USDC], [3000, 500]);
} catch {
  threw = true;
}
check("a fee count that doesn't match the hops throws", threw);

const sample: Order = {
  maker: "0x5555555555555555555555555555555555555555",
  tokenIn: KLD,
  tokenOut: USDC,
  amountIn: ethers.parseUnits("1000", 18).toString(),
  minOut: "32000000",
  startAt: 0,
  expiry: 1_800_000_000,
  interval: 0,
  maxFills: 1,
  epoch: 0,
  salt: "1",
};
check("pathFor gives the pair's own pool", pathFor(sample, 3000) === p1);
threw = false;
try {
  pathFor(sample, 100);
} catch {
  threw = true;
}
check("pathFor refuses a tier this DEX doesn't have", threw);

/* ------------------------------------------------------------------ 5 -- */
/* buildOrder against every line of the contract's `_shapeValid`, plus the two
   fields it derives rather than asks for. */
const NOW = 1_780_000_000;
const base = {
  maker: "0x5555555555555555555555555555555555555555",
  tokenIn: KLD,
  tokenOut: USDC,
  amountIn: ethers.parseUnits("1000", 18),
  minOut: BigInt(32_000_000),
  epoch: 0,
  expiresIn: 604_800,
  interval: null as number | null,
  now: NOW,
};

const built = buildOrder(base);
check("a well-formed draft builds", err(built) === null, err(built) ?? "");
if (!("error" in built)) {
  check("startAt is now-or-later, expressed as zero", built.startAt === 0);
  check("expiry is now plus the window", built.expiry === NOW + 604_800);
  check("a one-shot order fills once", built.maxFills === 1);
  check("a one-shot order has no interval", built.interval === 0);
  check("amountIn survives as a decimal string", built.amountIn === "1000000000000000000000");
  check("the salt is a decimal string", /^\d+$/.test(built.salt));
  check("the maker is checksummed", built.maker === ethers.getAddress(base.maker));
}

check(
  "the same token on both sides is refused",
  err(buildOrder({ ...base, tokenOut: KLD })) !== null,
);
check(
  "a lowercase duplicate is caught too",
  err(buildOrder({ ...base, tokenIn: KLD.toLowerCase(), tokenOut: KLD })) !== null,
);
check("a zero amount is refused", err(buildOrder({ ...base, amountIn: BigInt(0) })) !== null);
check("a zero floor is refused", err(buildOrder({ ...base, minOut: BigInt(0) })) !== null);
check(
  "a missing wallet is refused",
  err(buildOrder({ ...base, maker: "not an address" })) !== null,
);
check(
  "a negative epoch is refused",
  err(buildOrder({ ...base, epoch: -1 })) !== null,
);
check(
  "a zero window is refused",
  err(buildOrder({ ...base, expiresIn: 0 })) !== null,
);

/* The recurring shape. `interval = 0, maxFills > 1` is the exact combination
   `_shapeValid` rejects, and it is what a form produces when the recurrence
   control is reset without clearing the count — so maxFills is forced, not
   trusted. */
const forced = buildOrder({ ...base, interval: null, maxFills: 4 });
check(
  "a one-shot order ignores a stale fill count",
  !("error" in forced) && forced.maxFills === 1 && forced.interval === 0,
);
const weekly = buildOrder({
  ...base,
  interval: 604_800,
  maxFills: 4,
  expiresIn: 2_592_000,
});
check("a recurring order builds", err(weekly) === null, err(weekly) ?? "");
if (!("error" in weekly)) {
  check("it carries the interval", weekly.interval === 604_800);
  check("and the fill count", weekly.maxFills === 4);
}
check(
  "a recurring order of one fill is refused",
  err(buildOrder({ ...base, interval: 604_800, maxFills: 1 })) !== null,
);
/* Four weekly fills need 21 days of window; a 7-day order would silently do
   two. The contract has no view that reports this. */
check(
  "fills that outrun the expiry are refused",
  err(buildOrder({ ...base, interval: 604_800, maxFills: 4, expiresIn: 604_800 })) !== null,
);
check(
  "and the message says how long it would need",
  (err(buildOrder({ ...base, interval: 604_800, maxFills: 4, expiresIn: 604_800 })) ?? "").includes("21"),
);

/* Two identical drafts must be two orders, not one row sharing a fill count. */
const a1 = buildOrder(base);
const a2 = buildOrder(base);
check(
  "two identical drafts get different salts",
  !("error" in a1) && !("error" in a2) && a1.salt !== a2.salt,
);
check(
  "and therefore different digests",
  !("error" in a1) &&
    !("error" in a2) &&
    orderHash(a1, 11155111, ORDERS) !== orderHash(a2, 11155111, ORDERS),
);
check("a salt spans the full word", new Set(Array.from({ length: 8 }, randomSalt)).size === 8);

/* The digest binds to the chain and the contract, which is what stops an order
   signed on Sepolia from being replayed on Base Sepolia where the same token
   addresses may exist. */
if (!("error" in built)) {
  const onSepolia = orderHash(built, 11155111, ORDERS);
  check(
    "a different chain is a different digest",
    orderHash(built, 84532, ORDERS) !== onSepolia,
  );
  check(
    "a different orders contract is a different digest",
    orderHash(built, 11155111, "0x9999999999999999999999999999999999999999") !== onSepolia,
  );
}

/* ------------------------------------------------------------------ 6 -- */
/* swapInputFor, which must agree with the contract's own helper. The keeper
   quotes this rather than amountIn; quoting the full input overstates the output
   by the fee, and near the floor that is the difference between "fillable" and a
   reverted fill. */
const thousand = ethers.parseUnits("1000", 18);
check("a zero fee swaps the whole input", swapInputFor(thousand, 0) === thousand);
check(
  "100 bps takes one percent",
  swapInputFor(thousand, 100) === ethers.parseUnits("990", 18),
);
check("5 bps takes five hundredths", swapInputFor(thousand, 5) === ethers.parseUnits("999.5", 18));
check("the fee never rounds up against the maker", swapInputFor(BigInt(1), 100) === BigInt(1));

/* ------------------------------------------------------------------ 7 -- */
/* recoverMaker's three answers. The third — unverifiable — is the one that
   matters: an ERC-1271 signature is not recoverable ECDSA, and calling that
   "invalid" rejects every contract wallet, which is what the in-app email login
   issues. */
/* Wrapped rather than run at the top level because tsx transforms this file to
   CJS, where a top-level await is a transform error rather than a slow start. */
async function signatures() {
  const wallet = ethers.Wallet.createRandom();
  const real: Order = {
    ...sample,
    maker: wallet.address,
  };
  const sig = await signOrder(wallet, real, 11155111, ORDERS);
  check("a signed order carries its own digest", sig.hash === orderHash(real, 11155111, ORDERS));
  check("signOrder checksums the contract", sig.orders === ethers.getAddress(ORDERS));
  const verdict = recoverMaker(sig);
  check("a real EOA signature verifies", verdict.ok === true, JSON.stringify(verdict));

  const impostor = recoverMaker({
    ...sig,
    order: { ...real, maker: "0x6666666666666666666666666666666666666666" },
  });
  check(
    "an order in someone else's name is rejected",
    impostor.ok === false && "reason" in impostor,
    JSON.stringify(impostor),
  );
  const wrongChain = recoverMaker({ ...sig, chainId: 84532 });
  check(
    "a signature for another chain is rejected",
    wrongChain.ok === false && "reason" in wrongChain,
  );
  const short = recoverMaker({ ...sig, signature: "0x1234" });
  check(
    "a contract wallet's signature is unverifiable, not invalid",
    short.ok === false && "unverifiable" in short,
    JSON.stringify(short),
  );
  const notHex = recoverMaker({ ...sig, signature: "hello" });
  check("a non-hex signature is rejected outright", notHex.ok === false && "reason" in notHex);
  /* 65 bytes with a v the curve has no answer for. Length says EOA, so this is a
     bad signature rather than a contract wallet. */
  const badV = recoverMaker({ ...sig, signature: sig.signature.slice(0, -2) + "09" });
  check("65 bytes with a broken v is rejected", badV.ok === false && "reason" in badV);
}

/* ------------------------------------------------------------------ 8 -- */
/* The prose. Both strings go in front of the user with no further formatting. */
function rest() {
if (!("error" in built)) {
  const line = describeOrder({
    order: built,
    symbolIn: "KLD",
    symbolOut: "USDC",
    decimalsIn: 18,
    decimalsOut: 6,
  });
  check("the summary names the floor", line.includes("at least 32 USDC"), line);
  check("a one-shot summary says nothing about a schedule", !line.includes("every"), line);
}
if (!("error" in weekly)) {
  const line = describeOrder({
    order: weekly,
    symbolIn: "KLD",
    symbolOut: "USDC",
    decimalsIn: 18,
    decimalsOut: 6,
  });
  check("a recurring summary names the schedule", line.includes("4× every week"), line);
}
check("a named interval reads as a noun", describeInterval(604_800) === "week");
check("a fortnight is not 'every 2 weeks weeks'", describeInterval(1_209_600) === "2 weeks");
check("an unnamed interval falls back to days", describeInterval(172_800) === "2 days");
check("a single day is singular", describeInterval(86_400) === "day");
check("sub-day intervals read in hours", describeInterval(3_600) === "hour");

/* ------------------------------------------------------------------ 9 -- */
/*
 * Cadence, against the contract's own `nextFillAt` rather than against intuition.
 *
 * The three lines being checked are KaleidoOrders.sol:239-241, and the reason they
 * are worth a test off-chain is that the answer becomes a sentence: the agent tells
 * the user whether an order can fill now, and the keeper decides whether to spend
 * gas trying. A cadence measured from `startAt` instead of from the last fill reads
 * as plausible and drifts a full interval every late fill.
 */
if (!("error" in weekly)) {
  const row = (over: Partial<StoredOrder> = {}): StoredOrder => ({
    order: weekly as Order,
    signature: "0x",
    hash: `0x${"c".repeat(64)}`,
    chainId: 11155111,
    orders: ORDERS,
    fills: 0,
    lastFillAt: null,
    status: "open",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  /* A future `startAt` rather than the built order's own 0, because 0 is also the
     "no next fill" sentinel and an assertion that passes on both is an assertion
     about neither. Nothing in `buildOrder` can produce a future start today — it
     hardcodes 0 — so this is the struct's field being exercised ahead of the UI
     that will set it. */
  const SCHEDULED = 1_900_000_000;
  check(
    "an unfilled order waits for startAt, not for an interval",
    nextFillAt(row({ order: { ...(weekly as Order), startAt: SCHEDULED } })) === SCHEDULED,
    `${nextFillAt(row({ order: { ...(weekly as Order), startAt: SCHEDULED } }))}`,
  );
  /* The measurement that matters: from the last fill, so a fill that landed three
     days late pushes the next one three days out rather than catching up. */
  check(
    "after a fill the clock runs from that fill",
    nextFillAt(row({ fills: 1, lastFillAt: 1_800_000_000 })) === 1_800_000_000 + 604_800,
  );
  check(
    "a spent order has no next fill",
    nextFillAt(row({ fills: 4, lastFillAt: 1_800_000_000 })) === 0,
  );
  /* Ahead of the spent check on purpose in the contract, and here too: a maker who
     cancelled a half-filled order is owed "no" and not a date. */
  check(
    "a cancelled order has no next fill either",
    nextFillAt(row({ fills: 1, lastFillAt: 1_800_000_000, status: "cancelled" })) === 0,
  );
  /* The one answer the contract has no need for. Two columns can disagree where one
     struct cannot, and `startAt + interval` — the tempting fallback — is a
     timestamp in the past, i.e. "fill it now" about an order the contract will
     refuse. Null is the only honest answer and the caller phrases it. */
  check(
    "fills recorded with no time is unknown, not ready",
    nextFillAt(row({ fills: 1, lastFillAt: null })) === null,
    `${nextFillAt(row({ fills: 1, lastFillAt: null }))}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
}

signatures().then(rest);
