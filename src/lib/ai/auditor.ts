import { ethers } from "ethers";
import { chainTokenByAddress } from "@/constants/tokens";
import {
  findRegisteredLendingAsset,
  getContracts,
  isNativeSentinel,
  registeredLendingAssetAt,
  registeredLendingAssets,
  stableContracts,
  STAKING_CONTRACTS,
  type LendingSide,
  type Protocol,
} from "@/constants/registry";
import { envVars } from "@/constants/envVars";
import { isTradedTier, spacingFor } from "@/lib/dex/liquidity";
import { isKnownBridgeAddress, isKnownBridgeSpender } from "@/lib/bridge/route";
import { valueOf } from "@/lib/points/prices";
import type { IntentKind } from "@/lib/v2/intents/types";
import type { PlanStep } from "./types";
import type { Guardrails } from "./index";

/**
 * The price seam.
 *
 * `valueOf` lives in points/prices for a reason this module does not want to
 * repeat — it is server-only and throws on import in a browser — but importing
 * it directly here would make the auditor's tests depend on a live Pyth feed.
 * A security check whose suite only goes green when an external API is up is a
 * suite that gets skipped. So the default is the real oracle, and a test swaps
 * in a fixed-price table via the same mechanism runReadTool uses for its
 * handlers.
 */
export interface Pricer {
  (
    symbol: string,
    amount: string,
  ): Promise<{
    usd: number | null;
    source: string;
  }>;
}

export const defaultPricer: Pricer = async (symbol, amount) => {
  const { usd, source } = await valueOf(symbol, amount);
  return { usd, source };
};

/**
 * The adversarial auditor: a second pass over a plan the model just produced.
 *
 * This exists because there was a gate and it did not run. The original checks
 * lived in the /chat route *after* the legacy AI-engine fetch, and the
 * provider branch returns before reaching them — so every turn served by
 * AgentRouter, Claude or OpenAI was audited by nothing at all. The system
 * prompt states the user's limits, but a prompt is a request, not a boundary.
 *
 * Three things changed besides where it runs.
 *
 * 1. It audits INTENTS, not prose. The old gate read `result.amount` and
 *    substring-matched `result.target` against protocol names — so "Basement"
 *    passed the Base whitelist, and any plan whose fields were named anything
 *    else passed unexamined. An intent is the exact object the user is asked to
 *    sign, so it is the only thing worth checking.
 * 2. The cap is the USER's, not a hardcoded 1000. useAgentSettings has shipped
 *    `maxPerAction` to this server all along and nothing read it.
 * 3. It fails closed on anything it does not recognise. An unknown intent kind,
 *    an unpriceable-but-capped amount, a token address that resolves to nothing
 *    — each blocks. The failure mode of a security check that guesses is that
 *    it approves.
 *
 * What this is NOT: the security boundary. The user signs every transaction and
 * AgentPermissionFacet enforces its own bounds on-chain. This is the layer that
 * stops a bad plan from ever being presented as reasonable — defence in depth,
 * and the only layer that can see the plan as a whole.
 */

/* Server-only. The auditor decides what a user is asked to sign; a copy running
   in the browser would be a check the checked party can edit. It also reaches
   points/prices, which throws on import client-side for the same reason. */
if (typeof window !== "undefined") {
  throw new Error(
    "[ai/auditor] server-only module imported in the browser. A guardrail " +
      "evaluated client-side is a guardrail the client can remove.",
  );
}

/**
 * The ceiling the client cannot raise.
 *
 * `limits` arrives in the request body, so it is user input in the literal
 * sense: a caller can post `maxPerAction: 1e12` and the user's own setting
 * stops meaning anything. User limits may only ever TIGHTEN what is allowed —
 * this is the number they tighten from, and it is the real replacement for the
 * hardcoded `amount > 1000`.
 */
export const HARD_MAX_NOTIONAL_USD = Number(
  process.env.AGENT_MAX_NOTIONAL_USD || 25_000,
);

/**
 * Which product each intent belongs to, for the user's `allowedActions`.
 *
 * Typed against `IntentKind` rather than `string`, so registering a new intent
 * without deciding which toggle governs it does not compile. The previous
 * `Record<string, string>` silently returned undefined for anything unlisted,
 * which reads as "ungated" — a default that gets less safe every time the
 * intent union grows.
 *
 * The rule for what gets a toggle and what gets `""`:
 *
 *   A toggle gates the steps that put capital at risk in that product. Steps
 *   that only reduce a position, cancel an offer or collect what is already
 *   owed are ungated, so switching a product off can never trap a user inside
 *   one. Refusing to repay a loan because "borrow" is off would leave the debt
 *   standing and the user worse off than if the agent had done nothing.
 *
 * Two consequences worth stating rather than leaving to be discovered:
 *
 *   `provideLiquidity` gates exactly one kind, `mintPoolPosition`, and it is the
 *   newest entry in this table. It gated nothing at all until an opening intent
 *   existed — the other two pool kinds are exits — and the note here used to say
 *   the toggle "becomes load-bearing the day an opening intent exists". That day
 *   is this one: turning the switch off now blocks opening a position while still
 *   allowing a user to collect fees and withdraw from the ones they have, which is
 *   the rule above applied to the pool product.
 *
 *   The kfUSD family has no toggle at all, because useAgentSettings ships five
 *   and none of them is "stablecoin". Mapping them onto a neighbouring toggle
 *   would enforce a setting the user was never shown; they are ungated here and
 *   still bounded by the per-action and daily notional caps below.
 */
const ACTION_OF: Record<IntentKind, string> = {
  swap: "swap",
  stake: "stake",
  /* An approve is not a product; it is the enabling step for one. Gating it on
     its own toggle would let a user disable swaps and still be shown the
     approve that only exists to serve one. The step it precedes carries the
     permission check, and a plan is rejected whole. */
  approve: "",

  /*
   * A send belongs to no product, so there is no toggle that could gate it —
   * the same position the kfUSD family is in, arrived at for a different reason
   * and with a different consequence.
   *
   * kfUSD is ungated because its risk is a position the user can exit. A send
   * is ungated because "wallet" is not one of the five switches useAgentSettings
   * ships, and inventing one here would enforce a setting the user has never
   * been shown while leaving the switch itself unbuilt. Its risk, unlike the
   * kfUSD family's, is total and immediate.
   *
   * So it is bounded by the per-action and daily notional caps and by the
   * recipient rules in AUDITORS — and, unlike every other kind in this table,
   * by nothing on-chain at all. A "wallet" toggle in useAgentSettings is the
   * obvious next tightening; until it exists, saying so here is better than
   * borrowing "swap" and calling it covered.
   */
  transfer: "",

  /*
   * A bridge is a send that crosses a chain, and it is ungated for the same
   * reason: useAgentSettings ships no "wallet" switch, and none of the five it
   * does ship names moving funds off-chain. Borrowing a product toggle here
   * would gate a cross-chain move on, say, "swap" — a setting the user was
   * never shown for this — so it is left ungated and bounded by the caps and by
   * the bridge rule in AUDITORS instead.
   *
   * Its risk is send's, sharpened: the transaction goes to a portal or an
   * aggregator router rather than the diamond, so LibAgentPermission.enforce()
   * never runs and there is no on-chain bound at all — the same place `transfer`
   * lands, reached by a different route.
   */
  bridge: "",

  /* Lending. Collateral is gated with borrowing because that is what it is
     for, and because withdrawing it is the one exit that can move a position
     TOWARD liquidation rather than away from it — the Borrow page remains the
     escape hatch if the toggle is off. */
  depositCollateral: "borrow",
  withdrawCollateral: "borrow",
  createLendingRequest: "borrow",
  borrowFromListing: "borrow",
  createLoanListing: "lend",
  fillRequest: "lend",
  repayLoan: "",
  closeListing: "",
  closeRequest: "",

  /* kfUSD — no corresponding toggle exists. See the note above. */
  mintStable: "",
  redeemStable: "",
  lockStable: "",
  requestStableWithdrawal: "",
  completeStableWithdrawal: "",
  claimStableYield: "",
  compoundStableYield: "",

  /* Both are exits; neither can increase exposure. */
  collectPoolFees: "",
  decreasePoolLiquidity: "",

  /* Opening one is not an exit, and `provideLiquidity` is one of the five
     switches useAgentSettings ships — so unlike every other pool kind here, this
     one has a toggle to answer to. */
  mintPoolPosition: "provideLiquidity",

  /* Delegation is not one of the five product toggles. It is governed by the
     dedicated checks in AUDITORS below — expiry, health floor, notional — and
     by the fact that it is the one intent the user is warned about by name. */
  grantAgentPermission: "",

  /* A receive, and useAgentSettings ships no faucet switch to gate it on. */
  claimTestTokens: "",
  claimAllTestTokens: "",
};

export interface AuditedStep {
  kind: string;
  /** USD notional, or null when the asset has no USD price (e.g. KLD pre-TGE). */
  usd: number | null;
  /** Set when this step alone is what failed. */
  blocked?: string;
  /** Non-fatal, but the user should be told. */
  note?: string;
}

export interface AuditVerdict {
  ok: boolean;
  steps: AuditedStep[];
  /** Human-readable reasons, one per failed check, in plan order. */
  blocked: string[];
  /** Caveats that did not block — an unpriced leg, a cap that could not apply. */
  notes: string[];
  /** Sum of every priced step. Null contributions are excluded, not zeroed. */
  totalUsd: number;
}

/* -------------------------------------------------------------- helpers -- */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * A token address is legitimate only if the registry knows it on THIS chain.
 *
 * This is the check the old destination whitelist was reaching for and could
 * not perform: it compared protocol *names* in free text, where this compares
 * the address the transaction would actually touch. A model that invents a
 * plausible-looking address — the most likely way this goes wrong, since a
 * hallucinated hex string is indistinguishable from a real one by eye — fails
 * here rather than at signing time.
 *
 * Chain-scoped, because an address is a different token on a different chain.
 * An undefined chainId therefore resolves nothing and blocks, which is correct:
 * we cannot validate a destination without knowing which network it is on.
 */
