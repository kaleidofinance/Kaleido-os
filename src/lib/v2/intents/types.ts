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
      /* ------------------------------------------------- native currency -- */
      /*
       * THE ADDRESSES ARE ALWAYS WRAPPED, THE SYMBOLS ARE ALWAYS THE USER'S.
       *
       * A native swap carries WETH9's address in `tokenIn`/`tokenOut` and "ETH"
       * in `symbolIn`/`symbolOut`, and these two flags say which end was native.
       * The split is what makes the transaction both valid and legible: the
       * router's parameters have to name a real ERC20 — there is no sentinel
       * handling anywhere in the V3 periphery, and passing 0xEeee… produces a
       * revert that reads as "no pool" — while the row the user signs has to name
       * the asset that actually leaves their wallet.
       *
       * NO CONTRACT CHANGE WAS NEEDED FOR EITHER, which is worth recording
       * because this union used to say native was unsupported. Checked against
       * smart-contract/contracts/dex-v3/periphery: `PeripheryPayments.pay()`
       * wraps `msg.value` itself when the token it is asked to pull is WETH9;
       * `unwrapWETH9(uint256,address)` and `refundETH()` are both deployed; and
       * `Multicall.multicall` is `payable` and uses `delegatecall`, so `msg.sender`
       * and `msg.value` survive into the swap. What was missing was on this side.
       */
      /**
       * Selling the chain's own currency: the amount rides as `value` and there
       * is no approve step.
       *
       * The absent approve is the load-bearing half. `build.ts` used to emit one
       * unconditionally, so a native sell called `allowance()` on the sentinel —
       * an address with no code — and threw after the user had already committed
       * to the plan. There is nothing to authorise here: the router wraps value
       * it was sent rather than pulling a balance it was permitted to move.
       */
      nativeIn?: boolean;
      /**
       * Wanting the chain's own currency back: the pool pays WETH9 and the
       * router unwraps it in the same transaction.
       *
       * Still one signature. The resolver sends
       * `multicall([exactInputSingle, unwrapWETH9(amountOutMin, user)])` with the
       * swap's recipient left as the router, because a token that has to be
       * unwrapped cannot be paid to the user first — and `unwrapWETH9` reverts
       * rather than short-paying when the router holds less than the floor.
       */
      nativeOut?: boolean;
    }
  /*
   * A swap through more than one pool, in one transaction.
   *
   * A SEPARATE KIND RATHER THAN `swap` WITH AN OPTIONAL PATH, and the reason is
   * the calldata: this calls `exactInput`, which takes a packed byte string, where
   * `swap` calls `exactInputSingle`, which takes a tuple of named fields. Folding
   * them together would mean a resolver branching on whether an optional array is
   * present to choose between two different router functions, and an auditor rule
   * that has to check `fee` OR `fees` depending on a field's absence. Two kinds
   * cost one more entry in three total records and keep both rules readable.
   *
   * NOT A CHAIN OF `swap` STEPS EITHER, which is the other shape this could have
   * taken — `swapRoute()` in agentTurn.ts already renders several `swap` intents
   * as one path, so the display layer would have accepted it. It is wrong for the
   * money: N chained swaps are N signatures and N transactions, each with its own
   * floor and its own chance to land while the next is still unsigned, so a user
   * who signs the first and rejects the second is left holding an intermediate
   * token they never asked for. `exactInput` is one signature that either
   * completes the whole path or reverts, and the intermediate never touches the
   * wallet.
   *
   * Native currency is supported at both ends, by the same wrapped-address /
   * user-symbol split the `swap` kind documents above: the packed path names
   * WETH9 because that is the token the first pool holds, and `nativeIn` /
   * `nativeOut` say which end the user actually handed over or wants back. This
   * comment used to claim the opposite — that a path could not take ETH and that
   * the refusal named `wrapNative` so a retry could succeed. Both halves were
   * false: nothing in this app has ever registered a `wrapNative` intent, and the
   * only thing missing for native was the substitution, not a contract.
   */
  | {
      kind: "swapMultiHop";
      /**
       * The pools, in order. Length >= 2 — a one-hop route is a `swap`, not this,
       * and the auditor rejects a single-element path so the two kinds cannot
       * describe the same transaction.
       */
      hops: readonly {
        tokenIn: string;
        tokenOut: string;
        symbolIn: string;
        symbolOut: string;
        fee: number;
      }[];
      /**
       * The encoded path the router is actually called with.
       *
       * Carried rather than derived in the resolver so that what the auditor
       * checks is the bytes that get signed. `encodeV3Path` is deterministic over
       * `hops`, and the auditor re-encodes and compares — which is what makes a
       * path auditable at all: nobody can read a 43-byte hex string and tell
       * whether it is the route the summary described.
       */
      path: string;
      amountIn: string;
      amountOutMin: string;
      /** Decimals of the FIRST hop's input, for parsing `amountIn`. */
      decimalsIn: number;
      /** Decimals of the LAST hop's output, for parsing `amountOutMin`. */
      decimalsOut: number;
      symbolIn: string;
      symbolOut: string;
      /** Same router the paired `approve` authorises. See `swap`'s note. */
      spender: string;
      /** Transaction deadline in minutes. Defaults to 20 if omitted. */
      deadlineMin?: number;
      /**
       * The first hop's input is the chain's own currency. See `swap.nativeIn` —
       * identical meaning, and the first hop's `tokenIn` is WETH9 either way.
       */
      nativeIn?: boolean;
      /**
       * The last hop's output should be paid out as the chain's own currency.
       * See `swap.nativeOut`. The multicall wraps `exactInput` rather than
       * `exactInputSingle`; nothing else differs.
       */
      nativeOut?: boolean;
    }
  | {
      kind: "stake";
      /** Vault contract address (stakingContracts(chainId).kldVault). */
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
   * Native currency is one signature; an ERC20 is two. A native deposit carries
   * the amount as `value` with nothing to pre-authorise, which is what used to
   * let it sidestep the approve auditor's spender pin — that rule trusted only
   * Kaleido contracts, and a bridge router is not one. It now recognises one
   * vetted router as well, so a token leg emits an approve to `spender` ahead of
   * this step. `spender` is the resolver's, checked there against that same
   * allowlist AND against `to`; the bridge rule re-checks both, which is what
   * makes an allowance to a contract we do not own auditable rather than trusted.
   */
  | {
      kind: "bridge";
      /** Portal or aggregator router on the SOURCE chain. From the resolver, never the model. */
      to: string;
      /** Calldata for `to`; "0x" for a bare-value deposit. */
      data: string;
      /** Wei to send with the transaction, as a decimal string. */
      value: string;
      /** The asset leaving the wallet — a native sentinel, or a token contract. */
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
       * The router the paired `approve` authorises, on an ERC20 leg. Unset for a
       * native one, which has no approve. Equal to `to` by construction — the
       * resolver refuses a quote whose approval address is not the contract its
       * own transaction calls — and the auditor re-checks that equality, so an
       * allowance can never be split off to an address this step does not call.
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
  /*
   * Adding to a position that already exists.
   *
   * Separate from `mintPoolPosition` because the position, not the caller, owns
   * every decision a mint has to make: the pair, the tier and the range are all
   * already in storage, and `increaseLiquidity` takes only a tokenId and two
   * amounts. Nothing here names a tick, and there is deliberately no field
   * through which one could be named — the range cannot be changed by adding to
   * a position, and a kind that appeared to accept one would be lying.
   *
   * THE AMOUNTS ARE IN THE POOL'S OWN token0/token1 ORDER, not the caller's, and
   * that is the one thing about this kind worth reading twice. `mintPoolPosition`
   * carries caller-frame amounts and crosses into the pool's frame once, in the
   * resolver, via `sortMintParams` — it has to, because a mint is where the
   * caller's order is the only order there is. Here the pool's order is already
   * known: it is `positions(tokenId).token0`, read off the chain. So the builder
   * maps the user's two symbols onto that pair and stores them sorted, and the
   * resolver does no crossing at all. Getting this backwards does not revert; it
   * deposits the pair upside down, which either takes far less than asked or
   * reverts on the floor with no explanation of why.
   *
   * No native currency, for `mintPoolPosition`'s reason: the position manager
   * reverts when native value arrives beside a wrapped leg.
   */
  | {
      kind: "increasePoolLiquidity";
      positionManager: string;
      tokenId: string;
      /** Pool frame — `token0 < token1`, exactly as `positions()` reports them. */
      token0: string;
      token1: string;
      decimals0: number;
      decimals1: number;
      symbol0: string;
      symbol1: string;
      /** Human amounts, pool order. */
      amount0: string;
      amount1: string;
      /** Slippage floor from `mintMinimums` over the position's own range. */
      amount0Min: string;
      amount1Min: string;
      /** The tier and range being added to. Display only — the contract reads
       * both from the position itself, so these cannot disagree with it. */
      fee: number;
      lowerPrice: number;
      upperPrice: number;
      pairLabel: string;
      /** Transaction deadline in minutes. Defaults to 20 if omitted. */
      deadlineMin?: number;
    }
  | {
      /**
       * decreaseLiquidity, for all of a position or part of it.
       *
       * `liquidity` is the exact uint128 the contract is asked to burn, computed
       * by the builder — the full `pos.liquidity` by default, or a fraction of it
       * when the caller named a percentage. It used to only ever be the whole of
       * it, matching the Pool page's own button, which had no partial option
       * either; both now do.
       *
       * `percent` is the SAME decision expressed for the confirmation row, and it
       * is display-only: `liquidity` is what gets sent, so the row can be wrong
       * about the fraction without loosening anything. It exists because the
       * fraction is not recoverable from `liquidity` alone — the renderer never
       * sees the position's total — and "Remove liquidity" that silently means
       * "all of it" is the wrong sentence to put above a signature.
       */
      kind: "decreasePoolLiquidity";
      positionManager: string;
      tokenId: string;
      liquidity: string;
      pairLabel: string;
      /** 1–100. Absent means the whole position. Display only — see above. */
      percent?: number;
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
