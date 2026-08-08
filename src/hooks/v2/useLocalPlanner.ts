"use client";

import { useCallback } from "react";
import { ethers } from "ethers";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { BORROW_CURRENCIES } from "@/hooks/v2/useBorrowV2";
import { STABLE_CONTRACTS } from "@/hooks/useStablecoin";
import { envVars } from "@/constants/envVars";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import {
  ADDRESS_1,
  KALEIDOSWAP_V3_POSITION_MANAGER,
  KALEIDOSWAP_V3_ROUTER,
  KLD_ADDRESS,
  stKLD_ADDRESS,
} from "@/constants/utils/addresses";
import { symbolForAddress } from "@/constants/tokens";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { Intent } from "@/lib/v2/intents";
import type { Command } from "@/lib/v2/intents/fromCommand";

/**
 * Resolves a P2P currency address to its symbol and decimals, the way the
 * Borrow page does today: getTokenDecimals branches correctly on the five
 * lending currencies (ETH/USDR/kfUSD → 18, USDC/USDT → 6). The legacy accept
 * hook instead assumed "ETH or 6 decimals" for everything, which is wrong for
 * USDR and kfUSD — not repeated here.
 */
function describeToken(address: string): { symbol: string; decimals: number } {
  const known = BORROW_CURRENCIES.find(
    (c) => c.address.toLowerCase() === address.toLowerCase(),
  );
  return {
    symbol: known?.symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    decimals: getTokenDecimals(address),
  };
}

interface MarketRow {
  tokenAddress: string;
  /**
   * Raw base-unit amount. Values here run past 10^19 (well beyond
   * Number.MAX_SAFE_INTEGER), so this is only safe if PostgREST serialised it
   * as a JSON string rather than a number — which is its documented behavior
   * for numeric/bigint columns, precisely to avoid this precision loss. Not
   * independently verified against the live schema; if a future response ever
   * carries `amount` as a bare JSON number, `fetch().json()` has already
   * truncated it before this code runs, and String() below can't recover it.
   */
  amount: string;
}

/**
 * Reads one listing or request row from the Supabase-indexed mirror the
 * Borrow page itself reads (/api/listings, /api/requests) — these exist and
 * carry tokenAddress/amount/min/max, so the planner doesn't have to guess at
 * an order book it can't otherwise see.
 *
 * The API's `searchId` does exact-OR-partial matching (`eq` or `ilike %id%`),
 * so a search for "3" can also return "13" or "31". Silently taking the first
 * row back would risk building a plan against the wrong listing — money sent
 * to a stranger's request instead of the intended one — so this always
 * filters for an exact id match client-side and refuses if it isn't there.
 */
async function fetchMarketRow(
  kind: "listings" | "requests",
  id: number,
): Promise<MarketRow | null> {
  const idField = kind === "listings" ? "listingId" : "requestId";
  try {
    const res = await fetch(`/api/${kind}?searchId=${id}&status=OPEN`);
    const body = await res.json().catch(() => null);
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    const exact = rows.find((r) => Number(r[idField]) === id);
    if (!exact) return null;
    return { tokenAddress: exact.tokenAddress, amount: String(exact.amount) };
  } catch {
    return null;
  }
}

/**
 * Turns a parsed Command into a signable plan, with no model in the loop.
 *
 * The rule this file exists to enforce: the local path must not become a second
 * implementation of trading logic. It quotes through the same
 * `getV3AmountOut` the Swap page uses and emits the same [approve, swap] pair,
 * so a pricing or slippage fix lands in one place. If this ever drifts from the
 * manual pages, the chat becomes a liability rather than a shortcut.
 *
 * Quotes are the only async part, which is why parsing (pure) and planning
 * (chain reads) are separate modules.
 */

const DEFAULT_FEE = 3000;

export interface PlanBuild {
  intents: Intent[];
  /** One line the chat shows above the plan, so the user sees our reading. */
  summary: string;
}

export type PlanResult =
  | { ok: true; build: PlanBuild }
  | { ok: false; error: string };

export interface PlannerOptions {
  slippageBps: number;
  deadlineMin: number;
  /** Open loans, so a bare "repay" can resolve to one without asking. */
  loans?: LoanRef[];
  /** The wallet's V3 positions, so collect/remove can find one by tokenId. */
  positions?: PoolPositionRef[];
}

