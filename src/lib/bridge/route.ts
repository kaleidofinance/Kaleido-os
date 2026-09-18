import { ethers } from "ethers";
import { getBridgeExecution, resolveChain } from "@/lib/ai/bridgeQuotes";
import {
  CCTP_ENABLED,
  buildCctpBurnRoute,
  isCctpCorridor,
  isKnownCctpTarget,
} from "@/lib/bridge/cctp";
import { resolveCctpFastFee } from "@/lib/bridge/cctpFast";
import type {
  BridgeRoute,
  BridgeRouteAlternative,
  BridgeRouteRequest,
} from "@/lib/v2/intents/build";

/**
 * The bridge resolver: a corridor in, a signable source-chain transaction out.
 *
 * This is the trusted origin of a `bridge` Intent's `to`, `data` and `value`.
 * A bridge transaction goes to a portal or an aggregator router, never to the
 * diamond, so LibAgentPermission.enforce() never runs and the auditor's
 * per-action USD cap is the only on-chain-shaped bound. That is exactly why
 * these three fields must come from here — a canonical constant or a provider
 * quote — and never from the model, and why `isKnownBridgeAddress` below lets
 * the auditor re-check a canonical `to` against the same table it was built
 * from.
 *
 * Two kinds of route:
 *
 *   CANONICAL — a fixed L1StandardBridge deposit, encoded here with no network
 *   call at all. Deterministic, so both the browser and the server produce the
 *   same bytes, and the landing page's static trace can build a real one. Native
 *   currency only, and that is a fact about the corridor rather than a policy of
 *   ours: `depositERC20To` credits the OptimismMintableERC20 that the factory
 *   paired with the L1 token, and our testnet mocks are independent deployments
 *   with no such pairing — a deposit would burn tokens into a representation
 *   nobody can mint. So an ERC20 skips this branch entirely and asks the
 *   aggregator, which refuses an unrouted corridor by name instead of routing
 *   it into a hole.
 *
 *   AGGREGATOR — LI.FI's own executable calldata, for corridors with no
 *   canonical portal. Native and ERC20 both. The aggregators do not index the
 *   testnets (measured: all five 4xx), so this path is effectively mainnet-only
 *   and lights up when a mainnet deployment lands.
 *
 * AN ERC20 LEG IS TWO SIGNATURES: an approve to the provider's router, then the
 * router's own calldata. That router is not one of ours, so the approve auditor
 * — which otherwise trusts only Kaleido contracts as spenders — had to be taught
 * about it. `isKnownBridgeSpender` below is that seam, and it is deliberately
 * ONE FIXED ADDRESS rather than "whatever the provider names": a spender is the
 * one field where being wrong survives the transaction, because an allowance is
 * a storage write that never consults the address it empowers. Everything the
 * provider says about the ERC20 leg is cross-checked before it can become a
 * plan — see the four checks in the aggregator branch.
 *
 * Isomorphic on purpose: useLocalPlanner (browser) and serverPlanDeps (route
 * handler) both call it, so it imports nothing server-only — ethers, the chain
 * registry via bridgeQuotes, and global fetch inside getBridgeExecution.
 */

const L1_STANDARD_BRIDGE_ABI = [
  "function depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable",
];

/**
 * Canonical native corridors: source chain id → destination chain id → the L1
 * bridge to deposit through.
 *
 * The one entry is verified: Base Sepolia's L1StandardBridge, deployed on
 * Ethereum Sepolia (11155111 → 84532). `depositETHTo` credits the given L2
 * recipient with the attached `value`.
 */
const CANONICAL_CORRIDORS: Record<
  number,
  Record<number, { l1Bridge: string }>
> = {
  11155111: {
    84532: { l1Bridge: "0xfd0Bf71F60660E2f608ed56e1659C450eB113120" },
  },
};

/** L2 gas the deposit buys for its credit; the portal fixes the price on L1. */
const CANONICAL_MIN_GAS_LIMIT = 200000;

/**
 * The transaction's own gasLimit floor. The OP portal burns gas in a
 * `gasleft()` loop, so estimateGas underruns and the deposit reverts out of
 * gas — the deposit-direction lesson recorded from the Abstract bridge work.
 * A fixed floor is the reliable fix.
 */
const CANONICAL_TX_GAS_LIMIT = "1000000";

/**
 * Whether an address is a canonical bridge the resolver would itself produce on
 * this chain. The auditor calls this to re-check a `canonical`-provider bridge's
 * `to` against the very table it was built from — defence in depth for the one
 * provider whose target is a fixed constant. An aggregator `to` is dynamic and
 * cannot be allow-listed this way; the USD cap bounds it instead.
 */
