import { ethers } from "ethers";
import { formatInterestRate } from "@/constants/utils/FormatInterestRate";
import agentPermissionAbi from "@/abi/AgentPermissionFacet.json";
import { getContracts } from "@/constants/registry";
import { initialSqrtPriceX96, sortMintParams } from "@/lib/dex/liquidity";
import { register } from "./registry";

/**
 * Intent definitions. Each pairs a pure renderer with a resolver that builds an
 * ethers contract from ctx.signer and sends — the same execution shape the
 * legacy hooks use internally, just decoupled from React so the registry can
 * drive it. Importing this module registers everything (see ./index).
 */

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

const V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
];

const VAULT_ABI = [
  "function deposit(address token, address stToken, uint256 amount) external",
];

// Minimal ProtocolFacet surface. Written out rather than imported from the full
// ABI JSON so a resolver's calldata is readable next to the intent that builds
// it, matching how the router and vault ABIs above are handled.
const PROTOCOL_ABI = [
  "function depositCollateral(address token, uint256 amount) external payable",
  "function withdrawCollateral(address token, uint256 amount) external",
  "function repayLoan(uint96 requestId, uint256 amount) external payable",
  "function createLendingRequest(uint256 amount, uint16 interest, uint256 returnDate, address token) external",
  "function createLoanListing(uint256 amount, uint256 minAmount, uint256 maxAmount, uint256 returnDate, uint16 interest, address token) external payable",
  "function requestLoanFromListing(uint96 listingId, uint256 amount) external",
  "function serviceRequest(uint96 requestId, address token) external payable",
  "function closeListingAd(uint96 listingId) external",
  "function closeRequest(uint96 requestId) external",
];

const KFUSD_ABI = [
  "function mint(address to, uint256 kfUsdAmount, address collateralToken, uint256 collateralAmount) external",
  "function redeem(uint256 amount, address outputToken) external",
];

const KAFUSD_ABI = [
  "function lockAssets(address assetToken, uint256 amount) external",
  "function requestWithdrawal(uint256 amount) external",
  "function completeWithdrawal(address outputToken) external",
];

const YIELD_TREASURY_ABI = [
  "function claimYield(address asset) external",
  "function claimAndCompound(address asset) external",
];

