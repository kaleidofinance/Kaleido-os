import { ZeroAddress } from "ethers";

/**
 * Elysium Mainnet (99901) Uniswap v4 Launchpad & Pool Registry.
 *
 * Elysium hosts 12 launchpads across 5 Uniswap v4 PoolManager singletons:
 *   1. Shared PoolManager (0xE2e1…23F1): Montra, Ascend, Mesa, Volta, RONS, Obol, KSTR
 *   2. BOXA PoolManager   (0x06c6…B2C4): BOXA
 *   3. Kleos PoolManager  (0xb308…2490): Kleos
 *   4. ElysPump PoolMgr   (0x5fb0…9600): ElysPump, Quoted
 *   5. Eleos PoolManager  (0x5c54…37da): Eleos
 *
 * Every PoolManager is a canonical Uniswap v4 singleton storing `_pools` at
 * storage slot 6 and exposing `extsload(bytes32[] slots)`. Probing a token
 * across all 12 launchpads therefore takes one parallel `extsload` round-trip
 * with zero log scanning.
 *
 * Swaps execute through 0x's AllowanceHolder (0x0000000000001fF3684f28c67538d4D072C22734)
 * into 0x's Elysium Settler (ownerOf(2) on 0x00000000000004533Fe15556B1E086BB1A72cEae),
 * which natively settles Shared PoolManager v4 pools and routes the 4 dedicated
 * PoolManagers through their pinned UniversalRouter v2.0.0 contracts.
 */

export const ELYSIUM_CHAIN_ID = 99901;

/** Native HYPE inside a Uniswap v4 PoolKey is always the zero address. */
export const ELYSIUM_V4_NATIVE = ZeroAddress;

/** 0x Settler's ERC-7528 native HYPE designator. */
export const ELYSIUM_SETTLER_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const ELYSIUM_WHYPE = "0xbA876237B0F021A6c6D852d6c26E107997cC5E81";
export const ELYSIUM_WHYPE_DECIMALS = 18;

export const ELYSIUM_USDC = "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65";
export const ELYSIUM_USDC_DECIMALS = 6;

export const ELYSIUM_KNTQ = "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0";
export const ELYSIUM_KNTQ_DECIMALS = 18;

/** 0x's canonical AllowanceHolder on Elysium Mainnet (the ERC-20 approval target & tx `to`). */
export const ELYSIUM_ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734";

/** 0x's Settler Registry (`ownerOf(2)` returns the active taker-submitted Settler). */
export const ELYSIUM_SETTLER_REGISTRY = "0x00000000000004533Fe15556B1E086BB1A72cEae";

/** Current 0x Elysium Settler (`ownerOf(2)` verified at block 3,115,979). */
export const ELYSIUM_SETTLER_FALLBACK = "0xB2766443c2f92FBE579F057593802737BC88F591";

/** Kalos V3 periphery used for bridging USDC <-> WHYPE and KNTQ <-> WHYPE hops. */
export const KALOS_V3 = {
  factory: "0x8C60243181370bDA9A7d1a45b1249A8263da0158",
  swapRouter: "0x158A3998743D182fBa8eCE6d54e57D6495b5E53B",
  usdcWhypePool: "0xBCe6cE62ef0BaD529E5674a64fb23cE79DF70e67",
  usdcWhypeFee: 3000,
  kntqWhypePool: "0xC0F0D079a8e0d1d421f6E916683F6f86A26c6C4D",
  kntqWhypeFee: 10000,
} as const;

/** The 5 Uniswap v4 PoolManager singletons on Elysium Mainnet. */
export const ELYSIUM_POOL_MANAGERS = {
  shared: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1",
  boxa: "0x06C63714fBf1F5753017123E2FcfdEde4540B2c4",
  kleos: "0xb308B5df891c300a5f5a5b8fdBC30108bA842490",
  elyspump: "0x5fb015a49f5b35073f9Ce01C2aDb287A75F89600",
  eleos: "0x5c54A7293D96B11a29A0256eE8dfdBC3059637Da",
} as const;

/**
 * UniversalRouter v2.0.0 contracts deployed per dedicated PoolManager singleton,
 * invoked by 0x Settler's `BASIC` action for non-shared PoolManager pools.
 */
export const ELYSIUM_VENUE_ROUTERS: Record<string, string> = {
  [ELYSIUM_POOL_MANAGERS.elyspump.toLowerCase()]:
    "0x1489F0a6EE56EcB9Ba12cBDBa7e94bFc9ba5326d",
  [ELYSIUM_POOL_MANAGERS.boxa.toLowerCase()]:
    "0x0eC81023EED3065e0C381B897f5eb8A0D2c0fa48",
  [ELYSIUM_POOL_MANAGERS.kleos.toLowerCase()]:
    "0x10393182B168C1B0452917389D852cCBF060a649",
  [ELYSIUM_POOL_MANAGERS.eleos.toLowerCase()]:
    "0xc3328e35D554D2310721e13f183bFdc7bE759262",
};

/** Uniswap v4 periphery deployed against the Shared PoolManager (0xE2e1…23F1). */
export const ELYSIUM_V4_PERIPHERY = {
  quoter: "0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5",
  stateView: "0x27eD73aE0652fdCf71d6793412A7525f32bE9dfE",
  universalRouter: "0x1B341FDD55d56F8E08409A2C25DDFad93Eb03C1a",
} as const;