export function isKnownBridgeAddress(
  fromChainId: number,
  address: string,
): boolean {
  const corridors = CANONICAL_CORRIDORS[fromChainId];
  if (!corridors || !address) return false;
  const lower = address.toLowerCase();
  return Object.values(corridors).some(
    (c) => c.l1Bridge.toLowerCase() === lower,
  );
}

/**
 * The LI.FI diamond — the contract its quotes name as `estimate.approvalAddress`
 * and call as `transactionRequest.to`.
 *
 * Measured rather than looked up: quotes for 1→10 DAI, 1→137 USDC, 137→1 USDC
 * and 42161→8453 USDC, routed by four different underlying bridges (across,
 * mayanFastMCTP, polymerStandard), all returned this one address for BOTH
 * fields. LI.FI deploys its diamond deterministically at the same address on
 * every EVM chain it supports, which is why this is a flat constant and not a
 * per-chain table — inventing per-chain entries would be recording a guess as
 * data, and a wrong entry here fails closed anyway.
 */
const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";

/**
 * LI.FI’s executor on Arc, where the deterministic diamond above is NOT
 * deployed — measured: eth_getCode at 0x1231… on Arc mainnet returns 0x, while
 * this address carries code. LI.FI names it as BOTH `transactionRequest.to` and
 * `estimate.approvalAddress` for every Arc-source quote, verified stable across
 * destinations, amounts and tools and always with `to === approvalAddress`, so an
 * Arc→X token bridge routes through it rather than the diamond. Whitelisted under
 * the same USD-cap bound as the diamond; the only difference is that this one is
 * Arc-specific rather than the chain-blind constant.
 */
const LIFI_ARC_ROUTER = "0xA4072583658Fae592A3506A42431cb6316a8d40b";

/** Every router LI.FI names as a spender/target across our corridors. */
const KNOWN_BRIDGE_SPENDERS = [LIFI_DIAMOND, LIFI_ARC_ROUTER];

/**
 * Whether an address is a bridge router this resolver would itself authorise an
 * approve to. The approve auditor calls this, exactly as it calls
 * `isKnownBridgeAddress` for a canonical `to`: one table, read by both the
 * builder that emits the step and the rule that admits it.
 *
 * Chain-blind on purpose, and worth being plain about what that costs. LI.FI’s
 * router is one deterministic address on every EVM chain it supports EXCEPT Arc,
 * which runs a second fixed executor (LIFI_ARC_ROUTER) — so this checks a short
 * list of fixed addresses, not a per-chain table. The honest consequence is that
 * an approve naming either would be admitted on a chain LI.FI does not index.
 * Nothing can be *built* there — the resolver refuses the corridor before an
 * approve exists — so the residual exposure is a hand-assembled plan granting an
 * allowance to one of two fixed, LI.FI-controlled contracts, bounded by the
 * per-action USD cap like every other step.
 */
export function isKnownBridgeSpender(address: string): boolean {
  const lower = (address || "").toLowerCase();
  return (
    Boolean(address) &&
    (KNOWN_BRIDGE_SPENDERS.some((r) => r.toLowerCase() === lower) ||
      // CCTP's TokenMessengerV2 is the ERC20 leg's spender AND its call target;
      // one vetted fixed address on every V2 chain, read here so the approve
      // rule and the bridge rule's spender===to check both admit it.
      isKnownCctpTarget(address))
  );
}

/**
 * Resolve a corridor to a signable transaction, or an error the user can read.
 *
 * Returns `{ error }` rather than throwing so a bad corridor degrades the plan
 * to a named refusal instead of a 500 — the same contract every PlanDeps read
 * follows.
 */
/**
 * USDC amount at or above which the exact 1:1 (CCTP) route is preferred over the
 * instant aggregator fill by default.
 *
 * Below it, the solver spread on an instant fill is pennies and the arrives-in-
 * seconds, no-claim, no-destination-gas convenience wins outright. At or above
 * it the spread is real money AND aggregator liquidity on a young chain thins
 * out exactly there, so the exact 1:1 burn is worth its slower completion. A
 * user or the agent overrides this with `route`. Chosen 2026-09-18; revisit
 * against real volume in cctp_transfers.
 */
export const INSTANT_PREFERRED_MAX_USDC = 25_000;

/**
 * The instant route is only "instant" when the aggregator actually quotes a fast
 * fill. Some corridors route USDC through an ~18-minute message bridge (measured
 * 2026-09-18: Base->Arc via Polymer, ~1080s), which is slower than CCTP's fast
 * lane AND still charges a spread — the worst of both. So the auto pick prefers
 * the aggregator only when its quoted ETA is within this bound; past it, the
 * exact 1:1 burn wins. A user can still force either with `route`.
 */