/** The slice of a V3 position the planner needs. */
export interface PoolPositionRef {
  tokenId: string;
  token0: string;
  token1: string;
  /** Raw uint128 liquidity, as the position manager stores it — not a token amount. */
  liquidity: string;
}

/**
 * Display label for a position's token, on a given chain.
 *
 * Only ever used to build a summary line the user reads before signing, so a
 * truncated address is an acceptable answer. It must not be used to pick an
 * address to transact with.
 */
function symbolForPoolToken(chainId: number | undefined, address: string): string {
  return symbolForAddress(chainId, address);
}

/** The slice of an active loan the planner needs. */
export interface LoanRef {
  requestId: number;
  totalRepayment: string;
  totalRepaymentRaw: string;
  symbol: string;
  tokenAddress: string;
}

const daysFromNow = (days: number) =>
  Math.floor(Date.now() / 1000) + Math.round(days * 86_400);

/**
 * Re-resolves a token against the lending registry.
 *
 * The DEX and the P2P protocol disagree about native ETH: the DEX-side token
 * carries the swap-router sentinel (0xEeee…), while BORROW_CURRENCIES uses
 * ADDRESS_1, which is what ProtocolFacet expects. Passing the parser's token
 * straight through would send collateral to the wrong address and try to
 * ERC20-approve something that isn't a token. Symbols are the only stable key
 * across the two lists, so lending commands re-resolve here and refuse anything
 * the protocol doesn't accept, rather than silently proceeding with a DEX
 * address.
 */
function toLendingCurrency(symbol: string) {
  return BORROW_CURRENCIES.find(
    (c) => c.symbol.toLowerCase() === symbol.toLowerCase(),
  );
}

const unsupported = (symbol: string): PlanResult => ({
  ok: false,
  error: `${symbol} isn't accepted by the lending market. Supported: ${BORROW_CURRENCIES.map((c) => c.symbol).join(", ")}.`,
});