function knownToken(
  chainId: number | undefined,
  address: string,
): { ok: boolean; symbol?: string; decimals?: number } {
  if (!ethers.isAddress(address)) return { ok: false };
  for (const p of ["dex", "lending"] as Protocol[]) {
    if (isNativeSentinel(address, p)) {
      const native = chainTokenByAddress(chainId, address);
      if (native)
        return { ok: true, symbol: native.symbol, decimals: native.decimals };
    }
  }
  const t = chainTokenByAddress(chainId, address);
  return t
    ? { ok: true, symbol: t.symbol, decimals: t.decimals }
    : { ok: false };
}

/**
 * What the lending market on this chain ACCEPTS, on the side being used.
 *
 * Separate from `knownToken` because it answers a different question, against a
 * different table. `TOKENS` is "what assets exist on this chain"; this is "what
 * will this facet not revert on", which is per-chain owner state. Validating a
 * deposit against the chain registry would pass WETH on Ethereum — a real token,
 * on a market that has never heard of it.
 *
 * It used to resolve against `borrowCurrencies`, and the comment here asserted
 * that the facet "accepts exactly the entries borrowCurrencies returns and
 * reverts on anything else". That was false on all five deployed chains, in both
 * directions: kfUSD is in that list and registered nowhere, wrapped native is
 * registered on all five and in that list nowhere, and native is offered as a
 * loan currency everywhere while being loanable nowhere. So this rule passed
 * plans that revert and would have failed valid ones — the audit that exists to
 * stop a bad plan reaching a signature was reading the marketing list.
 *
 * `side` is required because the two mappings are checked by different functions
 * and differ on four of the five chains. See LendingSide in the registry.
 *
 * Three outcomes, not two. `ok: false` is "not accepted, refuse". `ok: true`
 * with decimals is the normal pass. `ok: true` with NO symbol or decimals is a
 * token the market accepts and this registry cannot describe — accepted, because
 * refusing it would contradict the chain, but with nothing for the caller to
 * check the step's own decimals against, so the callers guard on `undefined`
 * rather than comparing against it.
 *
 * Chain-scoped, and an undefined chainId resolves nothing, which fails closed —
 * the correct outcome when we cannot say which network a token belongs to. A
 * chain whose registration was never recorded fails closed the same way: the
 * refusal message says so, because "we don't know" and "not accepted" are
 * different problems with different fixes.
 */
function lendingToken(
  chainId: number | undefined,
  side: LendingSide,
  address: string,
): {
  ok: boolean;
  symbol?: string;
  decimals?: number;
} {
  const { registered, entry } = registeredLendingAssetAt(
    chainId,
    side,
    address,
  );
  if (!registered) return { ok: false };
  return { ok: true, symbol: entry?.symbol, decimals: entry?.decimals };
}

/**
 * The refusal text for a token the market does not accept on that side.
 *
 * Lists what it does accept, so the model's next attempt can succeed, and
 * distinguishes an unrecorded registration from an empty one — a plan refused
 * because our deploy records are incomplete is our bug, and saying "not
 * accepted" would send someone looking in the wrong place.
 */
function notAcceptedMessage(
  chainId: number | undefined,
  side: LendingSide,
  label: string,
  symbolOrAddress: string,
): string {
  const { known, assets, unnamed } = registeredLendingAssets(chainId, side);
  if (!known) {
    return `${label} ${symbolOrAddress}: we have no record of which assets the lending market accepts on this chain, so this can't be verified. Refused rather than sent to a likely revert.`;
  }
  const names = [...assets.map((a) => a.symbol), ...unnamed];
  const verb = side === "loanable" ? "lendable/borrowable" : "collateral";
  return names.length
    ? `${label} ${symbolOrAddress} is not registered as ${verb} on this chain. Registered: ${names.join(", ")}.`
    : `${label} ${symbolOrAddress}: this chain's lending market has no registered assets yet.`;
}

/**
 * What kfUSD accepts as collateral — a THIRD acceptance set, and not the
 * lending market's.
 *
 * kfUSD.sol keeps its own `supportedCollaterals` mapping, checked in `mint` and
 * `redeem`, written by its own admin call. It has nothing to do with the
 * diamond's `s_priceFeeds` or `s_isLoanable`: USDe is in kfUSD's set on every
 * chain that deployed it and is registered on the diamond on none of them,
 * because no chain we deploy to has a USDe price feed.
 *
 * That is why `mintStable` cannot borrow the lending validator. It did, and the
 * result was a plan the builder produced and the auditor blocked: `stableToken`
 * in build.ts accepts USDE and emits the mint, then this rule looked the address
 * up in the lending currency list, found no USDe there, and said "is not
 * accepted as collateral" about a collateral kfUSD does accept. Dead end for the
 * user, with the refusal naming the wrong reason.
 *
 * The three symbols and their decimals mirror `stableToken` in build.ts
 * deliberately — same set, resolved by address instead of by symbol, so the two
 * cannot disagree about what is mintable.
 */
function stableCollateral(
  chainId: number | undefined,
  address: string,
): { ok: boolean; symbol?: string; decimals?: number } {
  const sc = stableContracts(chainId);
  const a = address.toLowerCase();
  const table: Array<[string | undefined, string, number]> = [
    [sc.USDC, "USDC", 6],
    [sc.USDT, "USDT", 6],
    [sc.USDe, "USDe", 18],
  ];
  const hit = table.find(([addr]) => addr && addr.toLowerCase() === a);
  return hit ? { ok: true, symbol: hit[1], decimals: hit[2] } : { ok: false };
}

/**
 * Pins a protocol contract to the address the registry declares for it.
 *
 * Today the builder fills these from the same constant this checks against, so
 * a mismatch means the plan did not come from the builder. That is exactly the
 * case worth failing on — `auditPlan` takes a `PlanStep[]`, not a builder
 * output, so "the only caller is trustworthy" is a property of the current
 * wiring rather than of the function's contract. Stated plainly because the
 * check is tautological on today's single path and would stop being so the
 * moment a second path exists.
 */
function pinned(
  address: string,
  expected: string | undefined,
  label: string,
): string[] {
  /* No configured address means this contract is not deployed on the chain the
     plan targets. Fail closed: a step pinning a contract the registry cannot
     name is a step built against a chain this app does not serve. */
  if (!expected)
    return [`${label} is not configured on the chain this plan targets`];
  if (!ethers.isAddress(address)) return [`${label} is not a valid address`];
  return address.toLowerCase() === expected.toLowerCase()
    ? []
    : [`${label} is not the ${label} this app deploys against`];
}

/** Addresses that must simply be real and not the zero address. */
function requireAddresses(step: PlanStep, ...fields: string[]): string[] {
  const reasons: string[] = [];
  for (const field of fields) {
    const v = str(step[field]);
    if (!ethers.isAddress(v)) reasons.push(`${field} is not a valid address`);
    else if (/^0x0+$/i.test(v)) reasons.push(`${field} is the zero address`);
  }
  return reasons;
}

/**
 * Every contract THIS CHAIN deploys, keyed by lowercase address.
 *
 * Strictly per chain, and that is what separates it from `protocolAddresses`
 * below. Two rules need "is this one of our contracts?" and they need opposite
 * error behaviour from an over-broad answer:
 *
 *  - `approve` pins its spender against this set. Over-broad here is a hole — an
 *    address belonging to another chain's deployment must NOT be accepted, since
 *    that is exactly the mixed-chain plan the pin exists to stop.
 *  - `transfer` refuses a send into `protocolAddresses`. Over-broad there is
 *    safe: refusing to send funds into another chain's diamond costs nothing,
 *    because nobody wants to do that either.
 *
 * Non-address fields the registry carries (oracleKind, poolInitCodeHash) drop out
 * on the isAddress guard rather than being added as junk keys. STAKING_CONTRACTS
 * is folded in because KLD has no ERC20 pre-TGE, so kld/stKLD/kldVault are absent
 * from DEPLOYMENTS and would otherwise be unrecognisable as ours.
 */
function ownContracts(chainId: number | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const add = (label: string, address: string | undefined) => {
    if (address && ethers.isAddress(address))
      out.set(address.toLowerCase(), label);
  };
  for (const [label, address] of Object.entries(getContracts(chainId)))
    add(`the ${label} contract`, address);
  for (const [label, address] of Object.entries(STAKING_CONTRACTS))
    add(`the ${label} contract`, address);
  return out;
}

/**
 * Every contract this deployment owns, keyed by lowercase address.
 *
 * One rule uses it — `transfer` — and only to refuse. A plain send into any of
 * these is an unrecoverable loss: none of them has a sweep, a rescue call or a
 * `receive()` that credits the sender for a balance which arrived outside the
 * call that was meant to bring it. The funds sit there owned by a contract with
 * no code path that will ever move them again.
 *
 * Read from the registry and envVars rather than written out, so a redeploy that
 * moves an address cannot silently empty the set. Unset env vars and malformed
 * values are dropped instead of being allowed through as the string
 * "undefined" — an entry that matches nothing while reading as though it were
 * checked is the failure mode this whole file is written against.
 *
 * The envVars entries are deliberately NOT chain-scoped and are only sound here
 * because this set is used to refuse. Do not reuse it to authorise anything —
 * `ownContracts` is the per-chain set for that.
 *
 * Built per call rather than at import. The cost is twenty string compares on a
 * step that is about to make a price call anyway, and it buys independence from
 * import order: auditor.test.ts sets its env vars before dynamically importing
 * this module precisely because module-level reads would otherwise miss them.
 */
function protocolAddresses(chainId: number | undefined): Map<string, string> {
  const out = ownContracts(chainId);
  const add = (label: string, address: string | undefined) => {
    if (address && ethers.isAddress(address))
      out.set(address.toLowerCase(), label);
  };

  add("the Kaleido diamond", envVars.lendbitDiamondAddress);
  add("the KLD vault", envVars.vaultAddress);
  add("the token faucet", envVars.faucetAddress);
  add("the MasterChef contract", envVars.masterChefAddress);
  add("the protocol contract", envVars.protocolAddress);

  return out;
}

