import { ethers } from "ethers";
import { FEE_TIERS, isTradedTier } from "@/lib/dex/liquidity";

/**
 * Everything a KaleidoOrders order needs that isn't a chain read.
 *
 * Pure, and shared by /trade/limit, the agent's order-placing plan, the /api/orders
 * route that stores signed orders and the keeper that fills them. Same reason
 * `liquidity.ts` exists: four callers that must agree byte for byte, where
 * disagreeing is silent.
 *
 * "Silent" is stronger here than anywhere else in the app. An order is a
 * signature over a digest, so any field this file computes differently from the
 * contract produces a signature that is valid nowhere — it stores fine, lists
 * fine, and every fill reverts on the signature check with nothing in the UI to
 * say why. There is no chain call that can catch it earlier, because the digest
 * IS what the wallet signs.
 *
 * Three things follow from that and they shape the whole file:
 *
 *  1. {ORDER_TYPES} mirrors the Solidity struct field for field, in order. So
 *     does the field order in {buildOrder}. The typehash is derived from those
 *     names and types by ethers, exactly as the contract derives
 *     `ORDER_TYPEHASH` from its own string.
 *
 *  2. Every uint256 crosses process boundaries as a decimal STRING, never a
 *     number and never a bigint. `JSON.stringify(1n)` throws; a `number` silently
 *     rounds above 2^53, and a rounded `minOut` or `salt` re-hashes to a
 *     different digest. Postgres has the same trap in the other direction, which
 *     is why the store's columns are `text` — PostgREST serialises `numeric` as
 *     an unquoted JSON number.
 *
 *  3. `minOut` is rounded UP, always. It is the maker's floor, so rounding it
 *     down hands the difference to the filler; the arithmetic is in bigint from
 *     end to end because the whole point of the value is its last digit.
 */

/* -------------------------------------------------------------------------- */
/*  The signed object                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One conditional order, in the shape the wallet signs and the store holds.
 *
 * The uint256 fields are decimal strings and the small ones are numbers, which
 * is the split ethers' typed-data encoder accepts and JSON survives: `uint64`
 * and `uint32` all fit in a double with room to spare (a `uint64` timestamp is
 * ~1.8e9, a `uint32` interval at most ~4.3e9), while `amountIn`, `minOut` and
 * `salt` do not.
 *
 * Field order matters. It is the struct's order, and `TypedDataEncoder` hashes
 * by the type definition rather than by object key order — but {ORDER_TYPES}
 * below is what carries that, and keeping the two in the same order is how a
 * future edit to one gets noticed in review of the other.
 */
export interface Order {
  /** Whose funds move, whose signature authorises it, and who receives the output. */
  maker: string;
  /** Sold, per fill. */
  tokenIn: string;
  /** Bought, per fill. */
  tokenOut: string;
  /** Base units sold per fill — not in total. A recurring order spends this on each fill. */
  amountIn: string;
  /** Base units of `tokenOut` the maker will accept per fill. The price bound and the trigger. */
  minOut: string;
  /** Earliest fill, unix seconds. 0 means immediately. */
  startAt: number;
  /** Last fill, unix seconds. Must be after `startAt`. */
  expiry: number;
  /** Seconds between fills. 0 for a one-shot order. */
  interval: number;
  /** How many times this order may fill. 1 for a limit order. */
  maxFills: number;
  /** The maker's epoch at signing time. `cancelAll()` bumps it and kills every signature at once. */
  epoch: number;
  /** Random, so two identical orders are two orders rather than one. */
  salt: string;
}

/**
 * An order together with the signature over it, which is the only form either
 * side of the wire cares about — an order without its signature is not an order,
 * it is a draft.
 */
export interface SignedOrder {
  order: Order;
  /** 65-byte EOA signature, or whatever bytes the maker's contract wallet validates via ERC-1271. */
  signature: string;
  /** `hashOrder(order)` — the store's primary key and the contract's state key. */
  hash: string;
  /** Which chain's KaleidoOrders this was signed against. Part of the digest. */
  chainId: number;
  /** The `verifyingContract`. Part of the digest, so an order outlives no redeploy. */
  orders: string;
}

