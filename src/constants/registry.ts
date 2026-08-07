import type { ChainMeta } from "./chains";

/**
 * Chain-keyed contract and token registry.
 *
 * Replaces the scattered address constants (addresses.ts, tokens.ts,
 * BORROW_CURRENCIES, STABLE_CONTRACTS, formatTokenDecimals.ts) with one
 * source of truth that carries a chain dimension. Those files each held a
 * partial, Abstract-only view, and the disagreements between them were real
 * bugs: the DEX list and the lending list used different addresses for native
 * ETH, and repay approved a 6-decimal token as though it had 18.
 *
 * Three rules this module exists to enforce, all of which the current chain
 * list already breaks somewhere:
 *
 * 1. IDENTITY IS (chainId, address), NEVER SYMBOL OR ADDRESS ALONE.
 *    Nine registered chains call their native asset "ETH". They are not the
 *    same asset — Base ETH and Arbitrum ETH are different balances on
 *    different chains, and an address is only meaningful alongside its chain.
 *
 * 2. DECIMALS ARE DECLARED DATA, NEVER INFERRED.
 *    Arc's native currency is USDC with 18 decimals, while ERC20 USDC is 6
 *    decimals on every other chain. Any "USDC means 6" shortcut is wrong on
 *    Arc by a factor of 10^12. The same applies to guessing a default: the
 *    old getTokenDecimals returned 6 for anything unrecognised, which after a
 *    redeploy is every new address.
 *
 * 3. THE NATIVE SENTINEL IS A PROTOCOL CONVENTION, NOT A CHAIN PROPERTY.
 *    Kaleido's lending facet identifies native value as ADDRESS_1, while the
 *    DEX router uses the 0xEeee… convention. Both are correct for their own
 *    contract and neither is "the" native address, so callers must ask for
 *    the sentinel of the protocol they are calling.
 *
 * Chain metadata is passed in rather than imported, which leaves this module
 * with no runtime dependencies so `node registry.test.ts` can exercise it
 * directly — the same reason fromCommand.ts takes its token list as an
 * argument. Call sites pair it with getChainMeta() from chains.ts.
 */

/* ------------------------------------------------------------- sentinels -- */

/**
 * Per-protocol native-value sentinels. These are not addresses of anything;
 * they are the magic values each contract family expects when a call carries
 * native value instead of an ERC20 transfer.
 */
export const NATIVE_SENTINEL = {
  /** V3 router / quoter convention. */
  dex: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  /** ProtocolFacet (lending, collateral, listings) convention. */
  lending: "0x0000000000000000000000000000000000000001",
} as const;

export type Protocol = keyof typeof NATIVE_SENTINEL;

export function isNativeSentinel(address: string, protocol: Protocol): boolean {
  return address.toLowerCase() === NATIVE_SENTINEL[protocol].toLowerCase();
}

/* -------------------------------------------------------------- contracts -- */

/**
 * Deployed addresses for one chain. Every field is optional because a chain
 * can be registered for balance-reading long before anything is deployed to
 * it — `tradable` in chains.ts is the flag for "has the Diamond", and code
 * should check for the specific contract it needs rather than assume.
 */
export interface ChainContracts {
  /* -- Diamond (EIP-2535). Facets live behind this one address. ----------- */
  diamond?: string;

  /* -- DEX V3. Deployed as a set; the periphery is bound to factory+WETH -- */
  v3Factory?: string;
  v3Router?: string;
  v3Quoter?: string;
  v3PositionManager?: string;
  v3PositionDescriptor?: string;

  /* -- Stablecoin ------------------------------------------------------- */
  kfUSD?: string;
  kafUSD?: string;
  yieldTreasury?: string;

  /* -- Staking ---------------------------------------------------------- */
  kldVault?: string;
  stKLD?: string;
  kld?: string;

  /* -- Oracle ----------------------------------------------------------- */
  /** Our PythPriceOracle wrapper, deployed per chain. */
  priceOracle?: string;

  /** Testnet only. */
  faucet?: string;

  /* -- External, NOT deployed by us ------------------------------------- */
  /**
   * Canonical wrapped native (WETH9-shaped). Required by the V3 router,
   * position manager and quoter, all of which take it as a constructor
   * argument. Differs per chain and is NOT derivable from the native symbol:
   * it is WETH on Ethereum, WBNB on BNB, WPOL on Polygon, and on Arc it wraps
   * USDC rather than ether.
   */
  wrappedNative?: string;
  /**
   * Pyth's own contract on this chain. PythPriceOracle takes it as a
   * constructor argument, and it is different on every chain. Price *feed
   * ids* (ETH_USD etc. in constant.sol) are global and do not vary, so only
   * this address is per-chain.
   */
  pythContract?: string;
  /** Canonical USDC where one exists; a mock on testnets that lack it. */
  usdc?: string;