/**
 * The recipient of a send: the one address in this system a model supplies.
 *
 * Everything else an intent addresses is filled in server-side from the registry
 * for exactly that reason, and the checks below are what stands in for the
 * registry lookup that cannot exist here — there is no table of the user's
 * counterparties to validate against. So this proves the negatives instead: not
 * a burn, not a sentinel, not one of our own contracts, not a token.
 *
 * What it cannot prove is the only thing that ultimately matters — that this is
 * the address the user meant. Hence the note the rule attaches.
 */
function recipientReasons(
  to: string,
  tokenAddress: string,
  chainId: number | undefined,
): string[] {
  /*
   * getAddress, not isAddress, and the difference is the point: ethers asserts
   * the EIP-55 checksum only for MIXED-case input (address.js:118), so this
   * catches a mistyped digit in `0xAbC…` and cannot catch one in `0xabc…` —
   * a lowercased address is a valid address with no checksum left to verify.
   * That is why the typed path preserves the case the user typed all the way
   * from the parser (see detectRecipient in fromCommand.ts) rather than relying
   * on a downstream check like this one.
   *
   * Tautological on today's only path, where build.ts has already run
   * getAddress and written back its checksummed output — and kept anyway, for
   * the reason `pinned` above states: auditPlan takes a PlanStep[], not a
   * builder result, so "the caller is trustworthy" is a fact about the current
   * wiring rather than a property of this function.
   */
  let recipient: string;
  try {
    recipient = ethers.getAddress(to);
  } catch {
    /* Returned alone. Every check below compares against this address, so
       reporting five consequences of one unusable field is noise. */
    return [`recipient ${to || "(none)"} is not a valid address`];
  }

  const reasons: string[] = [];
  const lower = recipient.toLowerCase();

  if (/^0x0+$/i.test(recipient))
    reasons.push("recipient is the zero address — the funds would be burned");

  /* Neither sentinel is a wallet. ADDRESS_1 is also the ecrecover precompile,
     so a send there is not merely lost, it is lost to something that will
     never have an owner. */
  for (const p of ["dex", "lending"] as Protocol[]) {
    if (isNativeSentinel(recipient, p)) {
      reasons.push(
        `recipient is the ${p} native-currency sentinel, which is a protocol convention and not an account`,
      );
      break;
    }
  }

  /* The token's own contract. Checked before the general token check below so
     the message names the specific mistake — pasting the token address into the
     recipient field is the commonest way this goes wrong. */
  if (tokenAddress && lower === tokenAddress.toLowerCase())
    reasons.push(
      "recipient is the token's own contract, so the tokens would be burned",
    );
  else {
    const asToken = chainTokenByAddress(chainId, recipient);
    if (asToken)
      reasons.push(
        `recipient is the ${asToken.symbol} token contract, not a wallet`,
      );
  }

  const ours = protocolAddresses(chainId).get(lower);
  if (ours)
    reasons.push(
      `recipient is ${ours} — it has no way to return funds sent to it directly`,
    );

  return reasons;
}

/**
 * Base units, as a string of digits.
 *
 * `repayLoan` and `decreasePoolLiquidity` carry raw contract figures, not human
 * amounts, and the distinction is load-bearing: a repayment rounded to a human
 * number underpays and leaves the loan open. Parsing with `num` would accept
 * "1e18" and "1.5", both of which are wrong shapes for a uint256 argument.
 */
function rawUnits(v: unknown): string | null {
  const s = str(v);
  return /^\d+$/.test(s) && BigInt(s) > BigInt(0) ? s : null;
}