/**
 * @dev Must mirror the Solidity `Order` struct field for field, in order.
 *
 * ethers builds the typehash from this, so the string it produces has to be
 * character-identical to the contract's `ORDER_TYPEHASH` argument:
 *
 *   Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,
 *   uint256 minOut,uint64 startAt,uint64 expiry,uint32 interval,
 *   uint32 maxFills,uint64 epoch,uint256 salt)
 *
 * A renamed field, a reordered pair, or `uint256 expiry` where the contract says
 * `uint64` each produce a different typehash and therefore a different digest.
 * None of them fail any test that does not check a real signature against the
 * real contract, which is why {smart-contract/test/KaleidoOrders.test.js} signs
 * with these exact types.
 */
export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minOut", type: "uint256" },
    { name: "startAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "interval", type: "uint32" },
    { name: "maxFills", type: "uint32" },
    { name: "epoch", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

/** The domain name and version the contract passes to `EIP712(...)`. Not configurable. */
export const ORDERS_DOMAIN_NAME = "Kaleido Orders";
export const ORDERS_DOMAIN_VERSION = "1";

/**
 * The EIP-712 domain for a chain's KaleidoOrders.
 *
 * All four values are part of the digest. `chainId` is why an order signed on
 * Sepolia cannot be replayed on Base Sepolia even though the contract addresses
 * and the token addresses may be identical; `verifyingContract` is why a
 * redeploy orphans the order book rather than migrating it. Which in turn is why
 * the address comes from the generated registry and is passed in — never
 * hardcoded, and never defaulted.
 */
export function ordersDomain(chainId: number, ordersAddress: string) {
  return {
    name: ORDERS_DOMAIN_NAME,
    version: ORDERS_DOMAIN_VERSION,
    chainId,
    verifyingContract: ordersAddress,
  };
}

/**
 * `hashOrder(order)` — the digest the maker signs and the contract keys state by.
 *
 * Computed locally rather than read from the contract, deliberately: the UI needs
 * it before the order exists anywhere, and the /api/orders route needs to
 * recompute it from the fields it was handed rather than trust a hash the client
 * sent. A client-supplied hash is a client-supplied primary key.
 */
export function orderHash(
  order: Order,
  chainId: number,
  ordersAddress: string,
): string {
  return ethers.TypedDataEncoder.hash(
    ordersDomain(chainId, ordersAddress),
    ORDER_TYPES as unknown as Record<string, ethers.TypedDataField[]>,
    order,
  );
}

/* -------------------------------------------------------------------------- */
/*  Price ↔ minOut                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which way round a limit price was quoted.
 *
 * Both directions read naturally to a user and they are reciprocals, so a form
 * that supports both has to say which one it is holding. "outPerIn" is the swap
 * page's convention — `1 KLD = 0.032 USDC` — and "inPerOut" is the one a buyer
 * reaches for: `1 USDC = 31.25 KLD` when buying KLD with USDC.
 */
export type PriceBasis = "outPerIn" | "inPerOut";

/**
 * The floor in base units for `amountIn` at `price`.
 *
 * Rounded UP, and that is the only defensible direction: `minOut` is the worst
 * output the maker accepts, so a floor rounded down is a floor slightly below
 * the price they typed, and the difference is surplus a filler keeps. One wei of
 * a 6-decimal token is nothing; the habit of rounding a user's bound in the
 * counterparty's favour is not.
 *
 * `price` is a decimal string rather than a number so the caller's own input
 * survives — `parseUnits` on the string the user typed is exact, where
 * `Number("0.0000001")` already isn't the thing they wrote. It is scaled by
 * 1e18 internally regardless of either token's decimals, because a price is a
 * ratio and has no decimals of its own.
 *
 * Returns a sentence on failure, in the second person, because every caller
 * shows it to the user unchanged.
 */
export function minOutFor(args: {
  /** Base units sold per fill. */
  amountIn: bigint;
  /** The limit price, as typed. */
  price: string;
  basis: PriceBasis;
  decimalsIn: number;
  decimalsOut: number;
}): { minOut: bigint } | { error: string } {
  const { amountIn, price, basis, decimalsIn, decimalsOut } = args;

  if (amountIn <= BigInt(0)) {
    return { error: "The amount to sell has to be above zero." };
  }

  const WAD = BigInt(10) ** BigInt(18);
  let scaled: bigint;
  try {
    scaled = ethers.parseUnits(price.trim(), 18);
  } catch {
    return { error: `"${price}" isn't a price I can read.` };
  }
  if (scaled <= BigInt(0)) {
    return {
      error:
        "A limit order needs a price above zero. Without one, whoever fills it chooses the price.",
    };
  }

  /*
   * Ceiling division in both branches, `(a + b - 1) / b`, because Solidity-style
   * integer division truncates and truncation here moves the maker's floor down.
   *
   * The decimal shift is the part worth reading twice. `amountIn` is in tokenIn's
   * units and the answer is wanted in tokenOut's, so the ratio has to be
   * re-based between them:
   *
   *   outPerIn: out = in · price · 10^dOut / 10^dIn
   *   inPerOut: out = in · 10^dOut / (price · 10^dIn)
   *
   * KLD (18) → USDC (6) at 0.032 is the case that catches a missing shift: get it
   * wrong and the floor is off by 1e12, which either makes the order unfillable
   * forever or accepts a millionth of the intended output.
   */
  const shiftOut = BigInt(10) ** BigInt(decimalsOut);
  const shiftIn = BigInt(10) ** BigInt(decimalsIn);

  let minOut: bigint;
  if (basis === "outPerIn") {
    const num = amountIn * scaled * shiftOut;
    const den = WAD * shiftIn;
    minOut = (num + den - BigInt(1)) / den;
  } else {
    const num = amountIn * WAD * shiftOut;
    const den = scaled * shiftIn;
    minOut = (num + den - BigInt(1)) / den;
  }

  if (minOut <= BigInt(0)) {
    return {
      error:
        "At that price the order's floor rounds to zero, which the contract refuses — a zero floor lets whoever fills it move the price first. Sell a larger amount, or name a price closer to the market.",
    };
  }
  return { minOut };
}

/**
 * The price a floor implies, as a float, for display only.
 *
 * The inverse of {minOutFor} and deliberately lossy: this renders "≈ 0.0315
 * USDC" in a review row and an open-orders list. Nothing signs or compares
 * against it. The exact value is `minOut` itself, and every check — the
 * contract's, the keeper's — is made on that.
 */
export function priceFromMinOut(args: {
  amountIn: bigint;
  minOut: bigint;
  basis: PriceBasis;
  decimalsIn: number;
  decimalsOut: number;
}): number {
  const { amountIn, minOut, basis, decimalsIn, decimalsOut } = args;
  if (amountIn <= BigInt(0) || minOut <= BigInt(0)) return 0;
  const inHuman = Number(ethers.formatUnits(amountIn, decimalsIn));
  const outHuman = Number(ethers.formatUnits(minOut, decimalsOut));
  if (!inHuman || !outHuman) return 0;
  return basis === "outPerIn" ? outHuman / inHuman : inHuman / outHuman;
}

/* -------------------------------------------------------------------------- */
/*  V3 paths                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A V3 path, packed the way `SwapRouter.exactInput` reads it:
 * `token (20) || fee (3) || token (20) || ...`
 *
 * Must agree byte for byte with the contract's `_pathValid` and with the test
 * suite's own `encodePath`, since the contract checks the ends against the
 * signed pair and rejects any length that isn't `20 + 23·hops`. Three bytes for
 * the fee, big-endian — `ethers.toBeHex(fee, 3)` — which is how the router's
 * `Path` library slices it.
 *
 * Throws rather than returning an error string: a caller that reaches here with
 * a mismatched tokens/fees pair has a bug, not bad user input.
 */
export function encodePath(tokens: string[], fees: number[]): string {
  if (tokens.length < 2) {
    throw new Error("A path needs at least two tokens.");
  }
  if (fees.length !== tokens.length - 1) {
    throw new Error(
      `A path over ${tokens.length} tokens needs ${tokens.length - 1} fees, got ${fees.length}.`,
    );
  }
  const parts: string[] = [];
  tokens.forEach((token, i) => {
    parts.push(ethers.getAddress(token));
    if (i < fees.length) parts.push(ethers.toBeHex(fees[i], 3));
  });
  return ethers.concat(parts);
}

/**
 * The single-hop path for an order at one fee tier.
 *
 * The path is NOT part of the signed order, by design: a filler supplies it per
 * fill, which is what lets a better route be found later without the maker
 * re-signing. This is the default one — the pair's own pool — and it is what the
 * UI quotes against so the price shown is the price the first filler will see.
 *
 * The tier is checked against {FEE_TIERS} rather than passed through, for the
 * reason spelled out there: an unlisted tier looks like a pool that merely has
 * not been created yet, and the failure surfaces as a fill that reverts.
 */
export function pathFor(order: Order, fee: number): string {
  if (!isTradedTier(fee)) {
    throw new Error(
      `${fee / 10_000}% isn't a fee tier we trade. The tiers are ${FEE_TIERS.map(
        (f) => `${f / 10_000}%`,
      ).join(", ")}.`,
    );
  }
  return encodePath([order.tokenIn, order.tokenOut], [fee]);
}

/* -------------------------------------------------------------------------- */
/*  Building and signing                                                       */
/* -------------------------------------------------------------------------- */

/** How long an order stays live. The values /trade/limit offers. */
export const EXPIRY_CHOICES = [
  { label: "1 day", seconds: 86_400 },
  { label: "1 week", seconds: 604_800 },
  { label: "1 month", seconds: 2_592_000 },
  { label: "3 months", seconds: 7_776_000 },
] as const;

/**
 * How often a recurring order fills. `null` is a one-shot limit order.
 *
 * Weekly and up, with no daily or hourly option, and that is a liquidity
 * decision rather than a UI one: each fill is a real swap against a testnet pool
 * holding a few thousand dollars, so an hourly recurring order is a slow
 * self-sandwich. It is also the shape a DCA order actually has.
 */
export const INTERVAL_CHOICES = [
  { label: "One time", seconds: null },
  { label: "Weekly", seconds: 604_800 },
  { label: "Every 2 weeks", seconds: 1_209_600 },
  { label: "Monthly", seconds: 2_592_000 },
] as const;

/**
 * A 256-bit random salt, as a decimal string.
 *
 * Two otherwise identical orders — same maker, pair, amount, floor and window —
 * hash to the same digest and are therefore ONE order in the contract's state
 * map, sharing a fill count. Someone placing the same buy twice on purpose is
 * the normal case, not an edge case, so the salt is not optional.
 *
 * `randomBytes` because the value has to be unpredictable, not merely unique:
 * a counter or a timestamp lets an observer of the store compute a maker's next
 * digest before they sign it.
 */
export function randomSalt(): string {
  return BigInt(ethers.hexlify(ethers.randomBytes(32))).toString();
}

export interface OrderDraft {
  maker: string;
  tokenIn: string;
  tokenOut: string;
  /** Base units sold per fill. */
  amountIn: bigint;
  /** Base units of `tokenOut` accepted per fill. From {minOutFor}. */
  minOut: bigint;
  /** The maker's current on-chain epoch, read from `epochOf(maker)`. */
  epoch: number;
  /** Seconds from now until the order expires. From {EXPIRY_CHOICES}. */
  expiresIn: number;
  /** Seconds between fills, or null for one-shot. From {INTERVAL_CHOICES}. */
  interval: number | null;
  /** Total fills. Ignored (forced to 1) when `interval` is null. */
  maxFills?: number;
  /** Unix seconds. The caller passes its own clock so the value is testable. */
  now: number;
}

/**
 * An {Order} from what a form or a tool call actually has.
 *
 * Enforces the contract's `_shapeValid` here rather than letting the chain
 * refuse it, because the chain refuses it AFTER the wallet prompt: a malformed
 * order signs cleanly, stores cleanly, and sits in the list as an order that can
 * never fill. Every rule below is one of that function's lines.
 *
 * The two derived-not-asked fields are `startAt` and `maxFills`. `startAt` is 0
 * — "fill as soon as the price is there" — because a start time is a fifth thing
 * to explain for a case the UI has no control for; the field exists in the struct
 * so a scheduled first buy needs no new signature format. `maxFills` is forced
 * to 1 for a one-shot order because `interval = 0, maxFills > 1` is exactly the
 * shape `_shapeValid` rejects, and it is the shape a form produces when the
 * recurrence control is reset without clearing the count.
 *
 * Returns a sentence on failure, in the second person.
 */
export function buildOrder(draft: OrderDraft): Order | { error: string } {
  const {
    maker,
    tokenIn,
    tokenOut,
    amountIn,
    minOut,
    epoch,
    expiresIn,
    interval,
    now,
  } = draft;

  if (!ethers.isAddress(maker)) {
    return { error: "Connect a wallet to place an order." };
  }
  if (!ethers.isAddress(tokenIn) || !ethers.isAddress(tokenOut)) {
    return { error: "Pick both sides of the pair." };
  }
  if (ethers.getAddress(tokenIn) === ethers.getAddress(tokenOut)) {
    return { error: "An order has to be between two different tokens." };
  }
  if (amountIn <= BigInt(0)) {
    return { error: "Enter an amount to sell." };
  }
  if (minOut <= BigInt(0)) {
    return {
      error:
        "An order needs a price. The floor is what stops whoever fills it from choosing the price for you.",
    };
  }
  if (!Number.isInteger(epoch) || epoch < 0) {
    return {
      error:
        "I couldn't read your cancellation epoch from the contract, and signing without it would produce an order that can't be filled.",
    };
  }
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
    return { error: "Pick when the order should expire." };
  }

  const maxFills = interval === null ? 1 : Math.trunc(draft.maxFills ?? 1);
  if (interval !== null) {
    if (!Number.isInteger(interval) || interval <= 0) {
      return { error: "A recurring order needs a gap between fills." };
    }
    if (maxFills < 2) {
      return {
        error:
          "A recurring order needs at least two fills. One fill is a limit order.",
      };
    }
    /*
     * The window has to hold the fills the maker asked for, or the order quietly
     * does fewer than it says: fill N needs `lastFillAt + interval` to still be
     * inside `expiry`, and the contract has no view that reports "this will run
     * out of time". Checked with (maxFills - 1) gaps because the first fill
     * happens immediately.
     */
    const needed = interval * (maxFills - 1);
    if (needed > expiresIn) {
      return {
        error: `${maxFills} fills that far apart need longer than this order runs — ${Math.ceil(
          needed / 86_400,
        )} days against ${Math.floor(expiresIn / 86_400)}. Fewer fills, a shorter gap, or a later expiry.`,
      };
    }
  }

  const startAt = 0;
  const expiry = Math.floor(now) + expiresIn;
  if (expiry <= startAt) {
    return { error: "That expiry is already in the past." };
  }

  return {
    maker: ethers.getAddress(maker),
    tokenIn: ethers.getAddress(tokenIn),
    tokenOut: ethers.getAddress(tokenOut),
    amountIn: amountIn.toString(),
    minOut: minOut.toString(),
    startAt,
    expiry,
    interval: interval ?? 0,
    maxFills,
    epoch,
    salt: randomSalt(),
  };
}

/**
 * How much of `amountIn` a fill actually swaps, after the filler's cut.
 *
 * Mirrors the contract's `swapInputFor`. The keeper and the UI must quote THIS
 * number rather than `amountIn`: quoting the full input overstates the output by
 * the fee, and near the floor that is the difference between an order that looks
 * fillable and a fill that reverts.
 *
 * `fillerFeeBps` is read from the contract, not assumed, because it is storage
 * and can be raised to `MAX_FILLER_FEE_BPS` without a redeploy — which is the
 * whole reason third-party filling can be turned on later without invalidating
 * anything already signed.
 */
export function swapInputFor(amountIn: bigint, fillerFeeBps: number): bigint {
  const bps = BigInt(Math.trunc(fillerFeeBps));
  if (bps <= BigInt(0)) return amountIn;
  return amountIn - (amountIn * bps) / BigInt(10_000);
}

/**
 * Signs an order with the connected wallet.
 *
 * `signTypedData` and not `signMessage`: the wallet renders the fields, so a
 * maker sees the pair, the amount and the floor rather than a hex blob. It is
 * also what the contract verifies — `_validSignature` recovers over the EIP-712
 * digest and falls back to ERC-1271, so an in-app email wallet or a smart
 * account signs the same object through the same call.
 *
 * The returned {SignedOrder} carries the chain and the contract alongside the
 * signature. Not redundant: the signature means nothing without them, and the
 * store's rows outlive the session that made them.
 */
export async function signOrder(
  signer: ethers.Signer,
  order: Order,
  chainId: number,
  ordersAddress: string,
): Promise<SignedOrder> {
  const signature = await signer.signTypedData(
    ordersDomain(chainId, ordersAddress),
    ORDER_TYPES as unknown as Record<string, ethers.TypedDataField[]>,
    order,
  );
  return {
    order,
    signature,
    hash: orderHash(order, chainId, ordersAddress),
    chainId,
    orders: ethers.getAddress(ordersAddress),
  };
}

/**
 * Whether a signature recovers to the maker.
 *
 * Answers three states rather than two, and the third is the point. A contract
 * wallet's ERC-1271 signature is not a recoverable ECDSA signature at all, so
 * `recoverAddress` on one throws or returns a stranger — treating that as
 * "invalid" would reject every smart-account maker. Only the chain can settle it,
 * via `isValidSignature`, so this reports "unverifiable" and leaves the decision
 * to a caller that has an RPC (the keeper's `checkFill`, or the contract itself
 * at fill time).
 *
 * Used by /api/orders to reject the cheap forgery — an order posted in someone
 * else's name with a signature that simply isn't theirs — without an RPC call in
 * the request path.
 */
export function recoverMaker(
  signed: SignedOrder,
): { ok: true } | { ok: false; unverifiable: true } | { ok: false; reason: string } {
  const raw = signed.signature;
  if (!/^0x[0-9a-fA-F]*$/.test(raw)) {
    return { ok: false, reason: "The signature isn't hex." };
  }
  /* 65 bytes is the only length `recoverAddress` can work with. Anything else is
     a contract wallet's own encoding, which only that contract can check. */
  if ((raw.length - 2) / 2 !== 65) return { ok: false, unverifiable: true };
  try {
    const digest = orderHash(signed.order, signed.chainId, signed.orders);
    const recovered = ethers.recoverAddress(digest, raw);
    if (recovered.toLowerCase() !== signed.order.maker.toLowerCase()) {
      return {
        ok: false,
        reason: "That signature doesn't come from the maker named in the order.",
      };
    }
    return { ok: true };
  } catch {
    /* A malformed `v`, or an `s` above the curve's half-order. Not a contract
       wallet — those fail the length check above — so this is a bad signature. */
    return { ok: false, reason: "That signature isn't valid." };
  }
}

/* -------------------------------------------------------------------------- */
/*  The off-chain store                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the keeper has recorded about an order, alongside the signed fields.
 *
 * The chain is the source of truth for all of it — `stateOf(hash)` and
 * `epochOf(maker)` are the real answers — and these columns are a cache the
 * keeper reconciles. Which is why the list UI reads status live via `checkFill`
 * rather than rendering `status` straight out of the row: a row can be up to one
 * keeper cycle stale, and "cancelled" in particular can be true on chain and
 * absent here.
 */
/**
 * What the store's `status` column can say.
 *
 * Four words and no fifth, because the column's check constraint names exactly
 * these — see 20260901000000_limit_orders.sql. Named here rather than written
 * inline so the keeper's reconciliation and the row it writes cannot drift apart
 * by a typo that only shows up as a rejected UPDATE at 3am.
 */
export type OrderStatus = "open" | "filled" | "cancelled" | "expired";

export interface StoredOrder extends SignedOrder {
  /** Fills the keeper has observed. Compare against `order.maxFills`. */
  fills: number;
  /** Unix seconds of the last observed fill, or null. */
  lastFillAt: number | null;
  /** The keeper's last reconciliation. `open` until the chain says otherwise. */
  status: OrderStatus;
  /** When the row was stored, ISO. Display only; the signed `expiry` is authoritative. */
  createdAt: string;
}

/** Where /trade/limit and the agent post a freshly signed order. */
export const ORDERS_ENDPOINT = "/api/orders";

/**
 * Stores a signed order so the keeper can find it.
 *
 * A failure here is worth surfacing loudly and is not a failed trade: nothing
 * has moved, and the signature is still valid — it is simply somewhere only the
 * user's browser knows about. The UI says so rather than reporting a placed
 * order, because an order nobody can see is an order nobody will fill.
 */
export async function submitOrder(signed: SignedOrder): Promise<void> {
  const res = await fetch(ORDERS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = "";
    try {
      message = JSON.parse(body)?.error ?? "";
    } catch {
      /* A proxy or a build error answers with HTML, which is not worth showing. */
    }
    throw new Error(
      message ||
        `Your order was signed but couldn't be stored (${res.status}). Nothing has moved — the order just isn't visible to anyone who could fill it yet.`,
    );
  }
}

/**
 * A maker's orders on one chain, newest first.
 *
 * Filtered server-side by maker and chain rather than fetched whole and filtered
 * here. An order book is public — that is what makes it fillable by anyone — but
 * "public" and "shipped to every visitor in full" are different things, and the
 * list only ever renders one wallet's own orders.
 */
export async function fetchOrders(
  maker: string,
  chainId: number,
): Promise<StoredOrder[]> {
  const url = `${ORDERS_ENDPOINT}?maker=${encodeURIComponent(
    maker,
  )}&chainId=${chainId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Couldn't load your orders (${res.status}).`);
  }
  const body = await res.json();
  return Array.isArray(body?.orders) ? (body.orders as StoredOrder[]) : [];
}

