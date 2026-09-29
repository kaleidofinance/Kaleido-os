/**
 * Pre-checks for a lending plan, run while it is BUILT — so Luca refuses a borrow
 * the contract would refuse, in plain words, before the user is asked to sign.
 *
 * Mirrors the facet exactly (smart-contract/contracts/facets/ProtocolFacet.sol,
 * constants in utils/constants/constant.sol):
 *   - pause: `_whenNotPaused` gates createLendingRequest, serviceRequest,
 *     createLoanListing and requestLoanFromListing — never repay / withdraw /
 *     deposit / liquidate;
 *   - $10 floor: MIN_LOAN_AMOUNT (10e18) on createLendingRequest and
 *     createLoanListing;
 *   - capacity: COLLATERALIZATION_RATIO 75 — a new loan must satisfy
 *     outstanding debt + loan < 75% of collateral value (the contract reverts on
 *     `>=`), on createLendingRequest and requestLoanFromListing;
 *   - a price past its bound reverts Protocol__StalePrice.
 *
 * The contract stays the judge: every figure is READ from the diamond
 * (getUsdValue, getAccountCollateralValue, getLoanCollectedInUsd, paused), never
 * re-derived. Unknown reads FAIL OPEN (no verdict) — the sign-time preflight and
 * the plan simulation still run — because refusing on a failed RPC would block a
 * valid loan on an outage.
 *
 * Collateral deposited EARLIER IN THE SAME PLAN counts: the model builds each tool
 * call separately ("deposit EURC" then "borrow USDC"), and without this a
 * legitimate deposit-then-borrow would be refused for capacity it is about to have.
 */
import { ethers } from "ethers";

import ProtocolFacetAbi from "@/abi/ProtocolFacet.json";
import LendingAdminFacetAbi from "@/abi/LendingAdminFacet.json";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { PROTOCOL_ERROR_HELP } from "@/lib/v2/protocolErrors";

export const MIN_LOAN_USD = 10n * 10n ** 18n;
export const COLLATERALIZATION_RATIO = 75n;

export type LendingAction = "borrow" | "lend" | "takeListing" | "fill";

export interface PendingCollateral {
  token: string;
  amountRaw: bigint;
  decimals: number;
}

export interface LendingCheck {
  action: LendingAction;
  /** Loan currency (address(1) for native). */
  token: string;
  symbol: string;
  amountRaw: bigint;
  decimals: number;
  /** Collateral this same plan deposits before the loan step. */
  pendingCollateral?: PendingCollateral[];
}

/** What the reader learned; `undefined` = could not be read (fail open). */
export interface LendingFacts {
  paused?: boolean;
  /** A price the action needs is past its bound. */
  stale?: boolean;
  /** USD value of the loan amount, 18dp. */
  loanUsd?: bigint;
  /** Collateral value incl. pending deposits, 18dp. */
  collateralUsd?: bigint;
  /** Outstanding debt on serviced loans, 18dp. */
  debtUsd?: bigint;
}

