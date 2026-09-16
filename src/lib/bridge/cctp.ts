import { ethers } from "ethers";
import type { BridgeRoute } from "@/lib/v2/intents/build";

/**
 * Circle CCTP V2 — the native USDC corridor, and why it is its own provider.
 *
 * Arc's gas token IS USDC, and Circle runs CCTP V2 on Arc natively. CCTP moves
 * USDC by BURN-AND-MINT, not by a locked-liquidity bridge: `depositForBurn`
 * burns USDC on the source chain, Circle's attestation service signs the
 * message once the source reaches finality, and `receiveMessage` mints the same
 * USDC 1:1 on the destination. No wrapped representation, no pool, no slippage,
 * no liquidity risk — for plain USDC in and out of Arc it is strictly better
 * than any aggregator route, and LI.FI's Arc registry does not carry it.
 *
 * The catch, and the reason this file builds only HALF the transfer:
 *
 *   CCTP does not deliver itself. Unlike the OP canonical portal or LI.FI —
 *   whose relayers credit the destination from the single source transaction we
 *   sign — a CCTP transfer is finished only when someone submits
 *   `receiveMessage(message, attestation)` on the DESTINATION chain, after
 *   polling Circle's Iris attestation API. That is a second signature, on a
 *   different chain, needing gas there. Our `bridge` Intent models one
 *   source-chain transaction and assumes automatic delivery, so it cannot
 *   express the mint leg.
 *
 * Therefore this module resolves the SOURCE BURN LEG only — a deterministic
 * `[approve, depositForBurn]` pair, in exactly the shape `resolveBridgeRoute`
 * already emits for an ERC20 corridor — and is held behind {@link CCTP_ENABLED},
 * OFF, until the completion path (attestation poll + a destination-chain
 * `cctpReceive` intent + its auditor rule) lands in a follow-up. Shipping the
 * burn alone would strand a user's USDC in a burned-but-unminted state,
 * recoverable only by hand at bridge.usdc.com. So the flag stays down.
 *
 * Everything here is pure: like the `canonical` provider it does no network I/O,
 * so the browser planner and the server planner produce identical bytes, and the
 * auditor re-checks the one fixed `to` against the same constant table below.
 * Every address and domain is verified on Arc mainnet and against Circle's docs
 * (see the constants).
 */

/**
 * TokenMessengerV2 — the contract `depositForBurn` calls and the ERC20 leg
 * approves. Circle deploys it at one deterministic address on every V2 EVM
 * chain (verified: `eth_getCode` non-empty on Arc 5042, Base 8453 and Ethereum
 * mainnet; TokenMessenger.localMinter and .localMessageTransmitter on Arc point
 * back at the V2 set below). Chain-blind, so a flat constant, not a table.
 */
export const TOKEN_MESSENGER_V2 =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

/**
 * MessageTransmitterV2 — where the destination mint is completed
 * (`receiveMessage`). Not called by anything in THIS module (the burn leg does
 * not touch it); exported for the completion PR and the auditor rule it will
 * add. Same deterministic address across V2 chains (verified on Arc).
 */
export const MESSAGE_TRANSMITTER_V2 =
  "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

/**
 * CCTP domain ids — Circle's own chain numbering, distinct from EVM chain ids,
 * and what `destinationDomain` in `depositForBurn` takes. Verified against
 * Circle's published domain list AND, for Arc, on-chain
 * (MessageTransmitterV2.localDomain() returned 26 on rpc.mainnet.arc.io).
 *
 * Only the chains this app can bridge between are listed. BNB and the Robinhood
 * chain are NOT CCTP domains, so a corridor touching them is not a CCTP corridor
 * and falls through to the aggregator.
 */
export const CCTP_DOMAINS: Record<number, number> = {
  1: 0, // Ethereum
  8453: 6, // Base
  5042: 26, // Arc
};

/**
 * The USDC each chain burns — the `burnToken` argument, and the token the ERC20
 * leg approves. Must be the exact contract Circle's TokenMinter supports on that
 * chain, or `depositForBurn` reverts (leaving only a standing allowance, bounded
 * by the per-action cap — but we refuse a mismatch before it can happen).
 *
 *   Arc      0x3600… — the 6-decimal USDC alias, verified symbol "USDC",
 *            decimals 6, and TokenMinter.burnLimitsPerMessage = 10,000,000 (a
 *            nonzero limit is Circle's "this token is supported" signal).
 *   Base     0x8335…2913 — verified symbol "USDC", decimals 6, burn limit 10M.
 *   Ethereum 0xA0b8…eB48 — Circle's canonical USDC, 6 decimals; TokenMessengerV2
 *            present on mainnet (the USDC read rate-limited on the public RPC, so
 *            this one address is the well-known constant rather than locally
 *            re-decoded — every other fact in this file was probed).
 */