/** A whole-number id, as the contracts index them. */
function idOf(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * A unix-seconds deadline that has not passed and is not absurd.
 *
 * The upper bound catches the unit error this field invites: a millisecond
 * timestamp is ~1000× too large and lands somewhere past the year 50000, which
 * a contract will happily store as a loan that never matures.
 */
const TEN_YEARS_SEC = 10 * 365 * 86_400;
function futureUnix(v: unknown, label: string): string[] {
  const t = num(v);
  const now = Math.floor(Date.now() / 1000);
  if (t === null) return [`${label} is missing`];
  if (t <= now) return [`${label} is in the past`];
  if (t > now + TEN_YEARS_SEC)
    return [`${label} is over ten years out — check the units`];
  return [];
}

/**
 * A whole-percent interest rate, per the contract's formatInterestRate.
 *
 * The ceiling is a unit-error guard, not a policy cap: a model that means 5 and
 * emits 500 produces a loan nobody would knowingly sign, and the two are
 * indistinguishable by shape. A user who genuinely wants a three-digit rate can
 * still post it from the Borrow page.
 */
function interestReasons(v: unknown): string[] {
  const pct = num(v);
  if (pct === null) return ["interest rate is missing"];
  if (pct < 0) return ["interest rate is negative"];
  if (pct > 100) return [`interest rate of ${pct}% looks like a unit error`];
  return [];
}

/** A positive human amount, or null. */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * The Diamond every lending and delegation step is sent to.
 *
 * Pinned to the REGISTRY's diamond for the chain the plan targets, falling back
 * to `envVars.lendbitDiamondAddress` only where the registry has none.
 *
 * The order matters and used to be the other way round. The env var is a single
 * `NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS` for every chain — the same defect that
 * retired NEXT_PUBLIC_TOKENFAUCET_ADDRESS — and the five deployed testnets have
 * five distinct diamonds. Pinning against it therefore did the opposite of its
 * job on four chains out of five: it would reject a step carrying the CORRECT
 * diamond for the wallet's chain because that address is not the one global
 * value. The fallback is kept because a chain absent from DEPLOYMENTS still
 * deserves the shape check the env var can give it.
 *
 * Not fail-closed when neither is known, because that is a separate failure with
 * a clearer message: the builder writes `undefined` into the field and
 * `requireAddresses` reports the field, rather than this reporting a mismatch
 * against nothing.
 */
function diamondReasons(step: PlanStep, chainId: number | undefined): string[] {
  const reasons = requireAddresses(step, "diamond");
  const expected =
    getContracts(chainId).diamond ?? envVars.lendbitDiamondAddress;
  if (reasons.length === 0 && expected) {
    return pinned(str(step.diamond), expected, "diamond");
  }
  return reasons;
}

/**
 * The V3 router an `approve` authorises and a `swap` calls.
 *
 * This did not exist, and its absence was the one place the auditor let a
 * mixed-chain plan through rather than blocking it. Measured before the fix: a
 * swap on Base Sepolia passed with Base's USDC, Base's WETH and *Sepolia's*
 * router as the approve spender, because the `swap` rule checked only the tokens
 * and the `approve` rule reasoned it could do no better than a shape check —
 * "DEPLOYMENTS is still empty", true when that comment was written and false
 * now that the registry carries a distinct router for all five chains.
 *
 * The spender is the address that gains the right to move the user's funds, so a
 * wrong one is not a reverted transaction — the approve SUCCEEDS, because
 * granting an allowance is an ERC20 storage write that never touches the
 * spender. The user ends up with a standing allowance to an address they never
 * chose, and only the swap after it fails. That is why this is pinned to an
 * address rather than shape-checked.
 *
 * Absent from the registry means no V3 router on the chain this plan targets, so
 * a swap there cannot be honoured by anything: fail closed via `pinned`.
 */
function routerReasons(step: PlanStep, chainId: number | undefined): string[] {
  const reasons = requireAddresses(step, "spender");
  if (reasons.length > 0) return reasons;
  return pinned(str(step.spender), getContracts(chainId).v3Router, "spender");
}

/**
 * The spender an `approve` authorises — any of THIS chain's own contracts, plus
 * the one vetted bridge router.
 *
 * Pinned to a set rather than to one address, and that breadth is measured
 * rather than conceded. `approve` precedes four different products: a swap
 * approves the V3 router, depositCollateral approves the diamond, mintStable
 * approves the kfUSD minter, stake approves the KLD vault. Pinning it to
 * `v3Router` alone — which is what this replaced — blocked `deposit` on four
 * chains and `mint` on all five, with "spender is not the spender this app
 * deploys against" against the diamond we ourselves deployed. That fix for the
 * mixed-chain swap was correct about the danger and wrong about the pin: it
 * assumed the only thing an approve precedes is a swap.
 *
 * The narrow pin stays where it belongs. `swap` still checks its own `spender`
 * through `routerReasons`, so an approve/swap pair can only be honoured if the
 * swap leg names the router exactly — this rule widens what an approve may
 * authorise, it does not widen what a swap may call.
 *
 * `ownContracts` and not `protocolAddresses`, because this rule AUTHORISES. The
 * latter folds in chain-blind env vars, and accepting one of those here would
 * re-open the exact hole: `NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS` holds Sepolia's
 * diamond, so a BSC plan approving it would pass while granting an allowance to
 * an address holding no code on the user's chain.
 *
 * THE ONE ADDRESS HERE THAT IS NOT OURS is the bridge router, and it is the
 * loosening an ERC20 bridge needed: a token leg has to approve the provider's
 * router, which no Kaleido deployment contains. It is admitted through
 * `isKnownBridgeSpender` — one fixed address, the same table the resolver built
 * the step from, read by both for the reason the canonical `to` check exists.
 * What that gives up is stated rather than buried: the address is chain-blind
 * (LI.FI deploys the same one everywhere, so there is no per-chain fact to
 * check), and it is admitted for ANY approve rather than only one paired with a
 * bridge, because these rules see one step at a time. The residual is an
 * allowance to one widely-used contract, bounded by the per-action cap — and the
 * `bridge` rule holds the part this cannot: that the router being approved is
 * the router the transaction actually calls.
 *
 * Returns a note when it admits one, because an approve to a third party is not
 * the same thing as an approve to our own diamond and must not read as one.
 *
 * Fails closed on an empty set. A chain with no contracts recorded cannot have a
 * legitimate spender, and "cannot be checked" is the honest reason rather than
 * silently approving.
 */
function spenderReasons(
  step: PlanStep,
  chainId: number | undefined,
): { reasons: string[]; note?: string } {
  const reasons = requireAddresses(step, "spender");
  if (reasons.length > 0) return { reasons };

  const spender = str(step.spender);
  const ours = ownContracts(chainId);
  if (ours.size === 0)
    return {
      reasons: [
        `spender cannot be verified: no Kaleido contracts are recorded on chain ${chainId ?? "(none)"}`,
      ],
    };

  if (ours.get(spender.toLowerCase())) return { reasons: [] };
  if (isKnownBridgeSpender(spender))
    return {
      reasons: [],
      note: "this approves a bridge provider's router, not a Kaleido contract — it is the one outside address this app authorises, and only a bridge step should be pairing it",
    };

  return {
    reasons: [
      "spender is not a Kaleido contract on the chain this plan targets",
    ],
  };
}

/** Spread-ready `priced`, so the rules below stay one expression each. */
function priceIf(
  symbol: string | undefined,
  amount: number | null,
): Pick<Shape, "priced"> {
  return symbol && amount !== null
    ? { priced: { symbol, amount: String(amount) } }
    : {};
}

/**
 * Per-kind structural rules.
 *
 * `intentsFromChat` validates only that `kind` is registered, so a step can
 * reach a resolver with its other fields missing entirely — and the tool
 * catalog makes that concrete rather than theoretical: the `swap` tool asks the
 * model for five fields, while the `swap` Intent needs nine. `amountOutMin`,
 * `fee` and both decimals are never emitted. A swap carrying no `amountOutMin`
 * is a swap with no slippage floor, which is the single most expensive shape a
 * plan can have and the one a sandwich bot is looking for.
 *
 * So each rule returns the reasons a step is unsafe, and the amount to price.
 * Returning `[]` means structurally sound, not "safe" — the caps run after.
 */
interface Shape {
  /** Blocking reasons; empty when the step is well-formed. */
  reasons: string[];
  /**
   * Caveats that do not block, for checks this table knows it cannot make.
   *
   * The file's existing doctrine, applied to the rules themselves: an unchecked
   * step must never be silently indistinguishable from a checked one. A
   * collateral withdrawal is the case that needs it — it lowers health factor,
   * and `minHealthFactor` cannot be evaluated without reading the position,
   * which these synchronous rules deliberately cannot do.
   */
  notes?: string[];
  /** What to value in USD, when there is something to value. */
  priced?: { symbol: string; amount: string };
  /**
   * Further legs of the same step, valued alongside `priced`.
   *
   * Exists for `mintPoolPosition`, the one kind that moves two different tokens
   * out of the wallet in a single transaction. Pricing only the first leg would
   * have left the second outside the per-action cap entirely — a $100 limit would
   * pass a position that deposits $99 of USDC and any amount of WETH beside it —
   * and pricing the larger of the two is not available to these rules, which are
   * synchronous and cannot reach an oracle. So every leg is declared and the
   * caller sums them.
   */
  pricedAlso?: { symbol: string; amount: string }[];
  /**
   * A swap's two legs, for the market-rate check in `auditPlan`.
   *
   * Separate from `priced` because that check needs a price for BOTH sides and
   * these rules are synchronous — no rule in this table can reach an oracle, by
   * design, so that they stay unit-testable without a network.
   */
  swap?: {
    inSymbol: string;
    outSymbol: string;
    amountIn: number;
    minOut: number;
  };
}

type Auditor = (
  step: PlanStep,
  chainId: number | undefined,
  limits: Guardrails,
) => Shape;

/**
 * Keyed by `IntentKind`, so a new intent without a rule does not compile.
 *
 * This replaces a membership test against `EXECUTE_TOOLS` that had quietly
 * stopped meaning anything. That set holds tool names, and tool names used to
 * equal intent kinds because providers spread a tool call straight into
 * `{kind: toolName, ...args}`. Once tools became thin verbs and the builder
 * started producing intents, the two vocabularies diverged — `deposit` the verb
 * builds `depositCollateral` the intent — and a set of verbs checked against a
 * kind matched only the four names that happen to coincide. Fail-closed, so the
 * symptom was a refusal rather than a hole, but it refused nearly everything.
 *
 * The type is the fix, not another set: the reason to consult a second table was
 * to catch a kind with no rule, and a total record cannot have one.
 */
const AUDITORS: Record<IntentKind, Auditor> = {
  swap: (s, chainId, limits) => {
    const reasons: string[] = [];
    const tokenIn = str(s.tokenIn);
    const tokenOut = str(s.tokenOut);
    const inTok = knownToken(chainId, tokenIn);
    const outTok = knownToken(chainId, tokenOut);

    if (!inTok.ok)
      reasons.push(`unrecognised input token ${tokenIn || "(none)"}`);
    if (!outTok.ok)
      reasons.push(`unrecognised output token ${tokenOut || "(none)"}`);
    if (tokenIn && tokenIn.toLowerCase() === tokenOut.toLowerCase())
      reasons.push("input and output token are the same");

    const amountIn = num(s.amountIn);
    if (amountIn === null || amountIn <= 0)
      reasons.push("swap amount is missing or not positive");

    /* The slippage floor. Absent means unbounded, so this is a block and not a
       default: silently filling in a floor would put a number the user never
       chose onto a transaction they are about to sign. */
    const minOut = num(s.amountOutMin);
    if (minOut === null)
      reasons.push(
        "no minimum output — the swap would execute at any price. Slippage protection is required.",
      );

    /* Decimals are declared data. A missing value is not a cosmetic gap: USDC
       at 6 read as 18 misprices by 10^12, and the resolver parses with it. */
    if (num(s.decimalsIn) === null || num(s.decimalsOut) === null)
      reasons.push(
        "token decimals are missing, so the amount cannot be parsed",
      );

    if (num(s.fee) === null) reasons.push("no pool fee tier");

    /* The router this swap is sent to, pinned to the chain the plan targets.
       Nothing checked it before, which is how a plan carrying Base's tokens and
       Sepolia's router passed: the token rules above are chain-scoped and were
       both satisfied, and no rule looked at the contract in between. The swap
       and the approve before it carry the same `spender` by construction
       (build.ts uses one variable for both), so pinning it in both places is not
       redundant — a plan can contain either step alone. */
    reasons.push(...routerReasons(s, chainId));

    return {
      reasons,
      ...(inTok.ok && amountIn !== null && amountIn > 0
        ? { priced: { symbol: inTok.symbol!, amount: String(amountIn) } }
        : {}),
      /* Handed up for the slippage check, which needs both sides priced and so
         cannot run here. Only when the step is otherwise sound — checking the
         rate on a malformed swap would report a second failure caused by the
         first. */
      ...(reasons.length === 0 &&
      inTok.ok &&
      outTok.ok &&
      amountIn !== null &&
      minOut !== null
        ? {
            swap: {
              inSymbol: inTok.symbol!,
              outSymbol: outTok.symbol!,
              amountIn,
              minOut,
            },
          }
        : {}),
    };
  },

  approve: (s, chainId) => {
    const reasons: string[] = [];
    const token = str(s.token);
    const tok = knownToken(chainId, token);
    if (!tok.ok) reasons.push(`unrecognised token ${token || "(none)"}`);

    /* The spender is the address that gains the right to move the user's funds,
       so it is pinned to the set of contracts THIS chain deploys rather than
       merely shape-checked. This used to say "DEPLOYMENTS is still empty, so the
       strongest available check is that it is a real address" — true then, and
       the reason a Base Sepolia swap could be approved against Sepolia's router.

       Pinned to the set and not to `v3Router`: an approve precedes four
       different products, so a single-address pin here blocked `deposit` on four
       chains and `mint` on all five against our own diamond. The paired step
       still pins its own address narrowly — a swap must name the router, a
       bridge must name the router it calls — so nothing is loosened about what
       the allowance is then used for.

       An approve is the step where a wrong spender does lasting damage, because
       it succeeds regardless: the allowance is written to the token, which never
       calls the spender to find out if it exists. */
    const spender = spenderReasons(s, chainId);
    reasons.push(...spender.reasons);

    const amount = num(s.amount);
    if (amount === null || amount <= 0)
      reasons.push("approval amount is missing or not positive");
    if (num(s.decimals) === null) reasons.push("token decimals are missing");

    return {
      reasons,
      ...(spender.note ? { notes: [spender.note] } : {}),
      ...(tok.ok && amount !== null && amount > 0
        ? { priced: { symbol: tok.symbol!, amount: String(amount) } }
        : {}),
    };
  },

  stake: (s, chainId) => {
    const reasons: string[] = [];
    const token = str(s.token);
    const tok = knownToken(chainId, token);
    if (!tok.ok) reasons.push(`unrecognised token ${token || "(none)"}`);
    for (const field of ["vault", "stToken"]) {
      if (!ethers.isAddress(str(s[field])))
        reasons.push(`${field} is not a valid address`);
    }
    const amount = num(s.amount);
    if (amount === null || amount <= 0)
      reasons.push("stake amount is missing or not positive");

    return {
      reasons,
      ...(tok.ok && amount !== null && amount > 0
        ? { priced: { symbol: tok.symbol!, amount: String(amount) } }
        : {}),
    };
  },

  /* --------------------------------------------------------------- send -- */
  /**
   * A plain wallet-to-wallet send — the strictest rule here, not the simplest.
   *
   * Every other step in this table calls a contract that validates its own
   * arguments: a wrong token reverts, a wrong id reverts, an unhealthy
   * withdrawal reverts. This one has no contract on the far side. A transfer to
   * a well-formed wrong address succeeds, and that is the end of it.
   *
   * It is also the one kind here that no on-chain bound covers.
   * LibAgentPermission.enforce() runs inside diamond calls and this transaction
   * never enters the diamond (see the transfer section of intents/types.ts), so
   * where the caps below are normally a first line in front of an on-chain
   * second one, here they are the only line.
   */
  transfer: (s, chainId) => {
    const reasons: string[] = [];
    const token = str(s.token);
    const tok = knownToken(chainId, token);
    if (!tok.ok) reasons.push(`unrecognised token ${token || "(none)"}`);

    const amount = positive(s.amount);
    if (amount === null) reasons.push("send amount is missing or not positive");

    /* Compared against the registry's figure, not merely checked for presence.
       Decimals decide how much leaves the wallet and there is no callee to
       reject a misparse: USDC declared at 18 asks for 10^12 times the intended
       amount, which reverts on a small balance and does not on a large one. */
    const decimals = num(s.decimals);
    if (decimals === null) reasons.push("token decimals are missing");
    else if (tok.ok && decimals !== tok.decimals)
      reasons.push(
        `decimals say ${decimals} but ${tok.symbol} has ${tok.decimals}`,
      );

    /*
     * `isNative` picks the resolver's branch — a bare value transaction, or a
     * call to the token's own transfer(). Either sentinel counts, matching what
     * the builder sets: a send is not a protocol call, so neither convention is
     * "the" native address for it (registry rule 3).
     *
     * Stricter than the lending rules deliberately. They tolerate an omitted
     * flag because the facet rejects the mismatch on-chain; here an omitted
     * flag on a native token would send calldata to a sentinel address, so
     * absence is a defect rather than a default.
     */
    const wantsNative =
      isNativeSentinel(token, "dex") || isNativeSentinel(token, "lending");
    if (Boolean(s.isNative) !== wantsNative)
      reasons.push(
        wantsNative
          ? "isNative is not set on a native-currency send"
          : "isNative is set on a token that is not the native currency",
      );

    reasons.push(...recipientReasons(str(s.to), token, chainId));

    /* The check nothing can make: whether this is the address the user meant.
       Said out loud, because the coverage gap is the whole risk of this kind —
       and per this file's own doctrine an unchecked step must never read as an
       equally-checked one. */
    const notes =
      reasons.length === 0
        ? [
            "a send cannot be reversed and no on-chain permission bounds it, so the address is worth reading character by character",
          ]
        : [];

    return { reasons, notes, ...priceIf(tok.symbol, amount) };
  },

  /* -------------------------------------------------------------- bridge -- */
  /**
   * A cross-chain move, and send's sibling here for the reason it is one in
   * ACTION_OF: the transaction goes to a portal or an aggregator router, never
   * the diamond, so LibAgentPermission.enforce() cannot bound it and the caps
   * plus this rule are the only line.
   *
   * `to`/`data`/`value` come from a trusted resolver rather than the model — but
   * auditPlan takes a PlanStep[], not a builder result, so that trust is a fact
   * about the current wiring, not something provable here (the caveat `pinned`
   * and `recipientReasons` also carry). So this re-checks what it can: a
   * canonical `to` against the very table the resolver built it from, the value
   * riding the transaction against the amount shown on the row, and the notional
   * against the cap. `to` is a router, not a recipient, so recipientReasons —
   * which would refuse a legitimate contract target — is deliberately not used.
   *
   * Native and ERC20, and they are audited differently on purpose. A native
   * bridge's `value` IS the amount, so the two can be tied together. A token
   * bridge's amount rides in the provider's calldata, which this rule does not
   * parse — so what bounds it is the paired approve, and what this rule can hold
   * is that the allowance goes to the contract the transaction calls. Both facts
   * are said out loud in `notes` rather than implied by a pass.
   */
  bridge: (s, chainId) => {
    const reasons: string[] = [];
    const token = str(s.token);
    const tok = knownToken(chainId, token);
    if (!tok.ok) reasons.push(`unrecognised token ${token || "(none)"}`);

    const amount = positive(s.amount);
    if (amount === null)
      reasons.push("bridge amount is missing or not positive");

    const decimals = num(s.decimals);
    if (decimals === null) reasons.push("token decimals are missing");
    else if (tok.ok && decimals !== tok.decimals)
      reasons.push(
        `decimals say ${decimals} but ${tok.symbol} has ${tok.decimals}`,
      );

    /* Strict about the flag for send's reason: an unset flag on a native token
       would send calldata to a sentinel address, and a set one on an ERC20 would
       attach the amount as value to a router expecting an allowance. Either
       sentinel counts — a bridge is not a protocol call. */
    const wantsNative =
      isNativeSentinel(token, "dex") || isNativeSentinel(token, "lending");
    if (Boolean(s.isNative) !== wantsNative)
      reasons.push(
        wantsNative
          ? "isNative is not set on a native-currency bridge"
          : "isNative is set on a token that is not the native currency",
      );

    /* Source must be the chain the plan is signed on; destination a different,
       real chain. A source mismatch means the route was built for a chain the
       wallet is not connected to. */
    const fromChainId = num(s.fromChainId);
    const toChainId = num(s.toChainId);
    if (fromChainId === null)
      reasons.push("the bridge is missing its source chain");
    else if (chainId !== undefined && fromChainId !== chainId)
      reasons.push("the bridge's source chain is not the connected chain");
    if (toChainId === null || toChainId <= 0)
      reasons.push("the bridge is missing its destination chain");
    else if (fromChainId !== null && toChainId === fromChainId)
      reasons.push("the source and destination chains are the same");

    /* `to` must be a real address always; how it is trusted turns on provider. */
    reasons.push(...requireAddresses(s, "to"));
    const provider = str(s.provider);
    if (provider === "canonical") {
      /* Re-checked against the same constant table route.ts built it from — the
         one provider whose target is fixed and therefore allow-listable. A miss
         means the `to` did not come from the resolver. */
      if (fromChainId !== null && !isKnownBridgeAddress(fromChainId, str(s.to)))
        reasons.push(
          "the canonical bridge address is not one recognised on the source chain",
        );
      /* The canonical corridors are ETH deposits through an L1StandardBridge.
         `depositERC20To` needs the destination token to be the mintable
         representation the factory paired with the L1 token, which none of our
         deployments are — so a canonical token deposit is not a policy refusal
         but an unrecoverable one, and the resolver never builds it. */
      if (!wantsNative)
        reasons.push(
          "a canonical portal deposit is native-currency only — this corridor cannot carry a token",
        );
    } else if (provider !== "lifi" && provider !== "relay") {
      /* Fail closed: a canonical target is allow-listed and an aggregator's is
         bounded by the cap, so anything else is neither and is refused. */
      reasons.push(`unrecognised bridge provider "${provider || "(none)"}"`);
    }

    /* The value that actually leaves the wallet, against the amount on the row.
       For a native bridge the resolver derives both from one number —
       identically for a canonical deposit — so a gap past rounding means the row
       misstates what is sent. Priced by the human amount below, which this ties
       to the value.

       A token bridge must attach nothing: its amount moves by allowance, and a
       native fee riding alongside would be a second charge in a row shaped to
       show one. The resolver refuses such a route; this refuses it again. */
    const value = rawUnits(s.value);
    if (!wantsNative) {
      if (str(s.value) !== "0")
        reasons.push(
          "a token bridge must attach no native value, and this one does",
        );
    } else if (value === null)
      reasons.push("the amount to send is not a positive base-unit figure");
    else if (amount !== null && decimals !== null && decimals >= 0) {
      const sending = Number(ethers.formatUnits(value, decimals));
      if (sending > 0 && Math.abs(sending - amount) / sending > 0.01)
        reasons.push(`the row shows ${amount} but ${sending} is being sent`);
    }

    /* The ERC20 leg's allowance target.
       Two checks, and the second is the one that matters. `isKnownBridgeSpender`
       is the same allowlist the approve rule admits this address through, read
       here as well so builder and auditor cannot drift. Then: it must be the
       address this transaction CALLS. That is what the approve rule structurally
       cannot know — it sees one step — and without it a plan could grant an
       allowance to the vetted router while sending its calldata somewhere else,
       or the reverse. */
    if (!wantsNative) {
      const spender = str(s.spender);
      if (!spender)
        reasons.push("a token bridge is missing its router to approve");
      else if (!isKnownBridgeSpender(spender))
        reasons.push(
          "the bridge router being approved is not one this app recognises",
        );
      else if (spender.toLowerCase() !== str(s.to).toLowerCase())
        reasons.push(
          "the router being approved is not the contract this bridge calls",
        );
    }

    /* Like send, the checks nothing here can make: that this is the chain and
       asset the user meant, on a transaction no on-chain permission bounds — and
       for a token, that the amount inside the provider's calldata is the amount
       on the row. The approve caps it at the row's amount, which is a real bound
       and not the same as having read the number. */
    const notes: string[] = [];
    if (reasons.length === 0) {
      notes.push(
        "a bridge leaves this chain and no on-chain permission bounds it, so the destination chain and amount are worth confirming",
      );
      if (!wantsNative)
        notes.push(
          `the amount is inside the provider's calldata, which this check does not read — the paired approval is what limits it to ${amount} ${tok.symbol ?? str(s.symbol)}`,
        );
    }

    return { reasons, notes, ...priceIf(tok.symbol, amount) };
  },

  /* ------------------------------------------------------------ lending -- */

  /*
   * The five token-carrying lending rules validate against what the market on
   * this chain is REGISTERED to accept, on the side that step uses — not against
   * the chain registry, and no longer against the offered currency list. A token
   * that is real on this chain but unregistered on the market is precisely the
   * plan worth refusing before it is signed; and the two sides are different
   * mappings, so a token can be depositable and not borrowable. See lendingToken.
   *
   * The sides come from ProtocolFacet, not from a naming convention:
   * depositCollateral and withdrawCollateral carry `_isTokenAllowed`
   * (`s_priceFeeds[token] != 0`), createLendingRequest and createLoanListing
   * check `s_isLoanable`. repayLoan is gated on neither and is not checked here.
   */

  depositCollateral: (s, chainId) => {
    const tok = lendingToken(chainId, "collateral", str(s.token));
    const amount = positive(s.amount);
    const reasons = [
      ...diamondReasons(s, chainId),
      ...(tok.ok
        ? []
        : [
            notAcceptedMessage(
              chainId,
              "collateral",
              "deposit token",
              str(s.token) || "(no token)",
            ),
          ]),
      ...(amount === null ? ["deposit amount is missing or not positive"] : []),
      ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
    ];

    /* Declared decimals against the registry's. The builder reads both from the
       same row, so a disagreement means the step was assembled elsewhere — and
       the consequence is a 10^12 misparse on USDC, which is worth a block
       rather than a note.

       Guarded on `tok.decimals !== undefined` as well as `tok.ok`, because those
       are now two different things: a registered token this registry cannot name
       passes `ok` with no decimals, and `!== undefined` would otherwise compare
       the step's 6 against undefined and block a correct plan. Nothing to check
       against is not a disagreement. */
    if (
      tok.ok &&
      tok.decimals !== undefined &&
      num(s.decimals) !== null &&
      num(s.decimals) !== tok.decimals
    )
      reasons.push(
        `decimals say ${num(s.decimals)} but ${tok.symbol} has ${tok.decimals}`,
      );

    /* `isNative` decides whether the resolver sends `value` or calls
       transferFrom. Wrong either way is a failed or misdirected transaction:
       ETH sent as an ERC20 approves a non-token, and a token sent as value
       arrives with no accounting. */
    const wantsNative = isNativeSentinel(str(s.token), "lending");
    if (s.isNative !== undefined && Boolean(s.isNative) !== wantsNative)
      reasons.push("isNative does not match the token");

    return { reasons, ...priceIf(tok.symbol, amount) };
  },

  withdrawCollateral: (s, chainId, limits) => {
    const tok = lendingToken(chainId, "collateral", str(s.token));
    const amount = positive(s.amount);
    const reasons = [
      ...diamondReasons(s, chainId),
      ...(tok.ok
        ? []
        : [
            notAcceptedMessage(
              chainId,
              "collateral",
              "withdraw token",
              str(s.token) || "(no token)",
            ),
          ]),
      ...(amount === null
        ? ["withdraw amount is missing or not positive"]
        : []),
      ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
    ];

    /* The one step in the lending family that can move a position toward
       liquidation. The health floor is the user's stated limit and this rule
       cannot read a position to apply it, so it is surfaced rather than
       enforced — and enforced on-chain by AgentPermissionFacet's own floor. */
    const notes =
      reasons.length === 0 && limits.minHealthFactor !== undefined
        ? [
            `withdrawing collateral lowers your health factor; your ${limits.minHealthFactor} floor is enforced on-chain, not here`,
          ]
        : [];

    return { reasons, notes, ...priceIf(tok.symbol, amount) };
  },

  repayLoan: (s, chainId) => {
    const raw = rawUnits(s.amountRaw);
    const reasons = [
      ...diamondReasons(s, chainId),
      ...(idOf(s.requestId) === null ? ["request id is missing"] : []),
      /* Base units, and the whole figure. The contract takes the raw total
         repayment; a human-rounded amount underpays and leaves the loan open,
         which is the failure this field's existence is designed to prevent. */
      ...(raw === null
        ? ["repayment amount is not a positive base-unit figure"]
        : []),
    ];

    /* Priced from the human mirror when it agrees with the raw figure. The two
       are one number in two units, so a disagreement is a bug on whichever side
       is displayed — and the displayed one is what the user reads before
       signing.

       Loanable side, because that is the only side a loan's principal can have
       come from. `repayLoan` itself is ungated on-chain, so this resolves
       decimals and never refuses: an unresolvable symbol skips the cross-check
       rather than blocking a repayment. */
    const symbol = str(s.symbol);
    const human = positive(s.amount);
    const decimals = findRegisteredLendingAsset(
      chainId,
      "loanable",
      symbol,
    )?.decimals;
    if (raw !== null && human !== null && decimals !== undefined) {
      const fromRaw = Number(ethers.formatUnits(raw, decimals));
      if (fromRaw > 0 && Math.abs(fromRaw - human) / fromRaw > 0.01)
        reasons.push(
          `displayed amount ${human} ${symbol} does not match the ${fromRaw} being repaid`,
        );
    }

    return { reasons, ...priceIf(symbol || undefined, human) };
  },

  createLendingRequest: (s, chainId) => {
    const tok = lendingToken(chainId, "loanable", str(s.token));
    const amount = positive(s.amount);
    return {
      reasons: [
        ...diamondReasons(s, chainId),
        ...(tok.ok
          ? []
          : [
              notAcceptedMessage(
                chainId,
                "loanable",
                "borrow token",
                str(s.token) || "(no token)",
              ),
            ]),
        ...(amount === null
          ? ["borrow amount is missing or not positive"]
          : []),
        ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
        ...interestReasons(s.interestPct),
        ...futureUnix(s.returnDate, "return date"),
      ],
      ...priceIf(tok.symbol, amount),
    };
  },

  createLoanListing: (s, chainId) => {
    const tok = lendingToken(chainId, "loanable", str(s.token));
    const amount = positive(s.amount);
    const min = positive(s.minAmount);
    const max = positive(s.maxAmount);
    const reasons = [
      ...diamondReasons(s, chainId),
      ...(tok.ok
        ? []
        : [
            notAcceptedMessage(
              chainId,
              "loanable",
              "listing token",
              str(s.token) || "(no token)",
            ),
          ]),
      ...(amount === null ? ["listing amount is missing or not positive"] : []),
      ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
      ...interestReasons(s.interestPct),
      ...futureUnix(s.returnDate, "return date"),
    ];

    /* The draw-size window. Inverted or out-of-range bounds are how a listing
       ends up undrawable — or drawable for more than was offered. */
    if (min === null || max === null)
      reasons.push("listing needs both a minimum and a maximum draw");
    else {
      if (min > max) reasons.push("minimum draw is above the maximum");
      if (amount !== null && max > amount)
        reasons.push("maximum draw is more than the amount being lent");
    }

    return { reasons, ...priceIf(tok.symbol, amount) };
  },

  borrowFromListing: (s, chainId) => {
    const amount = positive(s.amount);
    return {
      reasons: [
        ...diamondReasons(s, chainId),
        ...(idOf(s.listingId) === null ? ["listing id is missing"] : []),
        ...(amount === null
          ? ["borrow amount is missing or not positive"]
          : []),
        ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
        /* Symbol-only: the intent carries no token address, because the listing
           on-chain decides the currency. Priced by symbol below. */
        ...(str(s.symbol) ? [] : ["no token symbol on the draw"]),
      ],
      ...priceIf(str(s.symbol) || undefined, amount),
    };
  },

  fillRequest: (s, chainId) => {
    /* Loanable side: the request being serviced could only have been created
       with a loanable token, so that is the set to check the principal against.
       `serviceRequest` itself carries no re-check, and `s_loanableToken` is
       append-only — nothing in the facet removes from it — so this cannot refuse
       a fill the contract would have accepted. What it does catch is a token
       address on a step that did not come from a market row, which is the one
       field here that reaches an ERC20 approve. */
    const tok = lendingToken(chainId, "loanable", str(s.token));
    const amount = positive(s.amount);
    const reasons = [
      ...diamondReasons(s, chainId),
      ...(idOf(s.requestId) === null ? ["request id is missing"] : []),
      ...(tok.ok
        ? []
        : [
            notAcceptedMessage(
              chainId,
              "loanable",
              "principal token",
              str(s.token) || "(no token)",
            ),
          ]),
      /* The principal actually leaves the lender's wallet here, so the amount
         is real money and not a display field. */
      ...(amount === null ? ["principal is missing or not positive"] : []),
      ...(num(s.decimals) === null ? ["token decimals are missing"] : []),
    ];

    const wantsNative = isNativeSentinel(str(s.token), "lending");
    if (s.isNative !== undefined && Boolean(s.isNative) !== wantsNative)
      reasons.push("isNative does not match the token");

    return { reasons, ...priceIf(tok.symbol, amount) };
  },

  /* Cancellations. No token, no amount, nothing at risk — an id and the
     Diamond are the whole surface, and the contract rejects an id the caller
     does not own. */
  closeListing: (s, chainId) => ({
    reasons: [
      ...diamondReasons(s, chainId),
      ...(idOf(s.listingId) === null ? ["listing id is missing"] : []),
    ],
  }),

  closeRequest: (s, chainId) => ({
    reasons: [
      ...diamondReasons(s, chainId),
      ...(idOf(s.requestId) === null ? ["request id is missing"] : []),
    ],
  }),

  /* --------------------------------------------------------- stablecoin -- */

  /*
   * The kfUSD family pins its contracts rather than validating tokens, because
   * the token IS the contract: mintStable's target is kfUSD itself, and a
   * wrong address here is a transfer into something that is not the vault. The
   * collateral leg resolves through kfUSD's OWN accepted set — see
   * stableCollateral for why that is not the lending market's.
   */

  mintStable: (s, chainId) => {
    const tok = stableCollateral(chainId, str(s.collateralToken));
    const amount = positive(s.collateralAmount);
    const reasons = [
      ...pinned(str(s.kfUSD), stableContracts(chainId).kfUSD, "kfUSD"),
      ...(tok.ok
        ? []
        : [
            `${str(s.collateralToken) || "(no token)"} is not accepted as kfUSD collateral`,
          ]),
      ...(amount === null
        ? ["collateral amount is missing or not positive"]
        : []),
      ...(num(s.collateralDecimals) === null
        ? ["collateral decimals are missing"]
        : []),
    ];

    if (
      tok.ok &&
      tok.decimals !== undefined &&
      num(s.collateralDecimals) !== null &&
      num(s.collateralDecimals) !== tok.decimals
    )
      reasons.push(
        `decimals say ${num(s.collateralDecimals)} but ${tok.symbol} has ${tok.decimals}`,
      );

    return { reasons, ...priceIf(tok.symbol, amount) };
  },

  redeemStable: (s, chainId) => {
    const amount = positive(s.amount);
    return {
      reasons: [
        ...pinned(str(s.kfUSD), stableContracts(chainId).kfUSD, "kfUSD"),
        ...(amount === null
          ? ["redeem amount is missing or not positive"]
          : []),
        ...requireAddresses(s, "outputToken"),
        ...(str(s.outputSymbol) ? [] : ["no output token symbol"]),
      ],
      /* Priced as kfUSD, the token leaving the wallet. */
      ...priceIf("kfUSD", amount),
    };
  },

  lockStable: (s, chainId) => {
    const sc = stableContracts(chainId);
    const amount = positive(s.amount);
    return {
      reasons: [
        ...pinned(str(s.kafUSD), sc.kafUSD, "kafUSD"),
        ...pinned(str(s.kfUSD), sc.kfUSD, "kfUSD"),
        ...(amount === null ? ["lock amount is missing or not positive"] : []),
      ],
      ...priceIf("kfUSD", amount),
    };
  },

  requestStableWithdrawal: (s, chainId) => {
    const amount = positive(s.amount);
    return {
      reasons: [
        ...pinned(str(s.kafUSD), stableContracts(chainId).kafUSD, "kafUSD"),
        ...(amount === null
          ? ["withdrawal amount is missing or not positive"]
          : []),
      ],
      /* kafUSD shares, priced as kfUSD. The vault's share price is at or above
         1:1 by construction, so this reads the notional low rather than high —
         the safe direction for a cap. */
      ...priceIf("kfUSD", amount),
    };
  },

  /* Claims. Nothing leaves the wallet, so there is no amount and nothing to
     cap — the contract pays out whatever it already owes. */
  completeStableWithdrawal: (s, chainId) => ({
    reasons: [
      ...pinned(str(s.kafUSD), stableContracts(chainId).kafUSD, "kafUSD"),
      ...requireAddresses(s, "outputToken"),
      ...(str(s.outputSymbol) ? [] : ["no output token symbol"]),
    ],
  }),

  claimStableYield: (s, chainId) => ({
    reasons: [
      ...pinned(
        str(s.yieldTreasury),
        stableContracts(chainId).YieldTreasury,
        "yield treasury",
      ),
      ...requireAddresses(s, "asset"),
      ...(str(s.assetSymbol) ? [] : ["no asset symbol"]),
    ],
  }),

  compoundStableYield: (s, chainId) => {
    const sc = stableContracts(chainId);
    return {
      reasons: [
        ...pinned(str(s.yieldTreasury), sc.YieldTreasury, "yield treasury"),
        ...pinned(str(s.kfUSD), sc.kfUSD, "kfUSD"),
      ],
    };
  },

  /* --------------------------------------------------------------- pool -- */

  /*
   * Both are exits and neither is priceable here: a position's value lives in
   * the NFT, and reading it means an on-chain call these synchronous rules
   * cannot make. So the check is that the step names the app's own position
   * manager and a real token id — a wrong manager address is a call into an
   * unknown contract, and that is what this can actually prove.
   */

  /**
   * Opening a position — the one pool action that spends, and the one step in
   * this table whose main risk isn't a wrong address.
   *
   * A mint with a well-formed range and the right contracts can still be a bad
   * transaction, in a way no other kind here can be: a range that doesn't
   * straddle the market opens the position one-sided, it earns nothing, and
   * nothing reverts. So the ticks are checked as ticks, not merely as numbers —
   * ordered, and aligned to the tier's spacing, because `flipTick`
   * (dex-v3/core/libraries/TickBitmap.sol:31) requires `tick % tickSpacing == 0`
   * as a bare require with no reason string, and a fresh position flips both.
   *
   * The minimums are the other half. `NonfungiblePositionManager` checks
   * `amount0 >= amount0Min && amount1 >= amount1Min`, and a pair of zeroes
   * satisfies it for any execution at all — which is what the Pool page shipped
   * until it was fixed. One side may legitimately be zero, when the range sits
   * entirely above or below the price and the position is single-sided; both
   * cannot, and `mintMinimums` never produces both.
   *
   * Not pinned to a diamond, and it has no mandate action, because the position
   * manager is not the diamond: `LibAgentPermission.enforce()` runs inside
   * diamond calls and this transaction never enters one. Same standing as
   * `transfer` — bounded here or not at all.
   */
  mintPoolPosition: (s, chainId) => {
    const reasons: string[] = [];
    const token0 = str(s.token0);
    const token1 = str(s.token1);
    const tok0 = knownToken(chainId, token0);
    const tok1 = knownToken(chainId, token1);

    if (!tok0.ok) reasons.push(`unrecognised token ${token0 || "(none)"}`);
    if (!tok1.ok) reasons.push(`unrecognised token ${token1 || "(none)"}`);
    if (token0 && token0.toLowerCase() === token1.toLowerCase())
      reasons.push("both sides of the pair are the same token");

    reasons.push(
      ...pinned(
        str(s.positionManager),
        getContracts(chainId).v3PositionManager,
        "position manager",
      ),
    );

    const amount0 = num(s.amount0);
    const amount1 = num(s.amount1);
    if (amount0 === null || amount0 <= 0)
      reasons.push("the first token's amount is missing or not positive");
    if (amount1 === null || amount1 <= 0)
      reasons.push("the second token's amount is missing or not positive");
    if (num(s.decimals0) === null || num(s.decimals1) === null)
      reasons.push(
        "token decimals are missing, so the amounts cannot be parsed",
      );

    const fee = num(s.fee);
    /* Two questions, not one. `spacingFor` answers "does the library know a
       spacing for this?", which the ticks below need; `isTradedTier` answers
       "can a pool exist at this tier here?", which the transaction needs. The
       0.01% tier passes the first and fails the second — TICK_SPACINGS carries it
       because Uniswap's does, and this factory has it disabled — so checking only
       the spacing would clear a mint that reverts inside the factory with two
       approvals already signed. */
    const spacing = fee === null ? null : spacingFor(fee);
    if (spacing === null) {
      reasons.push("no pool fee tier, or one we don't trade");
    } else if (!isTradedTier(fee!)) {
      reasons.push(
        `the ${fee! / 10_000}% tier isn't one this DEX has a pool for`,
      );
    }

    const tickLower = num(s.tickLower);
    const tickUpper = num(s.tickUpper);
    if (tickLower === null || tickUpper === null) {
      reasons.push("the price range is missing");
    } else if (tickUpper <= tickLower) {
      reasons.push("the range's upper bound is not above its lower bound");
    } else if (spacing !== null) {
      const unaligned = [tickLower, tickUpper].filter(
        (t) => !Number.isInteger(t) || t % spacing !== 0,
      );
      if (unaligned.length > 0)
        reasons.push(
          `range bounds ${unaligned.join(" and ")} are not multiples of the ${fee! / 10_000}% tier's ${spacing}-tick spacing, so the mint would revert unexplained`,
        );
    }

    /* Both floors zero means the mint accepts any execution — the same hole the
       Pool page had. One may be zero for a single-sided range. */
    const min0 = num(s.amount0Min);
    const min1 = num(s.amount1Min);
    if (min0 === null || min1 === null) {
      reasons.push(
        "no minimum amounts — the deposit would be accepted at any price. Slippage protection is required.",
      );
    } else if (min0 <= 0 && min1 <= 0) {
      reasons.push(
        "both minimum amounts are zero, which is no slippage protection at all",
      );
    }

    return {
      reasons,
      /* Both legs, so the per-action cap covers the whole deposit. */
      ...(tok0.ok && amount0 !== null && amount0 > 0
        ? { priced: { symbol: tok0.symbol!, amount: String(amount0) } }
        : {}),
      ...(tok0.ok &&
      amount0 !== null &&
      amount0 > 0 &&
      tok1.ok &&
      amount1 !== null &&
      amount1 > 0
        ? { pricedAlso: [{ symbol: tok1.symbol!, amount: String(amount1) }] }
        : {}),
    };
  },

  collectPoolFees: (s, chainId) => ({
    reasons: [
      ...pinned(
        str(s.positionManager),
        getContracts(chainId).v3PositionManager,
        "position manager",
      ),
      ...(rawUnits(s.tokenId) === null ? ["position id is missing"] : []),
    ],
  }),

  decreasePoolLiquidity: (s, chainId) => ({
    reasons: [
      ...pinned(
        str(s.positionManager),
        getContracts(chainId).v3PositionManager,
        "position manager",
      ),
      ...(rawUnits(s.tokenId) === null ? ["position id is missing"] : []),
      /* Base units of liquidity, straight from the position. Zero would be a
         no-op transaction the user pays gas for. */
      ...(rawUnits(s.liquidity) === null
        ? ["liquidity amount is missing or zero"]
        : []),
    ],
  }),

  /**
   * Delegation, and the only intent here that hands away standing authority.
   *
   * Everything else in a plan is one transaction the user reads and signs. This
   * one grants an agent the right to act again later, without being asked, so
   * its bounds are audited on their own terms: an expiry that has passed or
   * never ends, a health floor looser than the user's, and a per-action
   * notional are each blocking rather than advisory.
   */
  grantAgentPermission: (s, _chainId, limits) => {
    const reasons: string[] = [];
    for (const field of ["diamond", "agent"]) {
      if (!ethers.isAddress(str(s[field])))
        reasons.push(`${field} is not a valid address`);
    }

    const expiry = num(s.expiryUnix);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiry === null || expiry <= nowSec)
      reasons.push("permission expiry is missing or already past");
    else if (expiry > nowSec + 365 * 86_400)
      reasons.push(
        "permission would last over a year — cap it to a year or less",
      );

    const epoch = num(s.epochDurationSec);
    if (epoch === null || epoch <= 0) reasons.push("epoch duration is missing");

    /* The grant's own health floor must be at least as strict as the user's.
       bps here, a ratio in settings — 1.4 is 14000 bps. */
    const hfBps = num(s.minHealthFactorBps);
    if (hfBps === null) reasons.push("no minimum health factor on the grant");
    else if (
      limits.minHealthFactor !== undefined &&
      hfBps < limits.minHealthFactor * 10_000
    ) {
      reasons.push(
        `grant's health floor (${(hfBps / 10_000).toFixed(2)}) is below your ${limits.minHealthFactor}`,
      );
    }

    if (!Array.isArray(s.tokens))
      reasons.push("no token allowlist on the grant");

    /* Already a USD figure, per AgentPermissionFacet, so it is capped directly
       rather than priced. */
    const perAction = num(s.maxNotionalPerAction);
    if (perAction === null || perAction <= 0)
      reasons.push("no per-action notional bound on the grant");

    return { reasons };
  },

  /* -------------------------------------------------------------- faucet -- */

  /*
   * Unpriced, and for the same reason the three claims above are: nothing leaves
   * the wallet. Pricing it would apply the user's *spend* cap to an incoming
   * balance, which bounds no risk and would refuse a claim for being too
   * generous.
   *
   * Deliberately no knownToken() on `token`, which every other token-carrying
   * rule here does apply. The faucet's assets are absent from the registry by
   * measurement — the mock USDT and USDe are in no chain's TOKENS list — so
   * requiring registry membership would reject exactly the assets the faucet
   * hands out. What replaces it is the pin above: the address has to be this
   * chain's own faucet, and an asset that faucet does not list is a revert on a
   * contract we deployed, not a transfer anywhere.
   */
  claimTestTokens: (s, chainId) => ({
    reasons: [
      ...pinned(str(s.faucet), getContracts(chainId).faucet, "faucet"),
      ...requireAddresses(s, "token"),
      ...(str(s.symbol) ? [] : ["no token symbol"]),
    ],
  }),

  /*
   * The batch form. Same pin on the faucet address and the same absence of a
   * knownToken() check, for the reasons above — but the token field is a list,
   * so requireAddresses (which reads one scalar field) does not apply and the
   * elements are checked here instead.
   *
   * An empty list is rejected rather than treated as a no-op. `claimMany([])`
   * reverts NothingClaimable, so letting it through would spend the user's gas
   * to learn what this check already knows; and a plan that reached here with
   * nothing in it means the builder found no claimable asset, which is worth
   * saying in words rather than as a bare revert.
   *
   * `payouts` is display-only and carries no authority over what is paid — the
   * contract takes addresses alone — so its contents are not audited. Its
   * length is, because types.ts specifies it parallel to `tokens`, and a review
   * row that pairs an asset with another asset's amount misinforms the one
   * person the row exists for.
   */
  claimAllTestTokens: (s, chainId) => {
    const reasons = [
      ...pinned(str(s.faucet), getContracts(chainId).faucet, "faucet"),
    ];

    if (!Array.isArray(s.tokens) || s.tokens.length === 0) {
      reasons.push("no assets to claim");
      return { reasons };
    }

    for (const [i, t] of s.tokens.entries()) {
      const v = str(t);
      if (!ethers.isAddress(v))
        reasons.push(`tokens[${i}] is not a valid address`);
      else if (/^0x0+$/i.test(v))
        reasons.push(`tokens[${i}] is the zero address`);
    }

    /* Absent as well as mismatched: the renderer calls `i.payouts.join(", ")`,
       which throws on undefined, so a missing list takes out the review row
       rather than degrading it. */
    if (!Array.isArray(s.payouts) || s.payouts.length !== s.tokens.length)
      reasons.push(
        "payout list is missing or does not match the assets being claimed",
      );

    return { reasons };
  },
};