/**
 * The orders that can still do something, out of a maker's whole list.
 *
 * Pure, and here rather than in each caller, because three of them need it — the
 * limit page's list, the agent's planner, the server-side reader — and an expiry
 * cutoff that drifts between them is a row one surface offers to cancel and
 * another has already hidden.
 *
 * Two different kinds of filter, applied together on purpose. `status` is the
 * keeper's cache, and this is the one place it is trusted as a filter rather than
 * as a fact: a row the keeper has not caught up on yet stays in, which is the
 * right way for it to be wrong — an order shown as open and then refused by
 * `checkFill` costs a sentence, while one hidden because a keeper cycle ran late
 * is an order the user cannot see to cancel. `expiry` needs no such trust. It is
 * inside the signature, so an order past it cannot fill no matter what any status
 * column says.
 */
export function openOnly(
  orders: StoredOrder[],
  now = Math.floor(Date.now() / 1000),
): StoredOrder[] {
  return orders.filter((o) => o.status === "open" && o.order.expiry > now);
}

/**
 * The earliest second an order's next fill is allowed. 0 when there is no next
 * fill to wait for, and null when the row cannot say.
 *
 * A transcription of KaleidoOrders.nextFillAt (KaleidoOrders.sol:237-242), and it
 * is written here rather than called because every caller that needs it has the
 * stored row in hand and would otherwise spend an eth_call per order to learn
 * something the row already contains. The contract stays the authority: the 0
 * sentinel is its 0, the branches are in its order, and if the two ever disagree
 * the contract is right.
 *
 * The third answer is the one the contract has no need for. On chain `fills` and
 * `lastFillAt` are one struct written in one statement, so `fills > 0` guarantees a
 * last-fill timestamp; here they are two columns, and a partial write can leave
 * `fills: 2` beside a null `lastFillAt`. There is exactly one honest thing to
 * return for that row — nothing — because the cadence runs from a fill this copy of
 * the book does not know the time of. Substituting `startAt` would put the answer
 * in the past and so report an order as ready when the contract will refuse it,
 * which is the wrong direction to be wrong in: it is the one that gets relayed to
 * the user as a fact.
 *
 * The cadence itself runs from the last fill rather than from `startAt` plus a
 * multiple of the interval, and the contract's own comment carries the reason: a
 * maker who missed Friday wants one buy next week, not two back to back the moment
 * a filler catches up.
 */