const usd = (x: bigint) =>
  Number(ethers.formatUnits(x, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** The decision, pure. Null = nothing to object to (or not enough known). */
export function lendingVerdict(check: LendingCheck, facts: LendingFacts): string | null {
  // Every action here opens risk, so every one is paused.
  if (facts.paused === true) return PROTOCOL_ERROR_HELP.Protocol__Paused;
  if (facts.stale === true) return PROTOCOL_ERROR_HELP.Protocol__StalePrice;

  if ((check.action === "borrow" || check.action === "lend") && facts.loanUsd !== undefined) {
    if (facts.loanUsd < MIN_LOAN_USD) {
      return `The minimum loan is $10 — ${ethers.formatUnits(check.amountRaw, check.decimals)} ${check.symbol} is about $${usd(facts.loanUsd)}. Increase the amount and try again.`;
    }
  }

  if (
    (check.action === "borrow" || check.action === "takeListing") &&
    facts.loanUsd !== undefined &&
    facts.collateralUsd !== undefined &&
    facts.debtUsd !== undefined
  ) {
    if (facts.collateralUsd === 0n) return PROTOCOL_ERROR_HELP.Protocol__NoCollateralDeposited;
    const cap = (facts.collateralUsd * COLLATERALIZATION_RATIO) / 100n;
    if (facts.debtUsd + facts.loanUsd >= cap) {
      const room = cap > facts.debtUsd ? cap - facts.debtUsd : 0n;
      const owed = facts.debtUsd > 0n ? `, minus $${usd(facts.debtUsd)} you already owe` : "";
      return `That's more than your collateral supports. You can borrow up to about $${usd(room)} more (75% of your $${usd(facts.collateralUsd)} collateral${owed}). Deposit more collateral or borrow less.`;
    }
  }
  return null;
}

const protocol = new ethers.Interface(ProtocolFacetAbi as ethers.InterfaceAbi);
const admin = new ethers.Interface(LendingAdminFacetAbi as ethers.InterfaceAbi);

/** A revert's custom-error name, or null when the failure was not a revert. */
function revertName(e: unknown): string | null {
  const err = e as { data?: string; info?: { error?: { data?: string } }; code?: string };
  for (const data of [err?.data, err?.info?.error?.data]) {
    if (typeof data !== "string" || data.length < 10) continue;
    try {
      const parsed = protocol.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      /* not one of ours */
    }
  }
  return err?.code === "CALL_EXCEPTION" ? "reverted" : null;
}

type Read<T> = { ok: true; value: T } | { ok: false; stale: boolean };

/**
 * Read the facts for one check. Each read is independent; a stale-price revert is
 * recorded as such, any other failure as unknown.
 */
export async function readLendingFacts(
  chainId: number | undefined,
  address: string | undefined,
  check: LendingCheck,
): Promise<LendingFacts> {
  const diamondAddress = getContracts(chainId).diamond;
  const provider = providerForChain(chainId);
  if (!diamondAddress || !provider) return {};
  const diamond = new ethers.Contract(diamondAddress, protocol, provider);
  const pausable = new ethers.Contract(diamondAddress, admin, provider);

  const read = async <T>(fn: () => Promise<T>): Promise<Read<T>> => {
    try {
      return { ok: true, value: await retryRpc(fn) };
    } catch (e) {
      return { ok: false, stale: revertName(e) === "Protocol__StalePrice" };
    }
  };

  const facts: LendingFacts = {};
  const paused = await read(() => pausable.paused() as Promise<boolean>);
  if (paused.ok) facts.paused = paused.value;

  const loanUsd = await read(
    () => diamond.getUsdValue(check.token, check.amountRaw, check.decimals) as Promise<bigint>,
  );
  if (loanUsd.ok) facts.loanUsd = BigInt(loanUsd.value);
  else if (loanUsd.stale) facts.stale = true;

  if ((check.action === "borrow" || check.action === "takeListing") && address) {
    const [collateral, debt] = await Promise.all([
      read(() => diamond.getAccountCollateralValue(address) as Promise<bigint>),
      read(() => diamond.getLoanCollectedInUsd(address) as Promise<bigint>),
    ]);
    if (collateral.ok === false && collateral.stale) facts.stale = true;
    if (debt.ok === false && debt.stale) facts.stale = true;
    let pendingUsd: bigint | undefined = 0n;
    for (const p of check.pendingCollateral ?? []) {
      const v = await read(() => diamond.getUsdValue(p.token, p.amountRaw, p.decimals) as Promise<bigint>);
      if (v.ok) pendingUsd = (pendingUsd ?? 0n) + BigInt(v.value);
      else {
        if (v.stale) facts.stale = true;
        pendingUsd = undefined;
        break;
      }
    }
    if (collateral.ok && pendingUsd !== undefined) facts.collateralUsd = BigInt(collateral.value) + pendingUsd;
    if (debt.ok) facts.debtUsd = BigInt(debt.value);
  }
  return facts;
}

/** Production check: read, then decide. Null when nothing to object to. */
export async function checkLending(
  chainId: number | undefined,
  address: string | undefined,
  check: LendingCheck,
): Promise<string | null> {
  try {
    return lendingVerdict(check, await readLendingFacts(chainId, address, check));
  } catch {
    return null; // fail open
  }
}
