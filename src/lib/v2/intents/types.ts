import type { ethers } from "ethers";

/**
 * The intent bus.
 *
 * From the component map: pages never import each other's components, and Luca
 * never imports each page. They emit *intents* — plain, serialisable objects —
 * and a registry turns each into (a) a row you can read and (b) calldata you
 * can sign. Adding a product means registering two functions, not editing every
 * caller. This is the one mechanism that keeps Portfolio→Repay, Pool→Rebalance,
 * and Luca's multi-step plans from tangling into a dependency cycle.
 *
 * An intent is atomic. A multi-step action (approve then swap, bridge then
 * deposit) is an ordered array of intents — a plan — executed in sequence.
 */

export type Intent =
  | {
      kind: "approve";
      token: string;
      spender: string;
      /** Human amount; resolver parses with `decimals`. */
      amount: string;
      decimals: number;
      symbol: string;
    }
  | {
      kind: "swap";
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOutMin: string;
      fee: number;
      decimalsIn: number;
      decimalsOut: number;
      symbolIn: string;
      symbolOut: string;
      /** Transaction deadline in minutes. Defaults to 20 if omitted. */
      deadlineMin?: number;
    }
  | {
      kind: "stake";
      /** Vault contract address (envVars.vaultAddress). */
      vault: string;
      token: string;
      stToken: string;
      amount: string;
      symbol: string;
    }
  /* ---------------------------------------------------------- lending -- */
  /*
   * The P2P family. Each mirrors one ProtocolFacet call that previously only
   * existed inside a React hook, so the Borrow page and Luca can drive the same
   * execution path instead of maintaining two.
   *
   * Native ETH is addressed by the ADDRESS_1 sentinel rather than a zero
   * address, matching the contracts. Resolvers send `value` for it and skip the
   * ERC20 approve that a token would need.
   */
  | {
      kind: "depositCollateral";
      /** Diamond address (envVars.lendbitDiamondAddress). */
      diamond: string;
      token: string;
      amount: string;
      decimals: number;
      symbol: string;
      /** True for ETH, which is sent as value rather than transferred. */
      isNative?: boolean;
    }
  | {
      kind: "withdrawCollateral";
      diamond: string;
      token: string;
      amount: string;
      decimals: number;
      symbol: string;
    }
  | {
      kind: "repayLoan";
      diamond: string;
      requestId: number;
      /** Base units — the contract takes the raw repayment figure. */
      amountRaw: string;
      /** Human amount, for the rendered row only. */
      amount: string;
      symbol: string;
      isNative?: boolean;
    }
  | {
      /** Ask to borrow: posts a request lenders can fill. */
      kind: "createLendingRequest";
      diamond: string;
      token: string;
      amount: string;
      decimals: number;
      symbol: string;
      /** Whole percent, as the contract's formatInterestRate expects. */
      interestPct: number;
      /** Unix seconds. */
      returnDate: number;
    }
  | {
      /** Offer to lend: posts a listing borrowers can draw against. */
      kind: "createLoanListing";
      diamond: string;
      token: string;
      amount: string;
      minAmount: string;
      maxAmount: string;
      decimals: number;
      symbol: string;
      interestPct: number;
      returnDate: number;
      isNative?: boolean;
    }
  | {
      /** Draw against a lender's listing. Requires collateral already posted. */
      kind: "borrowFromListing";
      diamond: string;
      listingId: number;
      amount: string;
      decimals: number;
      symbol: string;
    }
  | {
      /** Fund a borrower's open request. The lender sends the principal. */
      kind: "fillRequest";
      diamond: string;
      requestId: number;
      token: string;
      /** Principal being sent, for the rendered row and the approve step. */
      amount: string;
      decimals: number;
      symbol: string;
      isNative?: boolean;
    }
  | {
      /** Cancel your own lending offer. */
      kind: "closeListing";
      diamond: string;
      listingId: number;
    }
  | {
      /** Cancel your own borrow request. */
      kind: "closeRequest";
      diamond: string;
      requestId: number;
    }
  /* ------------------------------------------------------- stablecoin -- */
  /*
   * Mirrors useStablecoin.ts, the only place these calls previously existed.
   * kfUSD is minted 1:1 against collateral (the app makes no other claim, see
   * the mint page's "Rate: 1 USDC = 1 kfUSD"), and redeemed back the same way.
   * kafUSD is the yield vault: locking kfUSD mints it, and exiting is a
   * request → cooldown → complete lifecycle, not one call.
   */
  | {
      kind: "mintStable";
      kfUSD: string;
      collateralToken: string;
      collateralAmount: string;
      collateralDecimals: number;
      collateralSymbol: string;
    }
  | {
      kind: "redeemStable";
      kfUSD: string;
      /** kfUSD amount, always 18 decimals. */
      amount: string;
      outputToken: string;
      outputSymbol: string;
    }
  | {
      /** Locks kfUSD into the kafUSD vault. */
      kind: "lockStable";
      kafUSD: string;
      kfUSD: string;
      amount: string;
    }
  | {
      /** Starts the withdrawal cooldown. Amount is in kafUSD shares. */
      kind: "requestStableWithdrawal";
      kafUSD: string;
      amount: string;
    }
  | {
      /** Claims principal once the cooldown has elapsed. No amount: the
       * contract pays out whatever was requested. */
      kind: "completeStableWithdrawal";
      kafUSD: string;
      outputToken: string;
      outputSymbol: string;
    }
  | {
      kind: "claimStableYield";
      yieldTreasury: string;
      asset: string;
      assetSymbol: string;
    }
  | {
      /** Claims kfUSD yield and leaves it ready to re-lock, in one call. */
      kind: "compoundStableYield";
      yieldTreasury: string;
      kfUSD: string;
    }
  /* ------------------------------------------------------------- pool -- */
  /*
   * Deliberately narrow: only actions on an EXISTING position. Opening one
   * (mint) needs a tick range, which is why the app built a visual range
   * picker for it (pool/new) — a chat-typed range is a worse UX and a real
   * correctness risk (wrong ticks silently opens the position out of range,
   * earning nothing), not a data gap like the marketplace reads were. Minting
   * stays a manual, on-page action; only remove/collect are commands.
   */
  | {
      kind: "collectPoolFees";
      positionManager: string;
      tokenId: string;
      pairLabel: string;
    }
  | {
      /** decreaseLiquidity — always to zero, matching the Pool page's own
       * "Remove liquidity" button, which has no partial-removal option either. */
      kind: "decreasePoolLiquidity";
      positionManager: string;
      tokenId: string;
      liquidity: string;
      pairLabel: string;
    }
  | {
      kind: "grantAgentPermission";
      /** Diamond address exposing AgentPermissionFacet. */
      diamond: string;
      agent: string;
      maxNotionalPerAction: string;
      maxNotionalPerEpoch: string;
      epochDurationSec: number;
      expiryUnix: number;
      maxInterestBps: number;
      minHealthFactorBps: number;
      /** Bitmask of ACTION_* flags. */
      allowedActions: number;
      tokens: string[];
    };