export function nextFillAt(stored: StoredOrder): number | null {
  const { order: o } = stored;
  if (stored.status === "cancelled" || stored.fills >= o.maxFills) return 0;
  if (stored.fills === 0) return o.startAt;
  return stored.lastFillAt === null ? null : stored.lastFillAt + o.interval;
}

/* -------------------------------------------------------------------------- */
/*  Display                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The one-line description of an order, for a review row and the list.
 *
 * Names the floor in the same breath as the amount, because the floor is the
 * order: "sell 1,000 KLD" is a market order and "sell 1,000 KLD for at least
 * 31.5 USDC" is this one. The recurrence clause is appended rather than
 * substituted so a weekly buy reads as the same object with a schedule, which is
 * what it is.
 */
export function describeOrder(args: {
  order: Order;
  symbolIn: string;
  symbolOut: string;
  decimalsIn: number;
  decimalsOut: number;
}): string {
  const { order, symbolIn, symbolOut, decimalsIn, decimalsOut } = args;
  const human = (v: string, d: number) =>
    Number(ethers.formatUnits(v, d)).toLocaleString(undefined, {
      maximumSignificantDigits: 6,
    });
  const base = `Sell ${human(order.amountIn, decimalsIn)} ${symbolIn} for at least ${human(
    order.minOut,
    decimalsOut,
  )} ${symbolOut}`;
  if (order.maxFills <= 1) return base;
  return `${base}, ${order.maxFills}× every ${describeInterval(order.interval)}`;
}

