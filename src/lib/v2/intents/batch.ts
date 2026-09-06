import { ethers } from "ethers";

import { encodeV3Path } from "@/lib/dex/route";
import type { Intent, IntentKind } from "./types";

/**
 * Which adjacent steps can be signed together, and — mostly — which cannot.
 *
 * A plan is an ordered array of intents, and PlanReview executes them one
 * signature at a time. That is correct and stays the default. This module is the
 * narrow exception: EIP-5792 lets a wallet accept several calls under one
 * approval, so `approve` + the step it authorises can become one prompt instead
 * of two.
 *
 * ── WHY THIS IS NOT A `populate` ON EVERY RESOLVER ─────────────────────────────
 *
 * The obvious design is to give every IntentDef a `populate` beside its `resolve`
 * and batch the whole plan. It was rejected after reading the resolvers, and the
 * reason is that three of them are not pure calldata builders:
 *
 *   • `approve` reads `allowance()` and returns `{ skipped: true }` when the
 *     allowance already covers the amount. That read is the difference between
 *     one transaction and two, and it happens at signing time.
 *   • `mintPoolPosition` reads the factory and, if no pool exists, sends
 *     `createAndInitializePoolIfNecessary` and waits for it BEFORE minting. Two
 *     transactions from one intent, conditional on chain state.
 *   • `swapMultiHop` re-encodes the path and refuses to send if it disagrees with
 *     the intent's own `path`.
 *
 * A `populate` that returned "the calldata for this intent" would have to drop
 * those branches or duplicate them, and every future resolver would inherit an
 * interface it has to remember to keep faithful to `resolve`. The failure mode is
 * silent: a populate that drifts from its resolver sends different calldata than
 * the code everyone reads and tests.
 *
 * So batching is opt-in per kind, defined here, next to the reason. A kind absent
 * from `BATCHABLE` is executed the way it always was. Adding a kind is a decision
 * made in this file with its own justification, not a default that spreads.
 *
 * ── WHAT IS ACTUALLY BUNDLED ──────────────────────────────────────────────────
 *
 * Only a contiguous `approve` → consumer pair, where the approve's `spender` is
 * the address the next step calls. That is the pair worth collapsing: it is by far
 * the most common two-step plan in the app, the second step is useless without the
 * first, and the wallet prompt for the approve is the one users read least
 * carefully because it is boilerplate standing between them and the thing they
 * asked for.
 *
 * Longer runs are deliberately not merged. A plan of
 * `approve → swap → approve → stake` becomes two bundles of two, not one bundle
 * of four, because the second approve's spender is a different contract and a
 * user signing one prompt should be authorising one coherent action, not an
 * arbitrary-length list.
 *
 * ── WHAT IS NEVER BUNDLED, AND WHY IT MATTERS MORE THAN WHAT IS ────────────────
 *
 * `bridge` and `transfer`. Both are documented in `types.ts` as the two intents
 * that call no Kaleido contract, so `LibAgentPermission.enforce()` cannot scope
 * them and the auditor's per-action cap is the only bound that exists. Those are
 * exactly the two steps whose own wallet prompt is worth keeping: an irreversible
 * send to an address, and a cross-chain move to a contract we do not own. Nothing
 * here makes them cheaper to approve.
 */

/**
 * The kinds that may ride in a bundle, and how to build one call's worth of
 * calldata for each.
 *
 * `to`, `data` and `value` only — the three fields EIP-5792 carries. No gas
 * fields: the wallet estimates a bundle as a unit, and a per-call limit copied
 * from a single-transaction estimate would be wrong for it.
 *
 * Every entry restates the ABI fragment it encodes rather than importing the
 * resolver's, which sounds like the duplication the header just argued against
 * and is not: the resolvers build a contract from `ctx.signer` and send. There is
 * no calldata value in them to import. What has to be kept in step is the
 * *signature*, and both copies are checked against the same artifact — see the
 * width notes in `definitions.ts`, which apply here verbatim (a `uint256` where
 * the facet says `uint128` is a different selector and a `FunctionNotFound`).
 *
 * `npm run test:batch` asserts the two encodings agree for every kind in here, so
 * a drift is a failing test rather than a reverted transaction.
 */
const IFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
  "function deposit(address token, uint256 amount) external",
  "function depositCollateral(address token, uint256 amount) external payable",
  "function repayLoan(uint96 requestId, uint256 amount) external payable",
  "function serviceRequest(uint96 requestId, address token) external payable",
  "function mint(address to, uint256 kfUsdAmount, address collateralToken, uint256 collateralAmount) external",
  "function lockAssets(address assetToken, uint256 amount) external",
]);

/** One EIP-5792 call. Value is a bigint so the caller hexes it once, at the edge. */
export interface BatchCall {
  to: string;
  data: string;
  value?: bigint;
}

/**
 * A step's calldata, or `null` for "this kind does not batch".
 *
 * Returning null rather than throwing is the whole ergonomic point: the planner
 * asks every candidate pair and falls back to sequential execution for anything
 * that says no, so an unlisted kind costs nothing and breaks nothing.
 */
