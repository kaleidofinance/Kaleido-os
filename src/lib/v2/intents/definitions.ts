import { ethers } from "ethers";
import { KALEIDOSWAP_V3_ROUTER } from "@/constants/utils/addresses";
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
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
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