export type ElysiumLaunchpadId =
  | "montra"
  | "boxa"
  | "ascend"
  | "mesa"
  | "volta"
  | "kleos"
  | "elyspump"
  | "eleos"
  | "rons"
  | "obol"
  | "kstr"
  | "quoted"
  | "v4";

export interface ElysiumLaunchpadSpec {
  id: ElysiumLaunchpadId;
  name: string;
  badgeLabel: string;
  poolManager: string;
  hooks: readonly string[];
  tickSpacings: readonly number[];
  fees: readonly number[];
  quotes: readonly string[];
  transferTaxBps?: number;
}

const DYNAMIC_FEE = 0x800000;

/**
 * All 12 Elysium Launchpads and their PoolManager + Hook + PoolKey signatures.
 */
export const ELYSIUM_LAUNCHPADS: readonly ElysiumLaunchpadSpec[] = [
  {
    id: "montra",
    name: "Montra",
    badgeLabel: "Montra launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0x6b1216A40B65c83e9c9e18a562C446697B8cf8EC"],
    tickSpacings: [200],
    fees: [DYNAMIC_FEE, 10000, 3000, 0],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "boxa",
    name: "BOXA",
    badgeLabel: "BOXA launch",
    poolManager: ELYSIUM_POOL_MANAGERS.boxa,
    hooks: [
      "0xB3E25CDf4a2f42e7f37aB3aE43Bfb90EE8052AcC",
      "0xBCc1f22d137C1D98DFa5548E4d4261D7AeE06acC",
    ],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "ascend",
    name: "Ascend",
    badgeLabel: "Ascend launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0xe0dEF4221b9840a610D4e7d55812a79A6431a8eC"],
    tickSpacings: [200],
    fees: [DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_WHYPE, ELYSIUM_USDC, ELYSIUM_KNTQ, ELYSIUM_V4_NATIVE],
  },
  {
    id: "mesa",
    name: "Mesa",
    badgeLabel: "Mesa launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0xE928F2336051cBD5B9D4531C25EaDd13f9A82aeC"],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "volta",
    name: "Volta",
    badgeLabel: "Volta launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0x3aB88DDc3CF2A012af88B60828edb4553697E5dC"],
    tickSpacings: [60, 200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "kleos",
    name: "Kleos",
    badgeLabel: "Kleos launch",
    poolManager: ELYSIUM_POOL_MANAGERS.kleos,
    hooks: [
      "0x0c835e6A51717a514144d95c7F0a1C640179E0Cc",
      "0xD5068e7f4e2D70d5eFbaC6fD28A8407252E1EAcC",
    ],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "elyspump",
    name: "ElysPump",
    badgeLabel: "ElysPump launch",
    poolManager: ELYSIUM_POOL_MANAGERS.elyspump,
    hooks: ["0xe11CaFA5901B0aaB51eB78251488400f9e4320Cc"],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "eleos",
    name: "Eleos",
    badgeLabel: "Eleos launch",
    poolManager: ELYSIUM_POOL_MANAGERS.eleos,
    hooks: ["0x8680965555DCEa2a4c0Ed3a29e59a8AA424E6acC"],
    tickSpacings: [200],
    fees: [DYNAMIC_FEE, 0, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "rons",
    name: "RONS",
    badgeLabel: "RONS launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0xD80e67B50E35d5be06572F0Fb2D824Cf8173e8eC"],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "obol",
    name: "Obol",
    badgeLabel: "Obol launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0x4De07902f28D00736E29AA5739deA2D4ce98aACC"],
    tickSpacings: [1, 60, 200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
    transferTaxBps: 100,
  },
  {
    id: "kstr",
    name: "KSTR",
    badgeLabel: "KSTR launch",
    poolManager: ELYSIUM_POOL_MANAGERS.shared,
    hooks: ["0x302C1AfE9998715dcC00f5e8BF5648874D17A0cC"],
    tickSpacings: [200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
  {
    id: "quoted",
    name: "Quoted",
    badgeLabel: "Quoted launch",
    poolManager: ELYSIUM_POOL_MANAGERS.elyspump,
    hooks: ["0x92Cc902b9AB7cC936EA30Ea80D31f43994f4a0cc"],
    tickSpacings: [60, 200],
    fees: [0, DYNAMIC_FEE, 10000, 3000],
    quotes: [ELYSIUM_V4_NATIVE, ELYSIUM_WHYPE],
  },
] as const;

/** Quote tokens a user may spend or receive when trading an Elysium launchpad token. */
export const ELYSIUM_QUOTE_TOKENS = [
  ELYSIUM_USDC,
  ELYSIUM_WHYPE,
  ELYSIUM_KNTQ,
] as const;

export function isElysiumQuoteToken(address: string): boolean {
  const lower = address.toLowerCase();
  return ELYSIUM_QUOTE_TOKENS.some((q) => q.toLowerCase() === lower);
}

export function isKnownElysiumLaunchRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  return (
    chainId === ELYSIUM_CHAIN_ID &&
    address.toLowerCase() === ELYSIUM_ALLOWANCE_HOLDER.toLowerCase()
  );
}