  /* -- Derived, must be verified per deployment ------------------------- */
  /**
   * keccak of the compiled V3 pool creation bytecode.
   *
   * The V3 periphery derives pool addresses via CREATE2 from this constant
   * rather than asking the factory, and the swap callback authenticates
   * msg.sender against the derived address. The hash is a property of the
   * COMPILED BYTECODE, and Kaleido targets two compilers: zksolc for the
   * Abstract (zkSync) chains, solc for every EVM chain. Identical source
   * yields different bytecode under each.
   *
   * A wrong value does not fail at deploy. The factory still creates pools.
   * It breaks at the first swap, when the callback compares against an
   * address holding no code. Run smart-contract/scripts/verify-pool-init-hash.js
   * against each deployment and record the result here.
   */
  poolInitCodeHash?: string;
}

/**
 * Deployments, keyed by chain id.
 *
 * DELIBERATELY EMPTY. The Abstract addresses that used to be hardcoded across
 * the app are being redeployed from scratch and are no longer valid, so
 * carrying them here would just relocate stale data. Populate a chain as it
 * deploys; `getContracts` returning undefined fields is the correct,
 * checkable state until then.
 */
export const DEPLOYMENTS: Record<number, ChainContracts> = {
  // e.g.
  // [2741]: { diamond: "0x…", v3Router: "0x…", wrappedNative: "0x…" },
};

export function getContracts(chainId: number | undefined): ChainContracts {
  if (chainId === undefined) return {};
  return DEPLOYMENTS[chainId] ?? {};
}

/** True once the Diamond is deployed here, so trading UI can gate on it. */
export function isDeployed(chainId: number | undefined): boolean {
  return Boolean(getContracts(chainId).diamond);
}

/* ----------------------------------------------------------------- tokens -- */

export interface TokenEntry {
  chainId: number;
  /** Sentinel value when `isNative`, otherwise the ERC20 contract address. */
  address: string;
  symbol: string;
  name: string;
  /** Always explicit. Never inferred from symbol, never defaulted. */
  decimals: number;
  isNative?: boolean;
  tags?: string[];
  logoURI?: string;
}

/**
 * Per-chain token lists.
 *
 * DELIBERATELY EMPTY, same reasoning as DEPLOYMENTS. Note that entries are
 * per (chainId, address): the same symbol on two chains is two entries with
 * two addresses, and potentially two different decimal counts.
 */
export const TOKENS: Record<number, TokenEntry[]> = {};

const tokenKey = (chainId: number, address: string) =>
  `${chainId}:${address.toLowerCase()}`;

const TOKEN_INDEX: Map<string, TokenEntry> = new Map(
  Object.values(TOKENS)
    .flat()
    .map((t) => [tokenKey(t.chainId, t.address), t]),
);

/** Exact lookup. The only safe way to resolve a token. */
export function getToken(
  chainId: number | undefined,
  address: string | undefined,
): TokenEntry | undefined {
  if (chainId === undefined || !address) return undefined;
  return TOKEN_INDEX.get(tokenKey(chainId, address));
}

export function getTokens(chainId: number | undefined): TokenEntry[] {
  if (chainId === undefined) return [];
  return TOKENS[chainId] ?? [];
}

/**
 * Symbol lookup, scoped to one chain.
 *
 * Only for resolving user input ("swap 500 usdc"), where a symbol is all the
 * user gave us. Never use it to resolve an address that came from a contract
 * or an API — use getToken for that, since a symbol is ambiguous across
 * chains and can collide within one (a chain's native USDC and a bridged
 * ERC20 USDC can coexist with different decimals).
 */
export function findTokenBySymbol(
  chainId: number | undefined,
  symbol: string,
): TokenEntry | undefined {
  const s = symbol.toLowerCase();
  return getTokens(chainId).find((t) => t.symbol.toLowerCase() === s);
}

/* ----------------------------------------------------------------- native -- */

/**
 * The chain's own native asset, as a TokenEntry.
 *
 * Sourced from chains.ts rather than assumed: nine chains here call it "ETH",
 * BNB testnet calls it "tBNB", Polygon "POL", Hyperliquid "HYPE", and Arc
 * uses USDC at 18 decimals. Anything that hardcodes ETH is wrong on five of
 * the fourteen registered chains today, and the ratio worsens as more are
 * added.
 *
 * `protocol` selects which sentinel the address carries, because the correct
 * value depends on which contract you are about to call.
 */