// collect and decreaseLiquidity need no tick math; mint and the pool
// initialiser do, which is why `lib/dex/liquidity.ts` exists and why the two
// tuples below are spelled out in full rather than shared with useV3Positions.
const POSITION_MANAGER_ABI = [
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

// uint128 max — "collect everything owed," matching useV3Positions.ts's own
// collectFees/removeLiquidity, not a value invented for this file.
const UINT128_MAX = "340282366920938463463374607431768211455";

// No `amount` in either. KaleidoTokenFaucet fixes the drip per asset, so the
// caller chooses which tokens and nothing else — see Faucet.sol.
const FAUCET_ABI = [
  "function claim(address token) external",
  "function claimMany(address[] tokens) external returns (uint256 paid)",
];

/* ---------------------------------------------------------------- approve -- */
register("approve", {
  render: (i) => ({
    title: `Approve ${i.symbol}`,
    detail:
      "Lets the contract move this token on your behalf. One-time per token.",
  }),
  resolve: async (ctx, i) => {
    const token = new ethers.Contract(i.token, ERC20_ABI, ctx.signer);
    const needed = ethers.parseUnits(i.amount, i.decimals);

    // No-op when the allowance already covers it — cheaper and clearer than a
    // redundant approval. The step shows as "already approved".
    const current: bigint = await token.allowance(ctx.address, i.spender);
    if (current >= needed) return { hash: null, skipped: true };

    const tx = await token.approve(i.spender, needed);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* ------------------------------------------------------------------- swap -- */
register("swap", {
  render: (i) => ({
    title: `Swap ${i.amountIn} ${i.symbolIn} for ${i.symbolOut}`,
    detail: `Minimum received ${i.amountOutMin} ${i.symbolOut} at the set slippage.`,
  }),
  resolve: async (ctx, i) => {
    // `i.spender` is the V3 router for the chain this intent was built on
    // (getContracts(chainId).v3Router). It equals the paired approve step's
    // spender by construction — see the Intent type.
    const router = new ethers.Contract(i.spender, V3_ROUTER_ABI, ctx.signer);
    const deadline = Math.floor(Date.now() / 1000) + 60 * (i.deadlineMin ?? 20);
    const tx = await router.exactInputSingle({
      tokenIn: i.tokenIn,
      tokenOut: i.tokenOut,
      fee: i.fee,
      recipient: ctx.address,
      deadline,
      amountIn: ethers.parseUnits(i.amountIn, i.decimalsIn),
      amountOutMinimum: ethers.parseUnits(i.amountOutMin, i.decimalsOut),
      sqrtPriceLimitX96: 0,
    });
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* ------------------------------------------------------------------ stake -- */
register("stake", {
  render: (i) => ({
    title: `Stake ${i.amount} ${i.symbol}`,
    detail: "Deposits into the KLD vault and mints liquid stKLD.",
  }),
  resolve: async (ctx, i) => {
    const vault = new ethers.Contract(i.vault, VAULT_ABI, ctx.signer);
    const amount = ethers.parseUnits(i.amount, 18);
    const tx = await vault.deposit(i.token, i.stToken, amount);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* --------------------------------------------------------------- transfer -- */
/*
 * The one resolver that calls nothing of ours. Native leaves as a bare value
 * transaction; an ERC20 goes straight to the token's own `transfer`.
 *
 * No allowance branch, unlike approve above, and not an omission: a transfer
 * moves the caller's own balance, so there is nothing to pre-authorise and no
 * redundant step that could ever be skipped.
 */
register("transfer", {
  render: (i) => ({
    title: `Send ${i.amount} ${i.symbol}`,
    /*
     * The full address, deliberately, where grantAgentPermission below
     * abbreviates its agent. Address-poisoning attacks work by seeding your
     * history with an address whose first and last four hex digits match your
     * intended recipient, so a `0x1234…abcd` row renders the attacker's
     * address and the real one identically. The only display that defeats that
     * is the whole thing, and this is the one row where getting it wrong costs
     * the balance rather than a permission scope.
     */
    detail: `To ${i.to}. Irreversible once signed.`,
  }),
  resolve: async (ctx, i) => {
    const value = ethers.parseUnits(i.amount, i.decimals);

    /* `i.token` is deliberately unused here. There is no contract to address,
       and naming either NATIVE_SENTINEL convention would imply a protocol this
       transaction does not touch. */
    if (i.isNative) {
      const tx = await ctx.signer.sendTransaction({ to: i.to, value });
      await tx.wait();
      return { hash: tx.hash };
    }

    const token = new ethers.Contract(i.token, ERC20_ABI, ctx.signer);
    const tx = await token.transfer(i.to, value);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* ------------------------------------------------------------- lending -- */

const pct = (n: number) => `${n}%`;
const onDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

register("depositCollateral", {
  render: (i) => ({
    title: `Deposit ${i.amount} ${i.symbol} as collateral`,
    detail:
      "Backs what you borrow. Withdrawable while your health factor allows.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const amount = ethers.parseUnits(i.amount, i.decimals);
    // Native collateral rides along as value; an ERC20 was already approved by
    // the approve step this plan pairs it with.
    const tx = await protocol.depositCollateral(
      i.token,
      amount,
      i.isNative ? { value: amount } : {},
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("withdrawCollateral", {
  render: (i) => ({
    title: `Withdraw ${i.amount} ${i.symbol} collateral`,
    detail: "Reverts if it would push your health factor below the minimum.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.withdrawCollateral(
      i.token,
      ethers.parseUnits(i.amount, i.decimals),
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("repayLoan", {
  render: (i) => ({
    title: `Repay ${i.amount} ${i.symbol}`,
    detail: `Closes loan #${i.requestId} in full, principal plus interest.`,
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    // Already in base units: the repayment figure comes from the contract, so
    // re-deriving it from a display string could round the loan short and
    // leave it open.
    const amount = BigInt(i.amountRaw);
    const tx = await protocol.repayLoan(
      i.requestId,
      amount,
      i.isNative ? { value: amount } : {},
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("createLendingRequest", {
  render: (i) => ({
    title: `Request to borrow ${i.amount} ${i.symbol}`,
    detail: `At ${pct(i.interestPct)} until ${onDate(i.returnDate)}. Fills when a lender takes it.`,
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.createLendingRequest(
      ethers.parseUnits(i.amount, i.decimals),
      formatInterestRate(i.interestPct),
      i.returnDate,
      i.token,
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("createLoanListing", {
  render: (i) => ({
    title: `Offer ${i.amount} ${i.symbol} to lend`,
    detail: `At ${pct(i.interestPct)} until ${onDate(i.returnDate)}. Borrowers may draw ${i.minAmount} to ${i.maxAmount}.`,
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const amount = ethers.parseUnits(i.amount, i.decimals);
    const tx = await protocol.createLoanListing(
      amount,
      ethers.parseUnits(i.minAmount, i.decimals),
      ethers.parseUnits(i.maxAmount, i.decimals),
      i.returnDate,
      formatInterestRate(i.interestPct),
      i.token,
      i.isNative ? { value: amount } : {},
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("borrowFromListing", {
  render: (i) => ({
    title: `Borrow ${i.amount} ${i.symbol} from listing #${i.listingId}`,
    detail: "Draws against an existing offer at its posted rate and term.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.requestLoanFromListing(
      i.listingId,
      ethers.parseUnits(i.amount, i.decimals),
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("fillRequest", {
  render: (i) => ({
    title: `Lend ${i.amount} ${i.symbol} to request #${i.requestId}`,
    detail:
      "Sends the principal now and takes on the loan at its posted terms.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.serviceRequest(
      i.requestId,
      i.token,
      i.isNative ? { value: ethers.parseUnits(i.amount, i.decimals) } : {},
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("closeListing", {
  render: (i) => ({
    title: `Cancel listing #${i.listingId}`,
    detail: "Withdraws the offer and returns any unlent balance.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.closeListingAd(i.listingId);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("closeRequest", {
  render: (i) => ({
    title: `Cancel request #${i.requestId}`,
    detail: "Removes your borrow request before a lender fills it.",
  }),
  resolve: async (ctx, i) => {
    const protocol = new ethers.Contract(i.diamond, PROTOCOL_ABI, ctx.signer);
    const tx = await protocol.closeRequest(i.requestId);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* ---------------------------------------------------------- stablecoin -- */

register("mintStable", {
  render: (i) => ({
    title: `Mint ${i.collateralAmount} kfUSD`,
    detail: `Backed 1:1 by ${i.collateralAmount} ${i.collateralSymbol} collateral.`,
  }),
  resolve: async (ctx, i) => {
    const kfUSDContract = new ethers.Contract(i.kfUSD, KFUSD_ABI, ctx.signer);
    const collateralAmount = ethers.parseUnits(
      i.collateralAmount,
      i.collateralDecimals,
    );
    // Matches useStablecoin.ts's own scaling exactly, rather than inventing a
    // different one: kfUSD is 18 decimals, so a 6-decimal collateral amount is
    // scaled up by 10^12 to land at a 1:1 nominal mint.
    const kfUSDAmount =
      collateralAmount * ethers.parseUnits("1", 18 - i.collateralDecimals);
    const tx = await kfUSDContract.mint(
      ctx.address,
      kfUSDAmount,
      i.collateralToken,
      collateralAmount,
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("redeemStable", {
  render: (i) => ({
    title: `Redeem ${i.amount} kfUSD for ${i.outputSymbol}`,
    detail: "Burns kfUSD and returns the underlying collateral.",
  }),
  resolve: async (ctx, i) => {
    const kfUSDContract = new ethers.Contract(i.kfUSD, KFUSD_ABI, ctx.signer);
    const tx = await kfUSDContract.redeem(
      ethers.parseUnits(i.amount, 18),
      i.outputToken,
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("lockStable", {
  render: (i) => ({
    title: `Lock ${i.amount} kfUSD in the yield vault`,
    detail:
      "Mints kafUSD 1:1. Exiting later needs a cooldown before it pays out.",
  }),
  resolve: async (ctx, i) => {
    const kafUSDContract = new ethers.Contract(
      i.kafUSD,
      KAFUSD_ABI,
      ctx.signer,
    );
    const tx = await kafUSDContract.lockAssets(
      i.kfUSD,
      ethers.parseUnits(i.amount, 18),
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("requestStableWithdrawal", {
  render: (i) => ({
    title: `Request withdrawal of ${i.amount} kafUSD`,
    detail: "Starts the cooldown. Nothing pays out until it completes.",
  }),
  resolve: async (ctx, i) => {
    const kafUSDContract = new ethers.Contract(
      i.kafUSD,
      KAFUSD_ABI,
      ctx.signer,
    );
    const tx = await kafUSDContract.requestWithdrawal(
      ethers.parseUnits(i.amount, 18),
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("completeStableWithdrawal", {
  render: (i) => ({
    title: `Complete withdrawal to ${i.outputSymbol}`,
    detail: "Reverts if the cooldown hasn't elapsed yet.",
  }),
  resolve: async (ctx, i) => {
    const kafUSDContract = new ethers.Contract(
      i.kafUSD,
      KAFUSD_ABI,
      ctx.signer,
    );
    const tx = await kafUSDContract.completeWithdrawal(i.outputToken);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("claimStableYield", {
  render: (i) => ({
    title: `Claim ${i.assetSymbol} yield`,
    detail: "Pays out accrued yield without touching your principal.",
  }),
  resolve: async (ctx, i) => {
    const treasury = new ethers.Contract(
      i.yieldTreasury,
      YIELD_TREASURY_ABI,
      ctx.signer,
    );
    const tx = await treasury.claimYield(i.asset);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("compoundStableYield", {
  render: () => ({
    title: "Claim and compound kfUSD yield",
    detail:
      "Claims what's accrued and leaves it ready to lock back into the vault.",
  }),
  resolve: async (ctx, i) => {
    const treasury = new ethers.Contract(
      i.yieldTreasury,
      YIELD_TREASURY_ABI,
      ctx.signer,
    );
    const tx = await treasury.claimAndCompound(i.kfUSD);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* --------------------------------------------------------------- pool -- */

/**
 * Opening a concentrated position.
 *
 * Two things happen here that no other resolver in this file does, and both are
 * deliberate.
 *
 * It crosses frames. Everything on the intent is in the caller's token order —
 * the order the amounts were typed and the order the price bounds are labelled
 * with — and the pool only understands `token0 < token1`. `sortMintParams` is the
 * single crossing, and it moves the ticks and the amounts together; doing half of
 * it mints the mirror image of the range asked for, which succeeds and then earns
 * nothing.
 *
 * And it may send two transactions. A pool that doesn't exist has to be
 * initialised before it can be minted into, and the factory is re-read here
 * rather than trusted from `createsPool`: a pool created by somebody else between
 * planning and signing would make the plan's flag stale in the direction that
 * matters, and `createAndInitializePoolIfNecessary` would then be a no-op paid
 * for in gas. The returned hash is the mint's — that is the transaction that
 * opens the position.
 *
 * No `value`, ever. `NonfungiblePositionManager` reverts when native currency
 * arrives beside a WETH leg, so the wrapped token is the only thing that reaches
 * this point; build.ts refuses native by name before a plan is built.
 */
register("mintPoolPosition", {
  render: (i) => {
    /*
     * Six significant digits, trailing zeros trimmed. The minimums are exact
     * base-unit strings formatted at the token's own decimals, which for an
     * 18-decimal leg means the row read "At least 1.011174111964746435 WETH" —
     * every digit true and none of them information. Trimmed here in the view
     * only: the intent's own `amount0Min` is what gets parsed and sent, so
     * shortening the label cannot loosen the floor.
     *
     * The dot check is not decoration. `toPrecision(6)` on 100000 returns
     * "100000" with no decimal point, and stripping trailing zeros off that
     * would print a range bound of 1.
     */
    const sig = (n: number | string) => {
      const s = Number(n).toPrecision(6);
      return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
    };
    const range = i.createsPool
      ? `Opens the pool at ${sig(Number(i.amount1) / Number(i.amount0))} ${i.symbol1}/${i.symbol0}`
      : `Range ${sig(i.lowerPrice)} – ${sig(i.upperPrice)} ${i.symbol1} per ${i.symbol0}`;
    return {
      title: `Add ${i.amount0} ${i.symbol0} + ${i.amount1} ${i.symbol1} to the ${i.fee / 10_000}% pool`,
      detail: `${range}. At least ${sig(i.amount0Min)} ${i.symbol0} and ${sig(i.amount1Min)} ${i.symbol1} must be taken, or it reverts.`,
    };
  },
  resolve: async (ctx, i) => {
    const posManager = new ethers.Contract(
      i.positionManager,
      POSITION_MANAGER_ABI,
      ctx.signer,
    );

    const p = sortMintParams({
      token0: i.token0,
      token1: i.token1,
      fee: i.fee,
      tickLower: i.tickLower,
      tickUpper: i.tickUpper,
      amount0: i.amount0,
      amount1: i.amount1,
      amount0Min: i.amount0Min,
      amount1Min: i.amount1Min,
      decimals0: i.decimals0,
      decimals1: i.decimals1,
    });

    const desired0 = ethers.parseUnits(p.amount0, p.decimals0);
    const desired1 = ethers.parseUnits(p.amount1, p.decimals1);

    const v3Factory = getContracts(ctx.chainId).v3Factory;
    if (v3Factory) {
      const factory = new ethers.Contract(
        v3Factory,
        V3_FACTORY_ABI,
        ctx.signer,
      );
      const existing: string = await factory.getPool(p.token0, p.token1, p.fee);
      if (!existing || existing === ethers.ZeroAddress) {
        const initTx = await posManager.createAndInitializePoolIfNecessary(
          p.token0,
          p.token1,
          p.fee,
          initialSqrtPriceX96(desired0, desired1),
        );
        await initTx.wait();
      }
    }

    const deadline =
      Math.floor(Date.now() / 1000) + 60 * (i.deadlineMin ?? 20);
    /* Positional array rather than an object, matching useV3PositionManager:
       ethers v6 resolves a single-tuple parameter more reliably from one. */
    const tx = await posManager.mint([
      p.token0,
      p.token1,
      p.fee,
      p.tickLower,
      p.tickUpper,
      desired0,
      desired1,
      ethers.parseUnits(p.amount0Min, p.decimals0),
      ethers.parseUnits(p.amount1Min, p.decimals1),
      ctx.address,
      BigInt(deadline),
    ]);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("collectPoolFees", {
  render: (i) => ({
    title: `Collect fees on ${i.pairLabel} #${i.tokenId}`,
    detail: "Pays out accrued fees. The position itself is untouched.",
  }),
  resolve: async (ctx, i) => {
    const posManager = new ethers.Contract(
      i.positionManager,
      POSITION_MANAGER_ABI,
      ctx.signer,
    );
    const tx = await posManager.collect({
      tokenId: BigInt(i.tokenId),
      recipient: ctx.address,
      amount0Max: BigInt(UINT128_MAX),
      amount1Max: BigInt(UINT128_MAX),
    });
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("decreasePoolLiquidity", {
  render: (i) => ({
    title: `Remove liquidity from ${i.pairLabel} #${i.tokenId}`,
    detail:
      "Withdraws the full position. Fees owed are collected in the next step.",
  }),
  resolve: async (ctx, i) => {
    const posManager = new ethers.Contract(
      i.positionManager,
      POSITION_MANAGER_ABI,
      ctx.signer,
    );
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
    const tx = await posManager.decreaseLiquidity({
      tokenId: BigInt(i.tokenId),
      liquidity: BigInt(i.liquidity),
      // No slippage floor, matching useV3Positions.ts's own removeLiquidity —
      // not a protection this file is weakening relative to the live button.
      amount0Min: BigInt(0),
      amount1Min: BigInt(0),
      deadline,
    });
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* ----------------------------------------------- grantAgentPermission -- */
register("grantAgentPermission", {
  render: (i) => ({
    title: `Delegate to ${i.agent.slice(0, 6)}…${i.agent.slice(-4)}`,
    /*
     * The health floor divides by 10000, not 100. This read `/ 100` and so
     * printed a 15000 bps floor as "150.00" — a hundred times the number, on the
     * one row that tells the user how much loss their delegate is allowed to
     * take them toward. Three sources agree on the scale and none of them is
     * this line: AgentPermissionFacet.sol:50 documents the parameter as "Health
     * floor in BPS (10000 = 1.0)", AgentSettings.tsx:112 converts the user's
     * setting with `settings.minHealthFactor * 10_000`, and auditor.ts:1161
     * already reports the same field as `(hfBps / 10_000).toFixed(2)`. Bps to a
     * ratio is 10000; bps to a percent is 100, and a health factor is not a
     * percentage.
     */
    detail: `Up to $${i.maxNotionalPerAction} per action, $${i.maxNotionalPerEpoch} per period, health floor ${(i.minHealthFactorBps / 10_000).toFixed(2)}. Revocable any time.`,
  }),
  resolve: async (ctx, i) => {
    const facet = new ethers.Contract(
      i.diamond,
      agentPermissionAbi,
      ctx.signer,
    );
    // USD notional is 1e18-scaled on-chain, matching the facet's units.
    const tx = await facet.grantAgentPermission(
      i.agent,
      ethers.parseUnits(i.maxNotionalPerAction, 18),
      ethers.parseUnits(i.maxNotionalPerEpoch, 18),
      BigInt(i.epochDurationSec),
      BigInt(i.expiryUnix),
      i.maxInterestBps,
      i.minHealthFactorBps,
      i.allowedActions,
      i.tokens,
    );
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* --------------------------------------------------------------- faucet -- */
/*
 * No approve step above this one, unlike every other transfer in this file.
 * The faucet sends its own balance to the caller, so there is no allowance for
 * the user to grant — and adding a no-op approval step would make the review
 * list claim a signature the transaction never needs.
 */
register("claimTestTokens", {
  render: (i) => ({
    title: `Claim ${i.amount} ${i.symbol}`,
    detail:
      "Paid out by the testnet faucet. The amount is fixed per asset, and a cooldown applies before the next claim.",
  }),
  resolve: async (ctx, i) => {
    const faucet = new ethers.Contract(i.faucet, FAUCET_ABI, ctx.signer);
    const tx = await faucet.claim(i.token);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/*
 * One transaction for the whole list, and no approve step for the same reason as
 * above.
 *
 * The number of assets is bounded by what the chain's faucet lists — six at the
 * most, on Arc — so the loop inside `claimMany` cannot grow past a block. That is
 * why the contract has no `claimAll()` for the caller to use instead: it would
 * iterate the faucet's append-only asset array, which does grow without bound.
 */
register("claimAllTestTokens", {
  render: (i) => ({
    title: `Claim ${i.tokens.length} assets`,
    detail:
      i.payouts.join(", ") +
      ". Paid out by the testnet faucet in one transaction. Anything that stops being claimable before the transaction lands is skipped rather than failing the rest.",
  }),
  resolve: async (ctx, i) => {
    const faucet = new ethers.Contract(i.faucet, FAUCET_ABI, ctx.signer);
    const tx = await faucet.claimMany(i.tokens);
    await tx.wait();
    return { hash: tx.hash };
  },
});