/**
 * The interval as a noun, so it reads after "every".
 *
 * Not {INTERVAL_CHOICES}' own labels: those are adjectives for a picker
 * ("Weekly"), and "4× every weekly" is not a sentence. Same seconds, different
 * part of speech, and the picker's version stays where a picker wants it.
 */
const INTERVAL_NOUNS: Record<number, string> = {
  604_800: "week",
  1_209_600: "2 weeks",
  2_592_000: "month",
};

/** "week", "2 weeks", "10 days" — whichever the seconds actually are. */
export function describeInterval(seconds: number): string {
  const named = INTERVAL_NOUNS[seconds];
  if (named) return named;
  const days = Math.round(seconds / 86_400);
  if (days >= 1) return days === 1 ? "day" : `${days} days`;
  const hours = Math.round(seconds / 3_600);
  return hours === 1 ? "hour" : `${hours} hours`;
}

/**
 * A window as a length of time — "7 days", "3 months".
 *
 * Distinct from {describeInterval}, which names a gap between repeats. Same
 * seconds can appear in both, and they read differently: an order that runs "for
 * 3 months" filling "every month" is one sentence with two units in it, and
 * collapsing them into one function makes one of the two wrong.
 */
export function describeDuration(seconds: number): string {
  const named = EXPIRY_CHOICES.find((c) => c.seconds === seconds);
  if (named) return named.label.replace(/^1 /, "");
  const days = Math.round(seconds / 86_400);
  if (days >= 1) return days === 1 ? "day" : `${days} days`;
  const hours = Math.max(1, Math.round(seconds / 3_600));
  return hours === 1 ? "hour" : `${hours} hours`;
}

