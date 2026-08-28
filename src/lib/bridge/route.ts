import { ethers } from "ethers";
import { getBridgeExecution, resolveChain } from "@/lib/ai/bridgeQuotes";
import type { BridgeRoute, BridgeRouteRequest } from "@/lib/v2/intents/build";

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
 * Whether an address is a bridge router this resolver would itself authorise an
 * approve to. The approve auditor calls this, exactly as it calls
 * `isKnownBridgeAddress` for a canonical `to`: one table, read by both the
 * builder that emits the step and the rule that admits it.
 *
 * Chain-blind on purpose, and worth being plain about what that costs. The
 * address is the same on every EVM chain, so there is no per-chain fact to
 * check; the honest consequence is that an approve naming it would be admitted
 * on a chain LI.FI does not index. Nothing can be *built* there — the resolver
 * refuses the corridor before an approve exists — so the residual exposure is a
 * hand-assembled plan granting an allowance to one fixed, widely-used contract,
 * bounded by the per-action USD cap like every other step.
 */
export function isKnownBridgeSpender(address: string): boolean {
  return (
    Boolean(address) && address.toLowerCase() === LIFI_DIAMOND.toLowerCase()
  );
}

/**
 * Resolve a corridor to a signable transaction, or an error the user can read.
 *
 * Returns `{ error }` rather than throwing so a bad corridor degrades the plan
 * to a named refusal instead of a 500 — the same contract every PlanDeps read
 * follows.
 */
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
  } = params;

  const dest = resolveChain(toChain);
  if (!dest) return { error: `I don't recognise the chain "${toChain}".` };
  if (dest.id === fromChainId)
    return { error: "That's the chain you're already on — nothing to bridge." };

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
      // No honest fixed ETA: an L1→L2 deposit credits when the sequencer picks
      // it up, which is minutes but not a number worth fabricating.
      etaSeconds: null,
      gasLimit: CANONICAL_TX_GAS_LIMIT,
    };
  }

  // 2) Aggregator — LI.FI's own executable transactionRequest. Null on a
  //    testnet or an unrouted corridor, which becomes an honest refusal.
  if (!ethers.isAddress(userAddress))
    return {
      error: "Connect a wallet to resolve an executable bridge route.",
    };
  const exec = await getBridgeExecution({
    fromChainId,
    toChainId: dest.id,
    asset,
    units,
    address: userAddress,
  });
  if (!exec)
    return {
      error: `No executable route for ${asset} to ${dest.shortName} right now. Kaleido can quote one via Relay or LI.FI for you to complete with the provider.`,
    };

  /* The quote is for the corridor we asked about, or it is not usable. LI.FI
     echoes the source chain in its transactionRequest; a mismatch would be a
     transaction signed on the wrong chain, which the auditor's own source-chain
     check would then refuse anyway — better to never build it. */
  if (exec.txChainId !== null && exec.txChainId !== fromChainId)
    return {
      error: `The provider quoted a transaction for chain ${exec.txChainId}, not the chain you're on. Not signing that.`,
    };

  if (isNative) {
    return {
      to: exec.to,
      data: exec.data,
      value: exec.value,
      toChainId: dest.id,
      toChainName: dest.shortName,
      provider: "lifi",
      etaSeconds: exec.etaSeconds,
    };
  }

  /*
   * The ERC20 leg's four cross-checks, all fail-closed.
   *
   * Between us and the provider sit two independent resolutions of the same
   * asset: we resolved `asset` to an address in our registry, and LI.FI resolved
   * the SAME SYMBOL against its own token list for this chain. Nothing
   * guarantees they landed on the same contract — Sepolia lending runs a mintable
   * mock USDC while LI.FI would name Circle's — and if they differ we would
   * approve one token and hand the router calldata pulling another. The
   * transaction reverts in the good case; in the bad one the allowance is left
   * standing on a token the user never meant to expose. So: the spender must be
   * the router we know, it must be the same address the transaction calls, the
   * token must be the one we are about to approve, and the decimals must be the
   * ones `units` was scaled at.
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
    tokenAddress &&
    exec.fromToken.address &&
    exec.fromToken.address.toLowerCase() !== tokenAddress.toLowerCase()
  )
    return {
      error: `The provider's ${asset} on this chain is ${exec.fromToken.address}, not the ${asset} Kaleido would approve (${tokenAddress}). Refusing rather than bridging a different token than the one shown.`,
    };
  if (exec.fromToken.decimals !== null && exec.fromToken.decimals !== decimals)
    return {
      error: `The provider says ${asset} has ${exec.fromToken.decimals} decimals and Kaleido scaled the amount at ${decimals}. Refusing rather than sending the wrong size.`,
    };
  /* An ERC20 bridge that also wants native value alongside it — a relayer fee
     some corridors charge — is refused, not silently signed. The bridge row
     states one amount in one asset, the auditor ties `value` to it for a native
     bridge, and there is no honest way to show a second charge in a shape that
     carries one. Measured: every ERC20 quote sampled attached zero. */
  if (BigInt(exec.value) !== 0n)
    return {
      error: `That route also asks for ${ethers.formatEther(exec.value)} of native currency as a fee, which Kaleido doesn't sign alongside a token bridge yet.`,
    };

  return {
    to: exec.to,
    data: exec.data,
    value: "0",
    spender: exec.spender,
    toChainId: dest.id,
    toChainName: dest.shortName,
    provider: "lifi",
    etaSeconds: exec.etaSeconds,
  };
}