export const INSTANT_MAX_ETA_SECONDS = 180;

/** The fields both route helpers need — the request, already amount-parsed. */
interface ResolveInput {
  fromChainId: number;
  dest: { id: number; shortName: string };
  asset: string;
  amount: string;
  decimals: number;
  isNative: boolean;
  tokenAddress?: string;
  userAddress: string;
  units: string;
  speed?: "standard" | "fast";
}

/**
 * The instant aggregator leg — LI.FI's own executable calldata, a solver that
 * fronts the destination funds so the user signs once and receives in seconds
 * with no claim. Returns null on no route (the caller falls back), or {error}
 * on a safety cross-check failure (a hard refusal that must surface). The four
 * ERC20 cross-checks are unchanged from before the refactor; see the header.
 */
async function tryAggregatorRoute(
  i: ResolveInput,
): Promise<BridgeRoute | { error: string } | null> {
  if (!ethers.isAddress(i.userAddress))
    return { error: "Connect a wallet to resolve an executable bridge route." };
  const exec = await getBridgeExecution({
    fromChainId: i.fromChainId,
    toChainId: i.dest.id,
    asset: i.asset,
    units: i.units,
    address: i.userAddress,
  });
  if (!exec) return null;

  /* The quote is for the corridor we asked about, or it is not usable. LI.FI
     echoes the source chain in its transactionRequest; a mismatch would be a
     transaction signed on the wrong chain. */
  if (exec.txChainId !== null && exec.txChainId !== i.fromChainId)
    return {
      error: `The provider quoted a transaction for chain ${exec.txChainId}, not the chain you're on. Not signing that.`,
    };

  const receivedUnits = exec.toAmount ?? undefined;

  if (i.isNative) {
    return {
      to: exec.to,
      data: exec.data,
      value: exec.value,
      toChainId: i.dest.id,
      toChainName: i.dest.shortName,
      provider: "lifi",
      etaSeconds: exec.etaSeconds,
      receivedUnits,
    };
  }

  /*
   * The ERC20 leg's four cross-checks, all fail-closed. Two independent
   * resolutions of the same symbol sit between us and the provider; nothing
   * guarantees they name the same contract, so: the spender must be the router
   * we know, it must equal the address the transaction calls, the token must be
   * the one we are about to approve, and the decimals must match `units`.
   */
  if (!exec.spender || !isKnownBridgeSpender(exec.spender))
    return {
      error: `The provider wants to be approved as ${exec.spender ?? "an unnamed address"}, which isn't the bridge router Kaleido recognises. Refusing rather than granting an allowance to it.`,
    };
  if (exec.spender.toLowerCase() !== exec.to.toLowerCase())
    return {
      error:
        "The provider's approval address isn't the contract its transaction calls. Refusing a bridge that would split the allowance from the call.",
    };
  if (
    i.tokenAddress &&
    exec.fromToken.address &&
    exec.fromToken.address.toLowerCase() !== i.tokenAddress.toLowerCase()
  )
    return {
      error: `The provider's ${i.asset} on this chain is ${exec.fromToken.address}, not the ${i.asset} Kaleido would approve (${i.tokenAddress}). Refusing rather than bridging a different token than the one shown.`,
    };
  if (exec.fromToken.decimals !== null && exec.fromToken.decimals !== i.decimals)
    return {
      error: `The provider says ${i.asset} has ${exec.fromToken.decimals} decimals and Kaleido scaled the amount at ${i.decimals}. Refusing rather than sending the wrong size.`,
    };
  if (BigInt(exec.value) !== 0n)
    return {
      error: `That route also asks for ${ethers.formatEther(exec.value)} of native currency as a fee, which Kaleido doesn't sign alongside a token bridge yet.`,
    };

  return {
    to: exec.to,
    data: exec.data,
    value: "0",
    spender: exec.spender,
    toChainId: i.dest.id,
    toChainName: i.dest.shortName,
    provider: "lifi",
    etaSeconds: exec.etaSeconds,
    receivedUnits,
  };
}

/**
 * The exact 1:1 leg — Circle's CCTP burn-and-mint. Pure but for the fast-fee
 * quote; returns null when CCTP is off, the asset isn't USDC, the corridor has
 * no CCTP lane, or the builder refuses, so the caller falls back to the instant
 * route instead of erroring.
 */