export const CCTP_USDC: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  5042: "0x3600000000000000000000000000000000000000",
};

/**
 * Circle's per-message burn ceiling on the corridors we use (10,000,000 USDC,
 * verified identical on Arc and Base). The protocol reverts above it; we refuse
 * above it first, with a readable reason instead of a revert. A conservative
 * floor, not a live read — CCTP corridors are inert here anyway (see the flag).
 */
const MAX_BURN_UNITS = ethers.parseUnits("10000000", 6);

/**
 * THE KILL-SWITCH. CCTP is a two-leg, two-chain, asynchronous transfer and this
 * module builds only the source burn (see the file header). Turning corridors on
 * before the destination-mint completer exists would strand burned USDC. So this
 * is a code constant, not an env flag: identical in the browser and on the
 * server, flipped in the same PR that ships the completion path, reviewed as a
 * code change. Do not set it true until `receiveMessage` completion lands.
 */
export const CCTP_ENABLED = false;

/** Whether a chain speaks CCTP V2 in a way this app can route. */
export function isCctpDomainChain(chainId: number | undefined): boolean {
  return chainId !== undefined && chainId in CCTP_DOMAINS;
}

/** True when both ends of a corridor are CCTP domains this app knows. */
export function isCctpCorridor(
  fromChainId: number | undefined,
  toChainId: number | undefined,
): boolean {
  return (
    isCctpDomainChain(fromChainId) &&
    isCctpDomainChain(toChainId) &&
    fromChainId !== toChainId
  );
}

/**
 * Whether an address is the CCTP contract this resolver would itself target and
 * approve — TokenMessengerV2. The auditor calls this to re-check a `cctp`
 * provider's `to` (and its ERC20 spender, which equals `to`) against the same
 * fixed constant the route was built from, exactly as `isKnownBridgeAddress`
 * re-checks a canonical `to`. A `cctp` bridge whose `to` is not this fails.
 */
export function isKnownCctpTarget(address: string): boolean {
  return (
    Boolean(address) &&
    address.toLowerCase() === TOKEN_MESSENGER_V2.toLowerCase()
  );
}

/**
 * Whether an address is MessageTransmitterV2 — the contract the DESTINATION-leg
 * `receiveMessage` calls, and the one the auditor allow-lists a `cctpReceive`
 * intent's `to` against. Same fixed constant on every V2 chain.
 */
export function isKnownCctpTransmitter(address: string): boolean {
  return (
    Boolean(address) &&
    address.toLowerCase() === MESSAGE_TRANSMITTER_V2.toLowerCase()
  );
}

/** Circle's domain id for an EVM chain, or undefined if it is not a CCTP chain. */
export function cctpDomainForChain(chainId: number | undefined): number | undefined {
  return chainId === undefined ? undefined : CCTP_DOMAINS[chainId];
}

const MESSAGE_TRANSMITTER_V2_ABI = [
  // CCTP V2 completion: submit the burn `message` and Circle's `attestation` on
  // the destination chain to mint the USDC. Permissionless when the burn set a
  // zero destinationCaller (as buildCctpBurnRoute does).
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
];

/**
 * The destination-mint calldata — `receiveMessage(message, attestation)` — for a
 * `cctpReceive` intent. Pure: `message` and `attestation` come from Circle's
 * attestation service (see cctpAttestation.ts), never the model, and the auditor
 * pins the `to` this pairs with to {@link isKnownCctpTransmitter}.
 */
export function encodeCctpReceive(message: string, attestation: string): string {
  return new ethers.Interface(MESSAGE_TRANSMITTER_V2_ABI).encodeFunctionData(
    "receiveMessage",
    [message, attestation],
  );
}

const TOKEN_MESSENGER_V2_ABI = [
  // CCTP V2 depositForBurn — the 7-arg form (V1 took 5). Verified live on Arc:
  // a static call past the selector reverted at the USDC transfer, i.e. the
  // selector dispatched, which a wrong signature would not.
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
];

/**
 * Circle's finality thresholds. Standard (2000 = "finalized") waits for the
 * source chain's hard finality and is free. Fast (1000 = "confirmed") attests in
 * seconds against Circle's Fast Transfer Allowance and charges a small `maxFee`,
 * deducted from the amount at mint. Which one a burn asks for is the whole
 * difference between the two speeds; resolveCctpFastFee reads the fee/allowance.
 */
const FINALITY_THRESHOLD_STANDARD = 2000;
const FINALITY_THRESHOLD_FAST = 1000;

/** How fast the transfer settles — see the threshold note above. */
export type CctpSpeed = "standard" | "fast";

