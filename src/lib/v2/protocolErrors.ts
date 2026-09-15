import type { JsonFragment } from "ethers";

import ProtocolFacet from "@/abi/ProtocolFacet.json";
import ERC20Abi from "@/abi/ERC20Abi.json";
import KLDVaultAbi from "@/abi/KLDVaultAbi.json";
import KaleidoMasterChef from "@/abi/KaleidoMasterChef.json";
import AgentPermissionFacet from "@/abi/AgentPermissionFacet.json";

/**
 * The union of every custom error an agent plan can hit, and a plain-English line
 * for the ones a reader can act on.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The agent's "Sign & run" path (PlanReview) decoded failures with an
 * `ErrorDecoder.create()` built with NO ABI, and called `describeFailure` without
 * one. With no ABI a custom-error selector matches nothing, so the decoder's
 * `reason` becomes ethers' own literal complaint — "Encoded error signature
 * 0xd4030a2a not found on ABI…" — which is exactly what a tester saw when a borrow
 * reverted with `Protocol__NoCollateralDeposited`. The ABI *does* contain that
 * error; it was simply never handed to the decoder on this path.
 *
 * This module is that ABI. It is error fragments only (not the whole facets),
 * deduped by signature, so building an `Interface` from it can't collide on a
 * function selector shared across facets, and it stays small. The plans an agent
 * runs touch the lending diamond (ProtocolFacet), ERC-20 approvals, the KLD vault
 * and MasterChef, and the agent-grant facet — so those are the ABIs unioned here.
 */
function errorFragments(...abis: unknown[]): JsonFragment[] {
  const seen = new Set<string>();
  const out: JsonFragment[] = [];
  for (const abi of abis) {
    if (!Array.isArray(abi)) continue;
    for (const frag of abi as JsonFragment[]) {
      if (frag?.type !== "error" || !frag.name) continue;
      const sig = `${frag.name}(${(frag.inputs ?? [])
        .map((i) => i.type)
        .join(",")})`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(frag);
    }
  }
  return out;
}

/** Every custom error, error-only and deduped — safe to build one Interface from.
 * `JsonFragment[]` (not the broader InterfaceAbi) so it fits both
 * `ErrorDecoder.create([abi])` and `describeFailure`'s `InterfaceAbi` param. */
export const PROTOCOL_ERROR_ABI: JsonFragment[] = errorFragments(
  ProtocolFacet,
  ERC20Abi,
  KLDVaultAbi,
  KaleidoMasterChef,
  AgentPermissionFacet,
);

/**
 * Named errors → a sentence that says what went wrong and the next thing to do.
 *
 * Keyed by the contract's own error name. An error that isn't here still gets
 * named (see describeFailure) rather than shown as a raw selector — this map only
 * upgrades the ones where a reader can do something about it. Deliberately about
 * the action, not the mechanism: "deposit collateral first", not the selector.
 */
export const PROTOCOL_ERROR_HELP: Record<string, string> = {
  Protocol__NoCollateralDeposited:
    "You haven't deposited any collateral yet. Deposit collateral first, then borrow against it.",
  Protocol__InsufficientCollateral:
    "You don't have enough collateral for this. Deposit more, or borrow a smaller amount.",
  Protocol__InsufficientCollateralBalance:
    "You don't have enough collateral for this. Deposit more, or borrow a smaller amount.",
  Protocol__InsufficientCollateralDeposited:
    "You don't have enough collateral deposited for this. Deposit more, or borrow a smaller amount.",
  Protocol__CannotBorrowCollateralAsset:
    "You can't borrow the same asset you've put up as collateral. Pick a different asset to borrow.",
  Protocol__LoanAmountTooLow:
    "The minimum order size is $10. Increase the amount and try again.",
  Protocol__TokenNotLoanable:
    "That asset can't be borrowed here. Pick a supported asset.",
  Protocol__DateMustBeInFuture:
    "The return date has to be in the future. Pick a later date.",
  Protocol__InvalidAmount:
    "That amount isn't valid. Enter a positive amount and try again.",
  Protocol__BreaksHealthFactor:
    "This would push your position below a safe health factor. Borrow less, or add more collateral first.",
  EnforcedPause: "This action is paused right now. Try again a little later.",
};