async function tryCctpRoute(i: ResolveInput): Promise<BridgeRoute | null> {
  if (
    !(
      CCTP_ENABLED &&
      i.asset.toUpperCase() === "USDC" &&
      isCctpCorridor(i.fromChainId, i.dest.id)
    )
  )
    return null;

  /* Fast by default: settle in seconds for a small Circle fee (0 on some
     corridors), quoting the cap + allowance. A full fast lane or a corridor
     without one degrades to a free Standard burn. `speed: "standard"` opts out. */
  let cctpSpeed: "standard" | "fast" = "standard";
  let maxFeeUnits = 0n;
  if ((i.speed ?? "fast") === "fast") {
    const quote = await resolveCctpFastFee({
      sourceChainId: i.fromChainId,
      destChainId: i.dest.id,
      units: BigInt(i.units),
    });
    if (quote.ok) {
      cctpSpeed = "fast";
      maxFeeUnits = quote.maxFeeUnits;
    }
  }
  const cctp = buildCctpBurnRoute({
    fromChainId: i.fromChainId,
    dest: i.dest,
    asset: i.asset,
    amount: i.amount,
    decimals: i.decimals,
    isNative: i.isNative,
    tokenAddress: i.tokenAddress,
    userAddress: i.userAddress,
    speed: cctpSpeed,
    maxFeeUnits,
  });
  if ("error" in cctp) return null;
  // 1:1 minus the (often zero) fast fee — what actually mints on the far side.
  const receivedUnits = (BigInt(i.units) - maxFeeUnits).toString();
  return { ...cctp, receivedUnits };
}

/** The loser route, as a one-line alternative for the agent/UI to offer. */
function toAlternative(r: BridgeRoute): BridgeRouteAlternative {
  return {
    provider: r.provider,
    route: r.provider === "cctp" ? "exact" : "instant",
    etaSeconds: r.etaSeconds,
    receivedUnits: r.receivedUnits ?? null,
  };
}

/**
 * Choose between the two USDC routes and pair the winner with the loser.
 *
 * Pure and exported so the decision — the whole behaviour change — is tested
 * without a network: the two network helpers resolve the routes, this picks.
 *
 *   - An explicit `route` wins outright ("exact"/"instant").
 *   - Otherwise: the instant fill is taken only when it is genuinely fast (ETA
 *     within INSTANT_MAX_ETA_SECONDS) AND the amount is below
 *     INSTANT_PREFERRED_MAX_USDC; otherwise the exact 1:1 burn wins. A
 *     non-finite amount is treated as large (prefers the exact 1:1).
 *   - Either input may be null (that route didn't resolve); the other is used.
 *   - Returns null only when BOTH are null.
 */
export function pickBridgeRoutes(opts: {
  instant: BridgeRoute | null;
  exact: BridgeRoute | null;
  route?: "instant" | "exact";
  amountNum: number;
}): { primary: BridgeRoute; alternative: BridgeRoute | null } | null {
  const { instant, exact, route, amountNum } = opts;

  // An explicit preference wins outright; the other route is a fallback only
  // when the chosen one did not resolve.
  if (route === "instant") {
    const primary = instant ?? exact;
    if (!primary) return null;
    return { primary, alternative: primary === instant ? (exact ?? null) : null };
  }
  if (route === "exact") {
    const primary = exact ?? instant;
    if (!primary) return null;
    return { primary, alternative: primary === exact ? (instant ?? null) : null };
  }

  // Auto: take the instant fill only when it is BOTH genuinely fast (a quoted
  // ETA within the bound — the aggregator is not always fast) AND the amount is
  // small enough that its spread is pennies. Otherwise the exact 1:1 burn wins.
  const instantIsFast =
    instant != null &&
    instant.etaSeconds != null &&
    instant.etaSeconds <= INSTANT_MAX_ETA_SECONDS;
  const small =
    Number.isFinite(amountNum) && amountNum < INSTANT_PREFERRED_MAX_USDC;
  const primary = instantIsFast && small ? instant : (exact ?? instant);
  if (!primary) return null;
  const alternative = primary === instant ? exact : instant;
  return { primary, alternative: alternative ?? null };
}