/* ---------------------------------------------------------------- audit -- */

/**
 * Audits a plan. Async because valuing a step means asking a price oracle.
 *
 * Ordering is deliberate: structure first, then permission, then value. A
 * malformed step is not worth pricing, and a product the user has switched off
 * is not worth pricing either — this keeps a rejected plan from spending an
 * upstream price call per leg.
 */
export async function auditPlan(opts: {
  plan: PlanStep[];
  chainId: number | undefined;
  limits?: Guardrails;
  /** The user's per-product switches, from useAgentSettings. */
  allowedActions?: Record<string, boolean>;
  /** Overridable for tests; defaults to the real Pyth-backed oracle. */
  pricer?: Pricer;
}): Promise<AuditVerdict> {
  const { plan, chainId } = opts;
  const priceOf = opts.pricer ?? defaultPricer;
  const limits = opts.limits ?? {};
  const steps: AuditedStep[] = [];
  const blocked: string[] = [];
  const notes: string[] = [];

  /* The effective cap is the tighter of what the user asked for and what this
     server permits. `Math.min` and not `??`: a client that omits the field, or
     sends a larger one, gets the ceiling either way. */
  const perAction = Math.min(
    limits.maxPerAction ?? HARD_MAX_NOTIONAL_USD,
    HARD_MAX_NOTIONAL_USD,
  );

  if (plan.length > 0 && chainId === undefined) {
    /* No chain means no token registry to validate against, so no address in
       this plan can be shown to be real. Blocking the plan rather than the
       turn: the model's prose is still worth reading. */
    blocked.push(
      "No chain is connected, so the tokens in this plan cannot be verified.",
    );
  }

  let totalUsd = 0;

  for (const step of plan) {
    const kind = str(step.kind);
    const audited: AuditedStep = { kind, usd: null };

    /* Fails closed on anything unrecognised. `intentsFromChat` already drops
       unregistered kinds on the client, but this runs first and must not assume
       a later layer will catch what it lets through.

       The cast is to index a total record with a string that has not been
       narrowed yet; the `!rule` check below is the actual gate, and it is a
       runtime check precisely because `kind` arrives as data. */
    const rule = AUDITORS[kind as IntentKind] as Auditor | undefined;
    if (!rule) {
      audited.blocked = `"${kind}" is not an auditable action`;
      blocked.push(audited.blocked);
      steps.push(audited);
      continue;
    }

    const shape = rule(step, chainId, limits);
    if (shape.reasons.length > 0 || chainId === undefined) {
      audited.blocked = shape.reasons.join("; ") || "chain unknown";
      if (shape.reasons.length > 0) blocked.push(`${kind}: ${audited.blocked}`);
      steps.push(audited);
      continue;
    }

    /* Caveats the rule raised for checks it could not make. Recorded before the
       permission and price gates so a step that later blocks still reports why
       it was only partly verifiable. */
    for (const n of shape.notes ?? []) {
      audited.note = audited.note ? `${audited.note}; ${n}` : n;
      notes.push(`${kind}: ${n}`);
    }

    const action = ACTION_OF[kind as IntentKind];
    if (
      action &&
      opts.allowedActions &&
      opts.allowedActions[action] === false
    ) {
      audited.blocked = `${action} is switched off in your agent settings`;
      blocked.push(`${kind}: ${audited.blocked}`);
      steps.push(audited);
      continue;
    }

    if (shape.priced) {
      /* Every leg this step moves, not just the first. A single-token step has
         one entry and behaves exactly as it did; a pool mint has two, and both
         have to count against the same per-action cap because both leave the
         wallet in the same transaction. */
      const legs = [shape.priced, ...(shape.pricedAlso ?? [])];
      const valued = await Promise.all(
        legs.map(async (leg) => ({
          leg,
          ...(await priceOf(leg.symbol, leg.amount)),
        })),
      );

      let stepUsd: number | null = null;
      for (const { leg, usd, source } of valued) {
        if (usd === null) {
          /* An asset with no USD price cannot be measured against a USD cap, and
             this is a real condition rather than an error: KLD has no market
             before TGE, which is the point of a pre-TGE token. Blocking it would
             make the agent useless for the protocol's own asset, so the step
             passes and the response says the cap could not be applied to it —
             visible, rather than a silent hole in the ceiling. */
          const note = `${leg.amount} ${leg.symbol} has no USD price (${source}), so the per-action limit could not be checked against it`;
          audited.note = audited.note ? `${audited.note}; ${note}` : note;
          notes.push(`${kind}: ${note}`);
        } else {
          stepUsd = (stepUsd ?? 0) + usd;
        }
      }
      audited.usd = stepUsd;

      if (stepUsd !== null) {
        totalUsd += stepUsd;
        if (stepUsd > perAction) {
          audited.blocked = `$${stepUsd.toFixed(2)} exceeds your $${perAction} per-action limit`;
          blocked.push(`${kind}: ${audited.blocked}`);
          steps.push(audited);
          continue;
        }
      }
    }

    /*
     * The swap's minimum output against the user's slippage tolerance.
     *
     * Here rather than in the rule table because it needs both legs priced, and
     * the rules are synchronous on purpose. This is the check that makes
     * `amountOutMin` mean something: the rule above only proves a floor exists,
     * and a floor of 1 wei exists too. Comparing the two legs in USD is what
     * distinguishes a real floor from a nominal one.
     *
     * Skipped, not failed, when either leg is unpriced — that is KLD before
     * TGE, and refusing every KLD swap for want of a market price would be a
     * cap on the protocol's own token rather than on risk. Said out loud in
     * `notes` so an unchecked swap is never silently indistinguishable from a
     * checked one.
     */
    if (shape.swap && limits.slippageBps !== undefined) {
      const { inSymbol, outSymbol, amountIn, minOut } = shape.swap;
      const [inSide, outSide] = await Promise.all([
        priceOf(inSymbol, String(amountIn)),
        priceOf(outSymbol, String(minOut)),
      ]);

      if (inSide.usd === null || outSide.usd === null) {
        const which = inSide.usd === null ? inSymbol : outSymbol;
        const note = `slippage could not be verified — ${which} has no USD price`;
        audited.note = audited.note ? `${audited.note}; ${note}` : note;
        notes.push(`${kind}: ${note}`);
      } else if (inSide.usd > 0) {
        /* How much value the floor concedes, as a fraction of what goes in.
           Negative would mean the floor is worth more than the input, which is
           not a slippage failure — so only a shortfall is measured. */
        const lossBps = ((inSide.usd - outSide.usd) / inSide.usd) * 10_000;
        if (lossBps > limits.slippageBps) {
          audited.blocked = `minimum output concedes ${(lossBps / 100).toFixed(2)}%, over your ${(limits.slippageBps / 100).toFixed(2)}% slippage limit`;
          blocked.push(`${kind}: ${audited.blocked}`);
          steps.push(audited);
          continue;
        }
      }
    }

    steps.push(audited);
  }

  /* The plan's own total against the daily cap.
     Named for what it actually measures. `maxPerDay` is a rolling-day budget,
     and this server does not yet total a wallet's signed plans across a day —
     so this catches the plan that breaches it in one go and says so honestly,
     rather than claiming a day-wide guarantee it cannot make. */
  const perDay = limits.maxPerDay;
  if (perDay !== undefined && totalUsd > perDay) {
    blocked.push(
      `This plan totals $${totalUsd.toFixed(2)}, over your $${perDay} daily limit.`,
    );
  }

  return { ok: blocked.length === 0, steps, blocked, notes, totalUsd };
}

/**
 * The sentence the user reads when a plan is refused.
 *
 * Says what was wrong and does not offer to proceed anyway. The old gate told
 * the user to "break your request into smaller chunks", which is advice for
 * exactly one of these failures and misleading for the rest — a hallucinated
 * token address does not get better in smaller pieces.
 */
export function refusalText(verdict: AuditVerdict): string {
  const lines = verdict.blocked.map((b) => `• ${b}`).join("\n");
  return `I drafted a plan, but my own safety checks rejected it, so I'm not offering it for signing:\n\n${lines}\n\nNothing was sent to your wallet. Direct commands still work if you want to do this step yourself.`;
}