export function nativeTokenOf(
  meta: ChainMeta | undefined,
  protocol: Protocol,
): TokenEntry | undefined {
  if (!meta) return undefined;

  return {
    chainId: meta.id,
    address: NATIVE_SENTINEL[protocol],
    symbol: meta.nativeCurrency.symbol,
    name: meta.nativeCurrency.name,
    decimals: meta.nativeCurrency.decimals,
    isNative: true,
  };
}

/**
 * Resolves user-typed input to a token on a specific chain, native included.
 *
 * The native asset is checked first and by this chain's own symbol, so "eth"
 * on Base resolves to Base's native rather than to some ERC20 that happens to
 * share the ticker, and "usdc" on Arc resolves to the native asset (18
 * decimals) rather than the 6-decimal ERC20 shape it has elsewhere.
 */
export function resolveUserToken(
  meta: ChainMeta | undefined,
  input: string,
  protocol: Protocol,
): TokenEntry | undefined {
  const native = nativeTokenOf(meta, protocol);
  if (native && native.symbol.toLowerCase() === input.toLowerCase()) return native;
  return findTokenBySymbol(meta?.id, input);
}

/* ------------------------------------------------------------------ audit -- */

/**
 * Development check for the class of mistake this module exists to prevent.
 * Returns human-readable problems rather than throwing, so it can run in a
 * test or a dev-only boot check without taking the app down.
 */
export function auditRegistry(chains: ChainMeta[]): string[] {
  const problems: string[] = [];
  const known = new Set(chains.map((c) => c.id));

  for (const [idStr, list] of Object.entries(TOKENS)) {
    const chainId = Number(idStr);
    if (!known.has(chainId)) {
      problems.push(`TOKENS has chain ${chainId}, which is not in chains.ts`);
    }

    const seen = new Set<string>();
    for (const t of list) {
      if (t.chainId !== chainId) {
        problems.push(`${t.symbol} is filed under chain ${chainId} but declares ${t.chainId}`);
      }
      if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
        problems.push(`${t.symbol} on ${chainId} has implausible decimals: ${t.decimals}`);
      }
      const k = t.address.toLowerCase();
      if (seen.has(k)) {
        problems.push(`${t.symbol} on ${chainId} duplicates address ${t.address}`);
      }
      seen.add(k);
    }
  }

  for (const idStr of Object.keys(DEPLOYMENTS)) {
    const chainId = Number(idStr);
    if (!known.has(chainId)) {
      problems.push(`DEPLOYMENTS has chain ${chainId}, which is not in chains.ts`);
    }
    const c = DEPLOYMENTS[chainId];

    // Each of these is a failure that surfaces late (at first swap, first
    // price read) rather than at deploy time, which is exactly why they are
    // worth asserting statically.
    if (c.v3Router && !c.wrappedNative) {
      problems.push(`chain ${chainId}: v3Router deployed but no wrappedNative recorded`);
    }
    if (c.v3Factory && !c.poolInitCodeHash) {
      problems.push(
        `chain ${chainId}: v3Factory deployed but no poolInitCodeHash — swaps will fail at the callback, not at deploy`,
      );
    }
    if (c.priceOracle && !c.pythContract) {
      problems.push(`chain ${chainId}: priceOracle deployed but no pythContract recorded`);
    }
    if (c.kafUSD && !c.kfUSD) {
      problems.push(`chain ${chainId}: kafUSD without kfUSD — the vault has nothing to wrap`);
    }
    if ((c.kfUSD || c.kafUSD) && !c.yieldTreasury) {
      problems.push(`chain ${chainId}: stablecoin deployed without a yieldTreasury`);
    }
    if (c.stKLD && !c.kldVault) {
      problems.push(`chain ${chainId}: stKLD without a kldVault to mint it`);
    }

    for (const [field, value] of Object.entries(c)) {
      if (typeof value !== "string") continue;
      const isHash = field === "poolInitCodeHash";
      const shape = isHash ? /^0x[0-9a-fA-F]{64}$/ : /^0x[0-9a-fA-F]{40}$/;
      if (!shape.test(value)) {
        problems.push(`chain ${chainId}: ${field} is not a well-formed ${isHash ? "hash" : "address"}: ${value}`);
      }
    }
  }

  return problems;
}

/** Chains the app will let a user trade on: registered, flagged, and deployed. */
export function tradableChains(chains: ChainMeta[]): ChainMeta[] {
  return chains.filter((c) => c.tradable && isDeployed(c.id));
}
