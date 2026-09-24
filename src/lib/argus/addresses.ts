/**
 * Argus launchpad — on-chain addresses on Arc mainnet (chain 5042).
 *
 * Argus is Arc's permissionless token launchpad: Uniswap v4 pools with a
 * per-launch hook that applies fixed buy/sell taxes. Trading a launch token is a
 * STANDARD v4 swap through Uniswap's UniversalRouter — the Portal is only a
 * launch factory + discovery registry, NOT a swap router.
 *
 * Verified on-chain 2026-09-23 (Portal.poolManager()/positionManager() match) and
 * cross-checked against arguspad.io's onchain/addresses.md. Official ABI bundle:
 * https://arguspad.io/argus-v4.json (v4 hooked family) — fetch that for full ABIs.
 */
export const ARGUS_CHAIN_ID = 5042;

/** Shared Uniswap v4 infrastructure on Arc. */
export const ARGUS_V4 = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  /** getSlot0(poolId) / getLiquidity(poolId) — pool price + active liquidity. */
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  positionManager: "0x6049c9a0e26405C0985f9E3685C87d0aE917f82B",
  /** The v4 swap entrypoint we route Argus trades through. */
  universalRouter: "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1",
} as const;

/** Arc USDC (ERC-20 face, 6 decimals) — the common launch quote asset. NOTE:
 *  distinct from the 18-dec native gas accounting; never conflate the two. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_USDC_DECIMALS = 6;

/** Uniswap's canonical Permit2 — the allowance hub the UniversalRouter pulls a
 *  v4 swap's input from. Same address on every chain; on Arc it is the ERC20
 *  spender of every Argus buy and sell (approve token → Permit2, then Permit2 →
 *  router). Lives here, not in swap.ts, so the auditor can pin it without
 *  importing the calldata builder. */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * Every Argus Portal (launch factory), newest first. A newer Portal never
 * replaces earlier ones' tokens, so discovery MUST index them all. `words` is
 * the launch-record layout; v4 hooked family is #3–#7, and #1/#2 are legacy v3
 * (different pool model — handle separately). Current target for new launches: #7.
 */
export const ARGUS_PORTALS = [
  { v: 7, address: "0xB021Be536808f551b31789422Fd28a6c9c6e97Da", family: "v4", words: 11, startBlock: 20_395_275 },
  { v: 6, address: "0xA5628A11c412596E1f63b75a2C0284F843C549d6", family: "v4", words: 11, startBlock: 20_240_260 },
  { v: 5, address: "0x07a688a001f416cC433c68Ff56Aa26bC5131Cc6E", family: "v4", words: 10, startBlock: 20_081_606 },
  { v: 4, address: "0xa36c443A797771Df82533B8B4A86F0AFfd970862", family: "v4", words: 10, startBlock: 19_690_658 },
  { v: 3, address: "0x7A17Ab0106C46C0be30623F3EB7F299CC0058338", family: "v4", words: 9, startBlock: 19_674_154 },
  { v: 2, address: "0xBed9880A0ba12722ba4b8791c0B6F8c74338246C", family: "v3", words: 10, startBlock: 19_056_397 },
  { v: 1, address: "0x0F1C7Cb26D6cD36BD4189E41947658b39437587A", family: "v3", words: 10, startBlock: 18_817_867 },
] as const;

/** Portals whose launch record matches the 11-word v4 struct this reader decodes
 *  (verified against a live #7 launch). Extend as older layouts are added. */
export const ARGUS_V4_11WORD_PORTALS = ARGUS_PORTALS.filter(
  (p) => p.family === "v4" && p.words === 11,
).map((p) => p.address);

/** v4 pool constants for the Argus family (validate observed keys, don't assume). */
export const ARGUS_POOL_FEE = 10_000; // 1% in v4 units
export const ARGUS_TICK_SPACING = 200;

/** Off by default — the whole integration stays inert until this is armed. */
export const argusEnabled = (): boolean =>
  process.env.ARGUS_ENABLED === "1" || process.env.ARGUS_ENABLED === "true";
