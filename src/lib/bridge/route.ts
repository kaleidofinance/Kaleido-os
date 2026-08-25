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
 * Two kinds of route, one refusal:
 *
 *   CANONICAL — a fixed L1StandardBridge deposit, encoded here with no network
 *   call at all. Deterministic, so both the browser and the server produce the
 *   same bytes, and the landing page's static trace can build a real one.
 *
 *   AGGREGATOR — LI.FI's own executable calldata, for corridors with no
 *   canonical portal. The aggregators do not index the testnets (measured: all
 *   five 4xx), so this path is effectively mainnet-only and lights up when a
 *   mainnet deployment lands.
 *
 *   NON-NATIVE — refused by name. See the native-only note on the `bridge`
 *   Intent in intents/types.ts: an ERC20 leg needs an approve to the router,
 *   which the approve auditor pins to Kaleido contracts and would reject.
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
 * Resolve a corridor to a signable transaction, or an error the user can read.
 *
 * Returns `{ error }` rather than throwing so a bad corridor degrades the plan
 * to a named refusal instead of a 500 — the same contract every PlanDeps read
 * follows.
 */
export async function resolveBridgeRoute(
  params: BridgeRouteRequest & { fromChainId: number; userAddress: string },
): Promise<BridgeRoute | { error: string }> {
  const { fromChainId, toChain, asset, amount, decimals, isNative, userAddress } =
    params;

  // Native only for the MVP. An ERC20 bridge would emit an approve to the
  // router, and the approve auditor only trusts Kaleido contracts as spenders —
  // so it would be audited down to a refusal. Refuse by name here instead, and
  // leave this branch as the seam the ERC20 leg slots into.
  if (!isNative) {
    return {
      error: `Bridging ${asset} isn't wired for execution yet — only a chain's native currency is. Kaleido can still quote an ERC20 route for you to complete with the provider.`,
    };
  }

  const dest = resolveChain(toChain);
  if (!dest) return { error: `I don't recognise the chain "${toChain}".` };
  if (dest.id === fromChainId)
    return { error: "That's the chain you're already on — nothing to bridge." };

  // Amount → wei at the asset's decimals, refused here so a bad value never
  // reaches a portal call or an aggregator.
  let value: string;
  try {
    value = ethers.parseUnits(amount, decimals).toString();
  } catch {
    return { error: `${amount} isn't a valid ${asset} amount.` };
  }
  if (BigInt(value) <= 0n)
    return { error: `A bridge needs a positive amount, not ${amount}.` };

  // 1) Canonical corridor — a fixed portal deposit, encoded here, no network.
  const canonical = CANONICAL_CORRIDORS[fromChainId]?.[dest.id];
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
      value,
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
    units: value,
    address: userAddress,
  });
  if (!exec)
    return {
      error: `No executable route for ${asset} to ${dest.shortName} right now. Kaleido can quote one via Relay or LI.FI for you to complete with the provider.`,
    };
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