/**
 * The same window where a sentence needs a determiner — "a week", "30 days".
 *
 * {describeDuration} returns a bare noun phrase, which is right after "in the
 * next" and "for another" and wrong after "for up to", "inside" and "longer
 * than": the singular named windows come back article-less, so the default
 * one-week expiry rendered as "resting for up to week" in the summary a maker
 * approves. The article cannot be added by the caller, because half the values
 * are counted ("30 days") and take none.
 */
export function describeDurationWithArticle(seconds: number): string {
  const d = describeDuration(seconds);
  return /^\d/.test(d) ? d : `a ${d}`;
}

/**
 * The pair on an order, for a sentence, using whatever names are available.
 *
 * Takes the symbols from the caller rather than looking them up, because this
 * module has no registry access — and because every caller that needs a label has
 * already resolved both tokens to get their decimals. A truncated address is the
 * honest fallback and never a decision; see symbolForAddress in
 * constants/tokens.ts for the same rule stated where it matters more.
 */
export function pairLabelFor(
  order: Order,
  symbolIn?: string,
  symbolOut?: string,
): string {
  const short = (a: string) => {
    try {
      const c = ethers.getAddress(a);
      return `${c.slice(0, 6)}…${c.slice(-4)}`;
    } catch {
      return a;
    }
  };
  return `${symbolIn ?? short(order.tokenIn)} → ${symbolOut ?? short(order.tokenOut)}`;
}