/** AgentPermissionFacet action bitmask (mirrors LibAgentPermission). */
export const AGENT_ACTIONS = {
  BORROW: 1,
  LEND: 2,
  REPAY: 4,
  DEPOSIT_COLLATERAL: 8,
  WITHDRAW_COLLATERAL: 16,
  CLOSE: 32,
} as const;

export type IntentKind = Intent["kind"];

/** Narrow an Intent to a specific kind. */
export type IntentOf<K extends IntentKind> = Extract<Intent, { kind: K }>;

/**
 * Everything a resolver needs to sign and send, gathered once by the caller.
 * The signer is built the app-standard way (thirdweb ethers6 adapter) in
 * useResolverContext, so resolvers stay free of React and wallet-stack details.
 */
export interface ResolverContext {
  signer: ethers.Signer;
  address: string;
  chainId: number;
}

/** How a step reads. Pure — derived from the intent alone, no I/O. */
export interface IntentView {
  title: string;
  detail?: string;
  /** Optional chain label, for cross-chain plans where legs differ. */
  chain?: string;
}

export interface IntentResult {
  /** Tx hash, or null when the step was a no-op (e.g. allowance already set). */
  hash: string | null;
  /** Set when the step did nothing, so the UI can say "already approved". */
  skipped?: boolean;
}

export interface IntentDef<K extends IntentKind = IntentKind> {
  render: (intent: IntentOf<K>) => IntentView;
  resolve: (ctx: ResolverContext, intent: IntentOf<K>) => Promise<IntentResult>;
}
