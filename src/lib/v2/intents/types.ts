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
      /**
       * The V3 router this swap routes through — `getContracts(chainId).v3Router`,
       * resolved per chain. Named to match the paired `approve` step's `spender`
       * because the two must be the same address: the approve authorises exactly
       * the router the swap then calls. Required, so a swap intent can never reach
       * the resolver without naming the router it will hit — the resolver used to
       * hardcode one Abstract-testnet router for every chain, which is the bug this
       * removes.
       */
      spender: string;
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
  /* --------------------------------------------------------- transfer -- */
  /*
   * A plain wallet-to-wallet send — the only intent in this union that calls no
   * Kaleido contract. An ERC20 goes straight to the token's own `transfer`; the
   * native currency goes out as a bare value transaction with no calldata.
   *
   * That is why it carries no `diamond` field, and it has a consequence worth
   * stating here rather than discovering later: the agent mandate in
   * AgentPermissionFacet cannot scope a send. LibAgentPermission.enforce() runs
   * *inside* diamond calls, and this transaction never enters the diamond. A
   * send is bounded before signing or not at all, which is what the auditor
   * rule for this kind exists to do.
   */
  | {
      kind: "transfer";
      /** Token contract. Unused when `isNative` — see the resolver. */
      token: string;
      /** Recipient. Checksum-validated in build.ts, not trusted from here. */
      to: string;
      amount: string;
      decimals: number;
      symbol: string;
      /** True for the chain's native currency: sent as value, no calldata. */
      isNative?: boolean;
    }
  /* ----------------------------------------------------------- bridge -- */
  /*
   * A cross-chain move, and the second intent — after `transfer` — that calls
   * no Kaleido contract. The wallet signs one source-chain transaction: a bare
   * `value` send to a canonical portal, or an aggregator router's own calldata.
   * Because it never enters the diamond, LibAgentPermission.enforce() cannot
   * scope it and the auditor's per-action USD cap is the only bound — the same
   * shape as `transfer`, and the reason both share that rule's design.
   *
   * So `to`/`data`/`value` come from a TRUSTED resolver (a canonical constant or
   * a provider quote), never from the model, and the auditor re-checks `to`
   * against a known-bridge allowlist before it prices the notional.
   *
   * MVP is native-currency only. A native deposit sends `value` with no prior
   * approve, which is what lets it sidestep the approve auditor's spender pin —
   * that rule only trusts Kaleido contracts as spenders, and a bridge router is
   * not one. An ERC20 bridge would need an approve to the resolver's router and
   * a spine change teaching that pin about known routers; `spender` is the seam
   * left for it, and is unset here.
   */
  | {
      kind: "bridge";
      /** Portal or aggregator router on the SOURCE chain. From the resolver, never the model. */
      to: string;
      /** Calldata for `to`; "0x" for a bare-value deposit. */
      data: string;
      /** Wei to send with the transaction, as a decimal string. */
      value: string;
      /** The asset leaving the wallet — the native sentinel in the MVP. */
      token: string;
      /** Human amount, for the rendered row and the auditor's pricing. */
      amount: string;
      decimals: number;
      symbol: string;
      fromChainId: number;
      toChainId: number;
      /** Destination chain's display name, for the rendered row. */
      toChainName: string;
      /** "canonical" | "relay" | "lifi" — the trusted origin of `to`/`data`. */
      provider: string;
      /** Seconds, or null when genuinely unknown — never a fabricated ETA. */
      etaSeconds: number | null;
      /** True for the chain's native currency: sent as `value`, no approve. */
      isNative?: boolean;
      /**
       * Forward seam for the deferred ERC20 leg: the router an approve would
       * authorise. Unset in the native-only MVP, so no approve step is emitted.
       */
      spender?: string;
      /** Gas floor for a canonical deposit, which underruns estimateGas. */
      gasLimit?: string;
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
   * This section used to carry only actions on an EXISTING position, and the
   * reason it gave was a real one rather than a shrug: opening a position needs a
   * tick range, a wrong range silently opens it out of the market where it earns
   * nothing, and no revert tells anyone. A tick a model emits is unauditable —
   * there is no way to look at -73200 and know whether it is near the price.
   *
   * `mintPoolPosition` exists because that argument was against carrying a raw
   * tick pair, not against minting. What this kind carries is a range that was
   * *derived* from the pool's own live price by `lib/dex/liquidity.ts`: the
   * caller asks for full range, a ±band, or explicit prices, and the band's
   * centre is read from slot0 rather than proposed. The human bounds ride along
   * so the confirmation row states the two prices the position will sit between,
   * and `mintMinimums` sets a real slippage floor from the ratio the range
   * actually consumes at.
   *
   * Two things it deliberately does not do. It never opens a *narrow* first
   * position on a pool that does not exist yet — with no market to centre on, the
   * two amounts set the opening price, so a band would put the pool wherever the
   * amounts happened to land; that case is full-range or nothing. And it takes no
   * native currency: `NonfungiblePositionManager` reverts when native value
   * arrives beside a WETH leg, which is why the Pool page wraps first and why
   * this refuses ETH by name instead of half-supporting it.
   */
  | {
      kind: "mintPoolPosition";
      positionManager: string;
      /**
       * The pair in the CALLER's order, which is the order every other field
       * here is in too. The resolver crosses into the pool's address-sorted
       * frame once, via `sortMintParams`, moving ticks and amounts together.
       */
      token0: string;
      token1: string;
      decimals0: number;
      decimals1: number;
      symbol0: string;
      symbol1: string;
      fee: number;
      /** Caller-frame ticks, snapped to the tier's spacing before they got here. */
      tickLower: number;
      tickUpper: number;
      /** Human amounts, caller order. */
      amount0: string;
      amount1: string;
      /** Slippage floor, from `mintMinimums` — never zero, never the raw inputs. */
      amount0Min: string;
      amount1Min: string;
      /** The snapped range in prices, token1 per token0. Display only. */
      lowerPrice: number;
      upperPrice: number;
      /**
       * True when no pool exists at this pair and tier yet, so the transaction
       * initialises one at the ratio of the two amounts before minting. Display
       * only — the resolver re-checks the factory, because a pool created between
       * planning and signing would make this stale in the direction that matters.
       */
      createsPool: boolean;
      /** Transaction deadline in minutes. Defaults to 20 if omitted. */
      deadlineMin?: number;
    }
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
    }
  /* ----------------------------------------------------------- faucet -- */
  | {
      /**
       * Claim one asset's drip from KaleidoTokenFaucet.
       *
       * The only intent in this union that moves value *toward* the wallet
       * without a prior deposit, which is why it carries no allowance step and
       * no slippage floor: the faucet pays out of its own balance.
       */
      kind: "claimTestTokens";
      faucet: string;
      /** The mock ERC20 being claimed. */
      token: string;
      /**
       * The drip, human-readable, as the faucet reports it.
       *
       * Display only, and safely so: `claim(address)` takes no amount, so this
       * string cannot make the transaction pay out differently. It exists
       * because a review row reading "Claim USDT" tells the user nothing about
       * what they are about to receive.
       */
      amount: string;
      symbol: string;
    }
  | {
      /**
       * Claim every asset the faucet will currently pay this wallet, in one
       * transaction.
       *
       * A separate kind rather than the above with an array, because almost
       * nothing about it is the same: it calls `claimMany`, its summary counts
       * assets instead of naming one, and it can succeed having paid only some of
       * what it asked for. Folding the two together would mean a `token` field
       * holding a list and a `symbol` field holding the word "assets", which is
       * two fields lying about what they are.
       *
       * The single-asset kind above is NOT a batch of one. `claim` reverts with
       * the specific reason it could not pay — paused, on cooldown, out of
       * stock — where `claimMany` reverts with NothingClaimable, and with one
       * asset that distinction is the whole message. See Faucet.sol.
       */
      kind: "claimAllTestTokens";
      faucet: string;
      /**
       * The assets to attempt, in the order the faucet lists them.
       *
       * Every one is an address the faucet itself reported (see build.ts), never a
       * symbol resolved through the registry — most of these assets are in no
       * chain's token table.
       */
      tokens: readonly string[];
      /**
       * What each asset pays, human-readable, for the review row. Same length and
       * order as `tokens`.
       *
       * Display only, like `amount` above: `claimMany(address[])` carries no
       * amounts, so nothing here can change what is paid out. The transaction may
       * legitimately pay fewer than these — an asset that goes on cooldown between
       * the plan and the block is skipped rather than reverting the batch.
       */
      payouts: readonly string[];
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