export type BatchEncoder = (intent: Intent) => BatchCall | null;

/** The deadline a bundled swap carries. Same default as the resolvers'. */
const deadlineFrom = (min: number | undefined, now: number) =>
  BigInt(Math.floor(now / 1000) + 60 * (min ?? 20));

const ENCODERS: Partial<Record<IntentKind, BatchEncoder>> = {
  approve: (raw) => {
    const i = raw as Extract<Intent, { kind: "approve" }>;
    return {
      to: i.token,
      data: IFACE.encodeFunctionData("approve", [
        i.spender,
        ethers.parseUnits(i.amount, i.decimals),
      ]),
    };
  },

  /*
   * A NATIVE SWAP IS NOT HERE, and it is the one exclusion in this table that
   * comes from the calldata rather than from policy.
   *
   * `nativeIn` rides as `value`, which a bundle can carry — but a native sell has
   * no approve step at all (see `Intent.nativeIn`), so there is no pair to
   * collapse and nothing to gain. `nativeOut` sends
   * `multicall([swap, unwrapWETH9])`, and folding that into a bundle would mean
   * re-deriving a multicall inside a batch entry, which is a second place for the
   * unwrap floor to be got wrong. Both fall through to the sequential path, which
   * already handles them and is tested.
   */
  swap: (raw) => {
    const i = raw as Extract<Intent, { kind: "swap" }>;
    if (i.nativeIn || i.nativeOut) return null;
    return {
      to: i.spender,
      data: IFACE.encodeFunctionData("exactInputSingle", [
        {
          tokenIn: i.tokenIn,
          tokenOut: i.tokenOut,
          fee: i.fee,
          recipient: RECIPIENT,
          deadline: deadlineFrom(i.deadlineMin, Date.now()),
          amountIn: ethers.parseUnits(i.amountIn, i.decimalsIn),
          amountOutMinimum: ethers.parseUnits(i.amountOutMin, i.decimalsOut),
          sqrtPriceLimitX96: 0,
        },
      ]),
    };
  },

  swapMultiHop: (raw) => {
    const i = raw as Extract<Intent, { kind: "swapMultiHop" }>;
    if (i.nativeIn || i.nativeOut) return null;
    /* Re-derived from `hops` and compared, exactly as the resolver does it, and
       the comparison is what makes this safe to bundle at all. A path that
       disagrees with the hops means the row the user read described a different
       route than the calldata performs, and there is no revert for that — the
       swap succeeds, through pools nobody agreed to. Returning null drops the
       whole run to the sequential path, where the resolver throws with the
       message that explains it. */
    const encoded = encodeV3Path(
      [i.hops[0].tokenIn, ...i.hops.map((h) => h.tokenOut)],
      i.hops.map((h) => h.fee),
    );
    if (encoded === "0x" || encoded !== i.path.toLowerCase()) return null;
    return {
      to: i.spender,
      data: IFACE.encodeFunctionData("exactInput", [
        {
          path: encoded,
          recipient: RECIPIENT,
          deadline: deadlineFrom(i.deadlineMin, Date.now()),
          amountIn: ethers.parseUnits(i.amountIn, i.decimalsIn),
          amountOutMinimum: ethers.parseUnits(i.amountOutMin, i.decimalsOut),
        },
      ]),
    };
  },

  stake: (raw) => {
    const i = raw as Extract<Intent, { kind: "stake" }>;
    return {
      to: i.vault,
      data: IFACE.encodeFunctionData("deposit", [
        i.token,
        ethers.parseUnits(i.amount, 18),
      ]),
    };
  },

  /* Native collateral has no approve to pair with, same as a native swap. */
  depositCollateral: (raw) => {
    const i = raw as Extract<Intent, { kind: "depositCollateral" }>;
    if (i.isNative) return null;
    return {
      to: i.diamond,
      data: IFACE.encodeFunctionData("depositCollateral", [
        i.token,
        ethers.parseUnits(i.amount, i.decimals),
      ]),
    };
  },

  repayLoan: (raw) => {
    const i = raw as Extract<Intent, { kind: "repayLoan" }>;
    if (i.isNative) return null;
    return {
      to: i.diamond,
      /* Already base units, and deliberately not re-derived from a display
         string: the repayment figure comes from the contract, so rounding it
         could close the loan short and leave it open. */
      data: IFACE.encodeFunctionData("repayLoan", [
        i.requestId,
        BigInt(i.amountRaw),
      ]),
    };
  },

  fillRequest: (raw) => {
    const i = raw as Extract<Intent, { kind: "fillRequest" }>;
    if (i.isNative) return null;
    return {
      to: i.diamond,
      data: IFACE.encodeFunctionData("serviceRequest", [i.requestId, i.token]),
    };
  },

  /*
   * kfUSD is minted 1:1 against collateral — the app makes no other claim, so the
   * kfUSD amount equals the collateral amount scaled to 18 decimals. Restated
   * from the resolver rather than shared, and pinned by the encoding test.
   */
  mintStable: (raw) => {
    const i = raw as Extract<Intent, { kind: "mintStable" }>;
    const collateral = ethers.parseUnits(
      i.collateralAmount,
      i.collateralDecimals,
    );
    /* SCALED UP FROM THE PARSED COLLATERAL, not re-parsed at 18 decimals, which
       is what this originally did and is wrong whenever the human string carries
       more places than the token holds: parseUnits("1.9999999", 6) truncates to
       1.999999, while parseUnits at 18 would keep the seventh digit and mint
       kfUSD against collateral that was never taken. The resolver derives it this
       way (definitions.ts, mintStable) and useStablecoin.ts before it. */
    const kfUsd =
      collateral * ethers.parseUnits("1", 18 - i.collateralDecimals);
    return {
      to: i.kfUSD,
      data: IFACE.encodeFunctionData("mint", [
        RECIPIENT,
        kfUsd,
        i.collateralToken,
        collateral,
      ]),
    };
  },

  lockStable: (raw) => {
    const i = raw as Extract<Intent, { kind: "lockStable" }>;
    return {
      to: i.kafUSD,
      data: IFACE.encodeFunctionData("lockAssets", [
        i.kfUSD,
        ethers.parseUnits(i.amount, 18),
      ]),
    };
  },
};