/**
 * A digest as it appears next to an order in prose — `0x` and eight characters.
 *
 * Eight rather than the six most explorers use, so the string this prints is one
 * {findByHash} will accept straight back. A label the user cannot paste into
 * their next sentence is a label that makes them read all 66 characters.
 */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

/**
 * Finds one order by digest, or by the first characters of one.
 *
 * A prefix is accepted because the only place anyone ever sees a digest is a list
 * this app rendered, and what comes back is the front of it. Eight hex characters
 * is the floor — 32 bits, against a store that holds at most a hundred orders per
 * maker — and anything shorter is refused rather than resolved: a prefix matching
 * two orders that quietly took the first would cancel the wrong one, and a cancel
 * is not recoverable by placing the same order again (the salt differs, so it is a
 * different order at a price the market has since moved past).
 *
 * Returns which of the three failures happened rather than null, so the caller
 * can say something useful: no match, an ambiguous prefix, or too few characters
 * to be one.
 */
export function findByHash(
  orders: StoredOrder[],
  hash: string,
): { order: StoredOrder } | { error: "short" | "none" | "ambiguous" } {
  const want = hash.trim().toLowerCase();
  const exact = orders.find((o) => o.hash.toLowerCase() === want);
  if (exact) return { order: exact };

  /* Compared against the 0x-stripped digest, so "0x1a2b3c4d" and "1a2b3c4d" are
     the same eight characters — a user pastes it either way. */
  const bare = want.startsWith("0x") ? want.slice(2) : want;
  if (!/^[0-9a-f]+$/.test(bare)) return { error: "none" };
  if (bare.length < 8) return { error: "short" };

  const hits = orders.filter((o) =>
    o.hash.toLowerCase().slice(2).startsWith(bare),
  );
  if (hits.length === 1) return { order: hits[0] };
  return { error: hits.length === 0 ? "none" : "ambiguous" };
}