export function useLocalPlanner() {
  const { getV3AmountOut } = useV3SwapRouter();
  const { chainId } = useWalletV2();

  const buildPlan = useCallback(
    async (command: Command, opts: PlannerOptions): Promise<PlanResult> => {
      if (command.kind === "help") {
        return { ok: false, error: "help" };
      }

      if (command.kind === "swap") {
        const { amount, tokenIn, tokenOut } = command;

        let quoted: unknown;
        try {
          quoted = await getV3AmountOut(
            tokenIn.address,
            tokenOut.address,
            amount,
            DEFAULT_FEE,
            tokenIn.decimals,
            tokenOut.decimals,
          );
        } catch {
          quoted = null;
        }

        const out = Number(quoted);
        if (!quoted || !Number.isFinite(out) || out <= 0) {
          return {
            ok: false,
            error: `I couldn't get a price for ${tokenIn.symbol} to ${tokenOut.symbol}. That pair may have no pool at the ${DEFAULT_FEE / 10000}% fee tier.`,
          };
        }

        // Mirrors the Swap page: trim to the token's precision, but never past
        // 6dp, so the string stays inside parseUnits' tolerance.
        const minOut = (out * (1 - opts.slippageBps / 10000)).toFixed(
          tokenOut.decimals > 6 ? 6 : tokenOut.decimals,
        );

        return {
          ok: true,
          build: {
            summary: `Swap ${amount} ${tokenIn.symbol} for about ${out} ${tokenOut.symbol}.`,
            intents: [
              {
                kind: "approve",
                token: tokenIn.address,
                spender: KALEIDOSWAP_V3_ROUTER,
                amount,
                decimals: tokenIn.decimals,
                symbol: tokenIn.symbol,
              },
              {
                kind: "swap",
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn: amount,
                amountOutMin: minOut,
                fee: DEFAULT_FEE,
                decimalsIn: tokenIn.decimals,
                decimalsOut: tokenOut.decimals,
                symbolIn: tokenIn.symbol,
                symbolOut: tokenOut.symbol,
                deadlineMin: opts.deadlineMin,
              },
            ],
          },
        };
      }

      if (command.kind === "stake") {
        const vault = envVars.vaultAddress;
        if (!vault) {
          return { ok: false, error: "The staking vault address isn't configured." };
        }
        return {
          ok: true,
          build: {
            summary: `Stake ${command.amount} KLD for stKLD.`,
            intents: [
              {
                kind: "approve",
                token: KLD_ADDRESS,
                spender: vault,
                amount: command.amount,
                decimals: 18,
                symbol: "KLD",
              },
              {
                kind: "stake",
                vault,
                token: KLD_ADDRESS,
                stToken: stKLD_ADDRESS,
                amount: command.amount,
                symbol: "KLD",
              },
            ],
          },
        };
      }

      if (command.kind === "approve") {
        return {
          ok: true,
          build: {
            summary: `Approve ${command.amount} ${command.token.symbol} for trading.`,
            intents: [
              {
                kind: "approve",
                token: command.token.address,
                spender: KALEIDOSWAP_V3_ROUTER,
                amount: command.amount,
                decimals: command.token.decimals,
                symbol: command.token.symbol,
              },
            ],
          },
        };
      }

      /* ------------------------------------------------------- lending -- */

      const diamond = envVars.lendbitDiamondAddress;
      if (!diamond) {
        return { ok: false, error: "The protocol address isn't configured." };
      }

      if (command.kind === "deposit") {
        const { amount } = command;
        const cur = toLendingCurrency(command.token.symbol);
        if (!cur) return unsupported(command.token.symbol);
        const isNative = cur.address.toLowerCase() === ADDRESS_1.toLowerCase();
        return {
          ok: true,
          build: {
            summary: `Deposit ${amount} ${cur.symbol} as collateral.`,
            intents: [
              // Native collateral is sent as value, so there is nothing to
              // approve. Emitting an approve for it would revert.
              ...(isNative
                ? []
                : ([
                    {
                      kind: "approve",
                      token: cur.address,
                      spender: diamond,
                      amount,
                      decimals: cur.decimals,
                      symbol: cur.symbol,
                    },
                  ] as Intent[])),
              {
                kind: "depositCollateral",
                diamond,
                token: cur.address,
                amount,
                decimals: cur.decimals,
                symbol: cur.symbol,
                isNative,
              },
            ],
          },
        };
      }

      if (command.kind === "withdraw") {
        const { amount } = command;
        const cur = toLendingCurrency(command.token.symbol);
        if (!cur) return unsupported(command.token.symbol);
        return {
          ok: true,
          build: {
            summary: `Withdraw ${amount} ${cur.symbol} of collateral.`,
            intents: [
              {
                kind: "withdrawCollateral",
                diamond,
                token: cur.address,
                amount,
                decimals: cur.decimals,
                symbol: cur.symbol,
              },
            ],
          },
        };
      }

      if (command.kind === "borrow") {
        const { amount, interestPct, days } = command;
        const cur = toLendingCurrency(command.token.symbol);
        if (!cur) return unsupported(command.token.symbol);
        return {
          ok: true,
          build: {
            summary: `Post a request to borrow ${amount} ${cur.symbol} at ${interestPct}% for ${days} days. It fills when a lender takes it.`,
            intents: [
              {
                kind: "createLendingRequest",
                diamond,
                token: cur.address,
                amount,
                decimals: cur.decimals,
                symbol: cur.symbol,
                interestPct,
                returnDate: daysFromNow(days),
              },
            ],
          },
        };
      }

      if (command.kind === "lend") {
        const { amount, interestPct, days } = command;
        const cur = toLendingCurrency(command.token.symbol);
        if (!cur) return unsupported(command.token.symbol);
        const token = cur;
        const isNative = cur.address.toLowerCase() === ADDRESS_1.toLowerCase();
        return {
          ok: true,
          build: {
            // min and max are set to the full amount, so the listing is drawn in
            // one piece. Partial draws are a real feature of the contract, but
            // picking a split here would be inventing policy the user didn't
            // state; the Borrow page is where that gets chosen deliberately.
            summary: `Offer ${amount} ${token.symbol} to lend at ${interestPct}% for ${days} days, drawn in one piece.`,
            intents: [
              ...(isNative
                ? []
                : ([
                    {
                      kind: "approve",
                      token: token.address,
                      spender: diamond,
                      amount,
                      decimals: token.decimals,
                      symbol: token.symbol,
                    },
                  ] as Intent[])),
              {
                kind: "createLoanListing",
                diamond,
                token: token.address,
                amount,
                minAmount: amount,
                maxAmount: amount,
                decimals: token.decimals,
                symbol: token.symbol,
                interestPct,
                returnDate: daysFromNow(days),
                isNative,
              },
            ],
          },
        };
      }

      if (command.kind === "cancel") {
        // Only an id is needed, so this is exact with no market data.
        return {
          ok: true,
          build: {
            summary:
              command.target === "listing"
                ? `Cancel your listing #${command.id}.`
                : `Cancel your borrow request #${command.id}.`,
            intents: [
              command.target === "listing"
                ? { kind: "closeListing", diamond, listingId: command.id }
                : { kind: "closeRequest", diamond, requestId: command.id },
            ],
          },
        };
      }

      if (command.kind === "takeListing") {
        const row = await fetchMarketRow("listings", command.listingId);
        if (!row) {
          return { ok: false, error: `I can't find an open listing #${command.listingId}.` };
        }
        const { symbol, decimals } = describeToken(row.tokenAddress);
        return {
          ok: true,
          build: {
            summary: `Borrow ${command.amount} ${symbol} from listing #${command.listingId}.`,
            intents: [
              {
                kind: "borrowFromListing",
                diamond,
                listingId: command.listingId,
                amount: command.amount,
                decimals,
                symbol,
              },
            ],
          },
        };
      }

      if (command.kind === "fillRequest") {
        const row = await fetchMarketRow("requests", command.requestId);
        if (!row) {
          return { ok: false, error: `I can't find an open request #${command.requestId}.` };
        }
        const { symbol, decimals } = describeToken(row.tokenAddress);
        const isNative = row.tokenAddress.toLowerCase() === ADDRESS_1.toLowerCase();
        const amount = ethers.formatUnits(BigInt(row.amount), decimals);
        return {
          ok: true,
          build: {
            summary: `Lend ${amount} ${symbol} to request #${command.requestId}.`,
            intents: [
              // The lender approves the diamond to pull the principal; native
              // ETH skips this and rides along as value on serviceRequest.
              ...(isNative
                ? []
                : ([
                    {
                      kind: "approve",
                      token: row.tokenAddress,
                      spender: diamond,
                      amount,
                      decimals,
                      symbol,
                    },
                  ] as Intent[])),
              {
                kind: "fillRequest",
                diamond,
                requestId: command.requestId,
                token: row.tokenAddress,
                amount,
                decimals,
                symbol,
                isNative,
              },
            ],
          },
        };
      }

      /* ------------------------------------------------------ stablecoin -- */
      // STABLE_TOKEN lists the exact collateral/output tokens the app accepts
      // (USDC/USDT/USDe). Re-resolving by symbol here, rather than trusting the
      // token the parser matched, means "mint 500 kld" fails loudly instead
      // of quoting a token the stablecoin contracts were never told about.
      const STABLE_TOKEN: Record<string, { address: string; decimals: number }> = {
        USDC: { address: STABLE_CONTRACTS.USDC, decimals: 6 },
        USDT: { address: STABLE_CONTRACTS.USDT, decimals: 6 },
        USDe: { address: STABLE_CONTRACTS.USDe, decimals: 18 },
      };
      const unsupportedCollateral = (symbol: string): PlanResult => ({
        ok: false,
        error: `${symbol} isn't accepted as kfUSD collateral. Supported: USDC, USDT, USDe.`,
      });

      if (command.kind === "mint") {
        const cur = STABLE_TOKEN[command.token.symbol.toUpperCase()];
        if (!cur) return unsupportedCollateral(command.token.symbol);
        return {
          ok: true,
          build: {
            summary: `Mint ${command.amount} kfUSD, backed by ${command.amount} ${command.token.symbol}.`,
            intents: [
              {
                kind: "approve",
                token: cur.address,
                spender: STABLE_CONTRACTS.kfUSD,
                amount: command.amount,
                decimals: cur.decimals,
                symbol: command.token.symbol,
              },
              {
                kind: "mintStable",
                kfUSD: STABLE_CONTRACTS.kfUSD,
                collateralToken: cur.address,
                collateralAmount: command.amount,
                collateralDecimals: cur.decimals,
                collateralSymbol: command.token.symbol,
              },
            ],
          },
        };
      }

      if (command.kind === "redeem") {
        const cur = STABLE_TOKEN[command.token.symbol.toUpperCase()];
        if (!cur) return unsupportedCollateral(command.token.symbol);
        return {
          ok: true,
          build: {
            summary: `Redeem ${command.amount} kfUSD for ${command.token.symbol}.`,
            intents: [
              // kfUSD approving itself: the contract transferFroms the caller's
              // own balance before burning it, so the allowance target is the
              // kfUSD contract, matching useStablecoin.ts's redeemKfUSD exactly.
              {
                kind: "approve",
                token: STABLE_CONTRACTS.kfUSD,
                spender: STABLE_CONTRACTS.kfUSD,
                amount: command.amount,
                decimals: 18,
                symbol: "kfUSD",
              },
              {
                kind: "redeemStable",
                kfUSD: STABLE_CONTRACTS.kfUSD,
                amount: command.amount,
                outputToken: cur.address,
                outputSymbol: command.token.symbol,
              },
            ],
          },
        };
      }

      if (command.kind === "lock") {
        return {
          ok: true,
          build: {
            summary: `Lock ${command.amount} kfUSD in the yield vault for kafUSD.`,
            intents: [
              {
                kind: "approve",
                token: STABLE_CONTRACTS.kfUSD,
                spender: STABLE_CONTRACTS.kafUSD,
                amount: command.amount,
                decimals: 18,
                symbol: "kfUSD",
              },
              {
                kind: "lockStable",
                kafUSD: STABLE_CONTRACTS.kafUSD,
                kfUSD: STABLE_CONTRACTS.kfUSD,
                amount: command.amount,
              },
            ],
          },
        };
      }

      if (command.kind === "unlock") {
        return {
          ok: true,
          build: {
            summary: `Request withdrawal of ${command.amount} kafUSD. This starts the cooldown; it doesn't pay out yet.`,
            intents: [
              {
                kind: "requestStableWithdrawal",
                kafUSD: STABLE_CONTRACTS.kafUSD,
                amount: command.amount,
              },
            ],
          },
        };
      }

      if (command.kind === "completeWithdrawal") {
        const cur = STABLE_TOKEN[command.token.symbol.toUpperCase()];
        if (!cur) return unsupportedCollateral(command.token.symbol);
        return {
          ok: true,
          build: {
            summary: `Complete your withdrawal, paid out in ${command.token.symbol}.`,
            intents: [
              {
                kind: "completeStableWithdrawal",
                kafUSD: STABLE_CONTRACTS.kafUSD,
                outputToken: cur.address,
                outputSymbol: command.token.symbol,
              },
            ],
          },
        };
      }

      if (command.kind === "claimYield") {
        // Matches the Earn page's own Claim button exactly: it claims kfUSD
        // yield specifically, not a generic "ALL" the live UI doesn't expose.
        return {
          ok: true,
          build: {
            summary: "Claim accrued kfUSD yield.",
            intents: [
              {
                kind: "claimStableYield",
                yieldTreasury: STABLE_CONTRACTS.YieldTreasury,
                asset: STABLE_CONTRACTS.kfUSD,
                assetSymbol: "kfUSD",
              },
            ],
          },
        };
      }

      if (command.kind === "compoundYield") {
        return {
          ok: true,
          build: {
            summary: "Claim kfUSD yield and leave it ready to lock back into the vault.",
            intents: [
              {
                kind: "compoundStableYield",
                yieldTreasury: STABLE_CONTRACTS.YieldTreasury,
                kfUSD: STABLE_CONTRACTS.kfUSD,
              },
            ],
          },
        };
      }

      /* --------------------------------------------------------- pool -- */
      if (command.kind === "collectFees" || command.kind === "removePosition") {
        const positions = opts.positions ?? [];
        const pos = positions.find((p) => p.tokenId === String(command.positionId));
        if (!pos) {
          return {
            ok: false,
            error: `I can't find position #${command.positionId} in your wallet.`,
          };
        }
        const pairLabel = `${symbolForPoolToken(chainId, pos.token0)}/${symbolForPoolToken(chainId, pos.token1)}`;

        if (command.kind === "collectFees") {
          return {
            ok: true,
            build: {
              summary: `Collect fees on ${pairLabel} #${pos.tokenId}.`,
              intents: [
                {
                  kind: "collectPoolFees",
                  positionManager: KALEIDOSWAP_V3_POSITION_MANAGER,
                  tokenId: pos.tokenId,
                  pairLabel,
                },
              ],
            },
          };
        }

        // removePosition: decreaseLiquidity to zero, then collect — two
        // intents, matching how every other multi-step flow in this bus is
        // modelled, so the user reviews and signs each leg rather than one
        // resolver silently sending two transactions.
        return {
          ok: true,
          build: {
            summary: `Remove all liquidity from ${pairLabel} #${pos.tokenId}, then collect what's owed.`,
            intents: [
              {
                kind: "decreasePoolLiquidity",
                positionManager: KALEIDOSWAP_V3_POSITION_MANAGER,
                tokenId: pos.tokenId,
                liquidity: pos.liquidity,
                pairLabel,
              },
              {
                kind: "collectPoolFees",
                positionManager: KALEIDOSWAP_V3_POSITION_MANAGER,
                tokenId: pos.tokenId,
                pairLabel,
              },
            ],
          },
        };
      }

      // repay
      const loans = opts.loans ?? [];
      if (loans.length === 0) {
        return { ok: false, error: "You have no open loans to repay." };
      }

      const target = command.loanId
        ? loans.find((l) => l.requestId === command.loanId)
        : loans.length === 1
          ? loans[0]
          : undefined;

      if (!target) {
        return command.loanId
          ? { ok: false, error: `I can't find an open loan #${command.loanId}.` }
          : {
              ok: false,
              error: `You have ${loans.length} open loans. Say which one, e.g. "repay ${loans[0].requestId}". Open: ${loans.map((l) => `#${l.requestId} (${l.totalRepayment} ${l.symbol})`).join(", ")}.`,
            };
      }

      const isNative = target.tokenAddress.toLowerCase() === ADDRESS_1.toLowerCase();
      // Decimals come from the currency registry, not a default: approving a
      // 6-decimal token as though it had 18 would ask for a trillion times the
      // intended allowance.
      const repayDecimals = toLendingCurrency(target.symbol)?.decimals ?? 18;
      return {
        ok: true,
        build: {
          summary: `Repay loan #${target.requestId} in full: ${target.totalRepayment} ${target.symbol}.`,
          intents: [
            ...(isNative
              ? []
              : ([
                  {
                    kind: "approve",
                    token: target.tokenAddress,
                    spender: diamond,
                    amount: target.totalRepayment,
                    decimals: repayDecimals,
                    symbol: target.symbol,
                  },
                ] as Intent[])),
            {
              kind: "repayLoan",
              diamond,
              requestId: target.requestId,
              amountRaw: target.totalRepaymentRaw,
              amount: target.totalRepayment,
              symbol: target.symbol,
              isNative,
            },
          ],
        },
      };
    },
    [getV3AmountOut, chainId],
  );

  return { buildPlan };
}

/*
 * Deliberately no value ceiling on this path.
 *
 * `maxPerAction` and `allowedActions` exist for *delegated* execution: the
 * grantAgentPermission flow lets Luca sign on the user's behalf, so the
 * on-chain AgentPermissionFacet needs a notional cap it can enforce without a
 * human present. A typed command is the opposite situation. The user wrote the
 * amount and signs it themselves in PlanReview, exactly as they would on the
 * Swap page — which caps nothing. Applying an agent ceiling here would restrict
 * someone from spending their own funds and make the chat inconsistent with the
 * form for no gain in safety, since the signature is the real gate.
 *
 * What is worth rationing is the *model*, and that's a call count per user, not
 * a transaction value. It belongs server-side in /api/chat where it can't be
 * bypassed, not in this module.
 */

/** Guards against a malformed amount reaching ethers.parseUnits. */
export function isParsableAmount(amount: string, decimals: number): boolean {
  try {
    ethers.parseUnits(amount, decimals);
    return true;
  } catch {
    return false;
  }
}