/**
 * Build the CCTP source burn leg, or an error to fall through on.
 *
 * `dest` is the caller's already-resolved destination chain, so this makes no
 * chain-name lookup of its own. Pure and deterministic: the returned `to`,
 * `data` and `value` are the same bytes on the client and the server, which is
 * why the auditor can re-derive trust in `to` from {@link isKnownCctpTarget}
 * alone.
 *
 * Fail-closed, and each refusal is a reason the caller can either surface or
 * treat as "not a CCTP corridor, try the aggregator":
 *  - USDC only, ERC20 only (Arc's USDC is an ERC20 even though it is the gas
 *    token — the 6-decimal alias, not the native balance);
 *  - both ends must be CCTP domains;
 *  - the token we would approve must be the exact `burnToken` for this chain,
 *    never a look-alike;
 *  - amount positive and within Circle's per-message ceiling.
 */
export function buildCctpBurnRoute(params: {
  fromChainId: number;
  dest: { id: number; shortName: string };
  asset: string;
  amount: string;
  decimals: number;
  isNative: boolean;
  tokenAddress?: string;
  userAddress: string;
  /** "standard" (free, finality-bound) by default; "fast" needs `maxFeeUnits`. */
  speed?: CctpSpeed;
  /** The Fast Transfer fee cap in burn-token units — from resolveCctpFastFee. */
  maxFeeUnits?: bigint;
}): BridgeRoute | { error: string } {
  const {
    fromChainId,
    dest,
    asset,
    amount,
    decimals,
    isNative,
    tokenAddress,
    userAddress,
    speed = "standard",
    maxFeeUnits = 0n,
  } = params;

  if (asset.toUpperCase() !== "USDC")
    return { error: `CCTP only carries USDC, not ${asset}.` };

  // Arc's USDC is the 6-decimal ERC20 alias, not the native gas balance; a
  // native-flagged leg would send no token to burn.
  if (isNative)
    return { error: "CCTP burns the USDC token, not native currency." };

  if (!isCctpCorridor(fromChainId, dest.id))
    return {
      error: `CCTP doesn't connect ${fromChainId} to ${dest.shortName}.`,
    };

  if (!ethers.isAddress(userAddress))
    return {
      error:
        "Connect a wallet first — CCTP mints to your own address on the destination chain.",
    };

  const burnToken = CCTP_USDC[fromChainId];
  // The token the plan would approve must be the one we are about to name as
  // `burnToken`. A mismatch means our registry and the corridor disagree about
  // what USDC is on this chain; refuse rather than approve one and burn another.
  if (
    tokenAddress &&
    burnToken &&
    tokenAddress.toLowerCase() !== burnToken.toLowerCase()
  )
    return {
      error: `The USDC to approve (${tokenAddress}) isn't the CCTP burn token on this chain (${burnToken}).`,
    };

  let units: bigint;
  try {
    units = ethers.parseUnits(amount, decimals);
  } catch {
    return { error: `${amount} isn't a valid USDC amount.` };
  }
  if (units <= 0n)
    return { error: `A bridge needs a positive amount, not ${amount}.` };
  if (units > MAX_BURN_UNITS)
    return {
      error: `CCTP caps a single transfer at ${ethers.formatUnits(MAX_BURN_UNITS, 6)} USDC.`,
    };

  const destinationDomain = CCTP_DOMAINS[dest.id];
  // mintRecipient is a bytes32, an EVM address left-padded to 32 bytes. Same
  // address on the destination — true for EOAs and same-address smart wallets;
  // the completion PR will let the recipient be named for wallets that differ.
  const mintRecipient = ethers.zeroPadValue(userAddress, 32);
  // destinationCaller zero = anyone may complete the mint (permissionless
  // receiveMessage). Standard: threshold 2000, maxFee 0 (free, finality-bound).
  // Fast: threshold 1000, maxFee = the cap resolveCctpFastFee quoted (seconds,
  // small fee deducted at mint).
  const fast = speed === "fast";
  const maxFee = fast ? maxFeeUnits : 0n;
  const threshold = fast
    ? FINALITY_THRESHOLD_FAST
    : FINALITY_THRESHOLD_STANDARD;
  const data = new ethers.Interface(
    TOKEN_MESSENGER_V2_ABI,
  ).encodeFunctionData("depositForBurn", [
    units,
    destinationDomain,
    mintRecipient,
    burnToken,
    ethers.ZeroHash,
    maxFee,
    threshold,
  ]);

  return {
    to: TOKEN_MESSENGER_V2,
    data,
    value: "0",
    toChainId: dest.id,
    toChainName: dest.shortName,
    provider: "cctp",
    // No honest fixed ETA: Standard Transfer credits after the source chain
    // finalises and the recipient completes the mint — minutes, not a number
    // worth fabricating.
    etaSeconds: null,
    spender: TOKEN_MESSENGER_V2,
  };
}
