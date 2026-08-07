import { ethers } from "ethers";
import { KALEIDOSWAP_V3_ROUTER } from "@/constants/utils/addresses";
import { formatInterestRate } from "@/constants/utils/FormatInterestRate";
import agentPermissionAbi from "@/abi/AgentPermissionFacet.json";
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

// Same subset useV3Positions.ts calls — collect and decreaseLiquidity only,
// nothing that needs tick math.
const POSITION_MANAGER_ABI = [
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
];

// uint128 max — "collect everything owed," matching useV3Positions.ts's own
// collectFees/removeLiquidity, not a value invented for this file.
const UINT128_MAX = "340282366920938463463374607431768211455";

/* ---------------------------------------------------------------- approve -- */
register("approve", {
  render: (i) => ({
    title: `Approve ${i.symbol}`,
    detail: "Lets the contract move this token on your behalf. One-time per token.",
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
    const router = new ethers.Contract(KALEIDOSWAP_V3_ROUTER, V3_ROUTER_ABI, ctx.signer);
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
    detail: "Backs what you borrow. Withdrawable while your health factor allows.",
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
    detail: "Sends the principal now and takes on the loan at its posted terms.",
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
    const collateralAmount = ethers.parseUnits(i.collateralAmount, i.collateralDecimals);
    // Matches useStablecoin.ts's own scaling exactly, rather than inventing a
    // different one: kfUSD is 18 decimals, so a 6-decimal collateral amount is
    // scaled up by 10^12 to land at a 1:1 nominal mint.
    const kfUSDAmount = collateralAmount * ethers.parseUnits("1", 18 - i.collateralDecimals);
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
    const tx = await kfUSDContract.redeem(ethers.parseUnits(i.amount, 18), i.outputToken);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("lockStable", {
  render: (i) => ({
    title: `Lock ${i.amount} kfUSD in the yield vault`,
    detail: "Mints kafUSD 1:1. Exiting later needs a cooldown before it pays out.",
  }),
  resolve: async (ctx, i) => {
    const kafUSDContract = new ethers.Contract(i.kafUSD, KAFUSD_ABI, ctx.signer);
    const tx = await kafUSDContract.lockAssets(i.kfUSD, ethers.parseUnits(i.amount, 18));
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
    const kafUSDContract = new ethers.Contract(i.kafUSD, KAFUSD_ABI, ctx.signer);
    const tx = await kafUSDContract.requestWithdrawal(ethers.parseUnits(i.amount, 18));
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
    const kafUSDContract = new ethers.Contract(i.kafUSD, KAFUSD_ABI, ctx.signer);
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
    const treasury = new ethers.Contract(i.yieldTreasury, YIELD_TREASURY_ABI, ctx.signer);
    const tx = await treasury.claimYield(i.asset);
    await tx.wait();
    return { hash: tx.hash };
  },
});

register("compoundStableYield", {
  render: () => ({
    title: "Claim and compound kfUSD yield",
    detail: "Claims what's accrued and leaves it ready to lock back into the vault.",
  }),
  resolve: async (ctx, i) => {
    const treasury = new ethers.Contract(i.yieldTreasury, YIELD_TREASURY_ABI, ctx.signer);
    const tx = await treasury.claimAndCompound(i.kfUSD);
    await tx.wait();
    return { hash: tx.hash };
  },
});

/* --------------------------------------------------------------- pool -- */

register("collectPoolFees", {
  render: (i) => ({
    title: `Collect fees on ${i.pairLabel} #${i.tokenId}`,
    detail: "Pays out accrued fees. The position itself is untouched.",
  }),
  resolve: async (ctx, i) => {
    const posManager = new ethers.Contract(i.positionManager, POSITION_MANAGER_ABI, ctx.signer);
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
    detail: "Withdraws the full position. Fees owed are collected in the next step.",
  }),
  resolve: async (ctx, i) => {
    const posManager = new ethers.Contract(i.positionManager, POSITION_MANAGER_ABI, ctx.signer);
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
    detail: `Up to $${i.maxNotionalPerAction} per action, $${i.maxNotionalPerEpoch} per period, health floor ${(i.minHealthFactorBps / 100).toFixed(2)}. Revocable any time.`,
  }),
  resolve: async (ctx, i) => {
    const facet = new ethers.Contract(i.diamond, agentPermissionAbi, ctx.signer);
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