export async function resolveBridgeRoute(
  params: BridgeRouteRequest & { fromChainId: number; userAddress: string },
): Promise<BridgeRoute | { error: string }> {
  const {
    fromChainId,
    toChain,
    asset,
    amount,
    decimals,
    isNative,
    tokenAddress,
    userAddress,
    speed,
    route,
  } = params;

  const dest = resolveChain(toChain);
  if (!dest) return { error: `I don't recognise the chain "${toChain}".` };
  if (dest.id === fromChainId)
    return {
      error:
        `A bridge moves funds FROM the chain your wallet is on TO another one, ` +
        `and you're already on ${dest.shortName}. If you meant to bring ${asset} ` +
        `here from somewhere else, switch your wallet to that source chain first, ` +
        `then bridge to ${dest.shortName}.`,
    };

  // Amount → base units at the asset's decimals, refused here so a bad value
  // never reaches a portal call or an aggregator.
  let units: string;
  try {
    units = ethers.parseUnits(amount, decimals).toString();
  } catch {
    return { error: `${amount} isn't a valid ${asset} amount.` };
  }
  if (BigInt(units) <= 0n)
    return { error: `A bridge needs a positive amount, not ${amount}.` };

  const input: ResolveInput = {
    fromChainId,
    dest: { id: dest.id, shortName: dest.shortName },
    asset,
    amount,
    decimals,
    isNative,
    tokenAddress,
    userAddress,
    units,
    speed,
  };

  // 0) USDC on a CCTP corridor — the one place two genuinely good routes exist:
  //    an INSTANT aggregator solver-fill (seconds, no claim, no destination gas,
  //    a small spread) and CCTP's EXACT 1:1 burn-and-mint (no spread, but the
  //    destination mint must be completed — by our keeper or the user). We
  //    resolve both, pick a default by amount (or honour an explicit `route`),
  //    and return the loser as `alternative` so the agent/UI can offer a switch.
  //    Self-contained: USDC is never native/canonical, so this branch owns the
  //    whole decision and never falls through to the canonical path below.
  if (
    CCTP_ENABLED &&
    asset.toUpperCase() === "USDC" &&
    isCctpCorridor(fromChainId, dest.id)
  ) {
    // An explicit `route` resolves ONLY that leg — no second provider call, and
    // no live aggregator request on a forced-exact bridge (which keeps the
    // agent's CCTP path deterministic and offline). Auto resolves both, because
    // picking correctly needs the aggregator's real ETA, not a guess.
    const wantInstant = route !== "exact";
    const wantExact = route !== "instant";
    const [instant, exact] = await Promise.all([
      wantInstant
        ? tryAggregatorRoute(input)
        : Promise.resolve<BridgeRoute | { error: string } | null>(null),
      wantExact ? tryCctpRoute(input) : Promise.resolve<BridgeRoute | null>(null),
    ]);
    const instantOk = instant && !("error" in instant) ? instant : null;

    const picked = pickBridgeRoutes({
      instant: instantOk,
      exact,
      route,
      amountNum: Number(amount),
    });
    if (picked)
      return picked.alternative
        ? { ...picked.primary, alternative: toAlternative(picked.alternative) }
        : picked.primary;

    // Neither route resolved. Prefer the aggregator's own reason (a cross-check
    // refusal) over a generic miss, since CCTP fails silently to null.
    if (instant && "error" in instant) return instant;
    return {
      error: `No executable route for ${asset} to ${dest.shortName} right now. Kaleido can quote one via Relay or LI.FI for you to complete with the provider.`,
    };
  }

  // 1) Canonical corridor — a fixed portal deposit, encoded here, no network.
  //    Native only; see the CANONICAL note in the header for why an ERC20 must
  //    not take this branch rather than merely does not.
  const canonical = isNative
    ? CANONICAL_CORRIDORS[fromChainId]?.[dest.id]
    : undefined;
  if (canonical) {
    if (!ethers.isAddress(userAddress))
      return {
        error:
          "Connect a wallet first — the deposit credits your own address on the destination chain.",
      };
    const data = new ethers.Interface(
      L1_STANDARD_BRIDGE_ABI,
    ).encodeFunctionData("depositETHTo", [
      userAddress,
      CANONICAL_MIN_GAS_LIMIT,
      "0x",
    ]);
    return {
      to: canonical.l1Bridge,
      data,
      value: units,
      toChainId: dest.id,
      toChainName: dest.shortName,
      provider: "canonical",
      // No honest fixed ETA: an L1->L2 deposit credits when the sequencer picks
      // it up, which is minutes but not a number worth fabricating.
      etaSeconds: null,
      gasLimit: CANONICAL_TX_GAS_LIMIT,
    };
  }

  // 2) Aggregator — LI.FI's own executable transactionRequest, for every other
  //    corridor. Null on a testnet or an unrouted corridor, which becomes an
  //    honest refusal; {error} on a cross-check failure, surfaced as-is.
  const agg = await tryAggregatorRoute(input);
  if (agg === null)
    return {
      error: `No executable route for ${asset} to ${dest.shortName} right now. Kaleido can quote one via Relay or LI.FI for you to complete with the provider.`,
    };
  return agg;
}