/**
 * Placeholder for the signer's own address, substituted by `encodeBatch`.
 *
 * The encoders are pure functions of an intent so the test can call them without
 * a wallet, but three of them need the recipient. A sentinel that is replaced
 * once, centrally, is safer than threading an address through every entry: this
 * one is a checksummed non-address that cannot be a real account, so a
 * substitution that failed to happen produces a transaction that reverts rather
 * than one that pays a stranger.
 */
const RECIPIENT = "0x0000000000000000000000000000000000000B47";

/** True when this kind can appear in a bundle at all. */
export function isBatchable(kind: IntentKind): boolean {
  return kind in ENCODERS;
}

/**
 * The bundle boundary: an `approve` immediately followed by the step it
 * authorises, on the same contract it authorises.
 *
 * The spender check is the safety property, not a tidiness one. Without it a plan
 * whose approve names contract A and whose next step calls contract B would be
 * bundled into one prompt, and the user would be granting an allowance to
 * something the visible action never touches. Compared case-insensitively because
 * intents carry addresses from several sources — the registry, a quote, a form —
 * and checksum casing is not guaranteed to agree across them.
 */
export function pairsWith(approve: Intent, next: Intent): boolean {
  if (approve.kind !== "approve") return false;
  if (!isBatchable(next.kind)) return false;

  const target = targetOf(next);
  return (
    target !== null && target.toLowerCase() === approve.spender.toLowerCase()
  );
}

/** The contract a step calls, for the spender comparison above. */
function targetOf(intent: Intent): string | null {
  const call = ENCODERS[intent.kind]?.(intent) ?? null;
  return call?.to ?? null;
}

/**
 * Split a plan into runs, each either one bundle or one sequential step.
 *
 * Every intent appears exactly once and in its original order — the plan the user
 * read is the plan that executes, with the same steps in the same sequence. All
 * this changes is how many wallet prompts they cover.
 */
export interface PlanRun {
  /** Indices into the original intent array, in order. */
  steps: number[];
  /** True when these are signed as one bundle. */
  bundled: boolean;
}

export function planRuns(intents: Intent[]): PlanRun[] {
  const runs: PlanRun[] = [];
  for (let i = 0; i < intents.length; i++) {
    const next = intents[i + 1];
    if (next && pairsWith(intents[i], next)) {
      runs.push({ steps: [i, i + 1], bundled: true });
      i++;
      continue;
    }
    runs.push({ steps: [i], bundled: false });
  }
  return runs;
}

/**
 * Calldata for a run, with the recipient substituted.
 *
 * Returns null when any step in the run cannot be encoded, so the caller falls
 * back to signing that run one step at a time. A partial bundle is never
 * returned: half of an approve-and-swap is an allowance granted for a swap that
 * did not happen.
 */
export function encodeBatch(
  intents: Intent[],
  steps: number[],
  address: string,
): BatchCall[] | null {
  const out: BatchCall[] = [];
  for (const idx of steps) {
    const intent = intents[idx];
    const encoder = ENCODERS[intent.kind];
    if (!encoder) return null;
    let call: BatchCall | null;
    try {
      call = encoder(intent);
    } catch {
      /* An unparseable amount, a malformed address. The sequential resolver will
         throw the same way and report it against the step that caused it, which
         is a better error than "the bundle could not be built". */
      return null;
    }
    if (!call) return null;
    out.push({
      ...call,
      data: call.data.split(RECIPIENT.slice(2).toLowerCase()).join(
        /* Lower-cased and unprefixed: ABI encoding pads an address to 32 bytes
           in lower case, so this is the form the sentinel actually appears in. */
        address.toLowerCase().slice(2),
      ),
    });
  }
  return out;
}
