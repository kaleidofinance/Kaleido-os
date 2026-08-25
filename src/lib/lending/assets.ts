import { ethers } from "ethers";
import { getERC20Contract, getKaleidoContract } from "@/config/contracts";
import { getChainMeta } from "@/constants/chains";
import {
  NATIVE_SENTINEL,
  borrowCurrencies,
  getToken,
  isNativeSentinel,
  nativeTokenOf,
  ownTokens,
} from "@/constants/registry";

/**
 * What the diamond will actually accept, per chain.
 *
 * The UI used to offer ETH / USDC / USDT / kfUSD everywhere, because
 * `borrowCurrencies(chainId)` derives its list from address EXISTENCE in the
 * registry. What each diamond accepts is a different fact — it is whatever the
 * operator registered with `addCollateralTokens` / `addLoanableToken`, gated on a
 * usable price feed — and the two disagree on every deployed chain:
 *
 *   Sepolia    collateral NATIVE, WETH9, USDC      loanable USDC
 *   Base       collateral NATIVE, WETH, USDC, USDT loanable USDC, USDT
 *   BSC        collateral NATIVE, WBNB, USDC, USDT loanable USDC, USDT
 *   Arc        collateral NATIVE, WUSDC            loanable WUSDC
 *   Robinhood  collateral NATIVE, WETH, USDC       loanable WETH, USDC
 *
 * Offering the union of both lists produced four separate failures: kfUSD is
 * registered on no chain, the native asset is loanable on no chain, the wrapped
 * native is registered on all five and was offered on none, and on Arc the
 * offered USDC was the `0x3600…` predeploy while the registered token is WUSDC.
 * Every one of them fails closed inside the facet — `_isTokenAllowed` and
 * `getUsdValue` read the same `s_priceFeeds` mapping — so the user paid gas to
 * learn that an option the UI presented was never available.
 *
 * So ask the chain. `getAllCollateralToken()` and `getLoanableAssets()` are both
 * already in `src/abi/ProtocolFacet.json`, which is what makes this a frontend
 * change with no transaction and no contract change behind it. It also
 * self-corrects: register a token tomorrow and it appears in the picker without
 * an edit here.
 *
 * The two lists are genuinely different sets and must not be merged. Collateral
 * is what you may deposit to back a loan; loanable is what you may borrow or
 * lend. On four of the five chains the native asset is the first and not the
 * second, so a single "supported assets" list would be wrong for one of the two
 * questions no matter which way it was built.
 */
export interface LendingAsset {
  symbol: string;
  /** As the diamond returned it — the native sentinel, or an ERC20 address. */
  address: string;
  decimals: number;
  isNative: boolean;
}

export interface LendingAssetSets {
  /** Depositable as collateral, in the order the diamond stores them. */
  collateral: LendingAsset[];
  /** Borrowable / lendable. */
  loanable: LendingAsset[];
  /**
   * Addresses the diamond accepts that we could name from neither the registry
   * nor the token contract itself. Kept rather than dropped so a caller can say
   * "this chain has an asset we cannot describe" instead of quietly presenting a
   * shorter list than the protocol supports.
   */
  unnamed: string[];
}

/**
 * One collateral asset the user has actually deposited.
 *
 * `amount` is a DISPLAY number, already divided by the asset's decimals — never
 * base units. It lives here rather than in useBorrowV2 because the hook that
 * produces it (useLendingAssets) and the hook that republishes it (useBorrowV2)
 * would otherwise import types from each other.
 */
export interface CollateralHolding {
  symbol: string;
  address: string;
  amount: number;
}

/**
 * Names one lending asset from a (chainId, address) pair, without an RPC call.
 *
 * Registry-only and exact — rule 1 in constants/registry.ts. Resolution order is
 * native sentinel, then the declared third-party TOKENS table, then our own
 * deployed tokens, then the lending currency list (which is where the testnet
 * USDT and the BSC/Robinhood mock USDC live, since TOKENS has no entry for
 * them). Returns undefined rather than guessing, because both callers are about
 * to build a transaction amount: a wrong decimals is not a wrong label, it is a
 * transfer off by a factor of 1e12.
 */
export function describeLendingAsset(
  chainId: number | undefined,
  address: string | undefined,
): LendingAsset | undefined {
  if (chainId === undefined || !address) return undefined;

  if (isNativeSentinel(address, "lending")) {
    const native = nativeTokenOf(getChainMeta(chainId), "lending");
    if (!native) return undefined;
    return {
      symbol: native.symbol,
      address: NATIVE_SENTINEL.lending,
      decimals: native.decimals,
      isNative: true,
    };
  }

  const a = address.toLowerCase();
  const declared =
    getToken(chainId, address) ??
    ownTokens(chainId).find((t) => t.address.toLowerCase() === a);
  if (declared) {
    return {
      symbol: declared.symbol,
      address,
      decimals: declared.decimals,
      isNative: false,
    };
  }

  const offered = borrowCurrencies(chainId).find(
    (c) => c.address.toLowerCase() === a,
  );
  if (offered) {
    return {
      symbol: offered.symbol,
      address,
      decimals: offered.decimals,
      isNative: false,
    };
  }

  return undefined;
}

/**
 * Reads `symbol()` and `decimals()` off an ERC20 the registry does not know.
 *
 * This is not a violation of "decimals are declared data, never inferred" — the
 * token's own `decimals()` IS the declaration, and the rule exists to stop
 * decimals being inferred from a SYMBOL ("USDC means 6", which is false on Arc).
 * Asking the contract is the strongest answer available; the registry is
 * consulted first only because it needs no round trip.
 *
 * Returns undefined on any failure, including a non-ERC20 address, so a token we
 * cannot describe is reported as unnamed rather than rendered with a placeholder
 * decimals that a later parseUnits would trust.
 */
async function readErc20Identity(
  provider: ethers.Provider | ethers.Signer,
  address: string,
): Promise<LendingAsset | undefined> {
  try {
    const erc20 = getERC20Contract(provider, address);
    const [symbol, decimals] = await Promise.all([
      erc20.symbol() as Promise<string>,
      erc20.decimals() as Promise<bigint>,
    ]);
    const d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 36) return undefined;
    return { symbol, address, decimals: d, isNative: false };
  } catch {
    return undefined;
  }
}

/** Case-insensitive dedupe, first occurrence wins, order preserved. */
function uniqueAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The two registered sets on one chain, named.
 *
 * `chainId` must be the chain of `provider` — the same pairing rule
 * getKaleidoContract documents, and for the same reason: an address list read
 * through the wrong connection describes a different protocol deployment.
 *
 * Throws if there is no diamond on the chain (via getKaleidoContract) or if
 * either call reverts. That is deliberate and the callers depend on it: an empty
 * list and a failed read are opposite facts, and a hook that cannot tell them
 * apart will show "nothing is borrowable here" during an RPC outage. `isDeployed`
 * remains the gate to check before calling.
 */
export async function readLendingAssets(
  provider: ethers.Provider | ethers.Signer,
  chainId: number | undefined,
): Promise<LendingAssetSets> {
  const diamond = getKaleidoContract(provider, chainId);

  const [collateralRaw, loanableRaw] = await Promise.all([
    diamond.getAllCollateralToken() as Promise<string[]>,
    diamond.getLoanableAssets() as Promise<string[]>,
  ]);

  const collateralAddrs = uniqueAddresses(Array.from(collateralRaw));
  const loanableAddrs = uniqueAddresses(Array.from(loanableRaw));

  /* One on-chain identity read per address the registry cannot name, shared
     across both lists — the wrapped native is usually in both, and on Arc the
     same WUSDC is the only entry in each. */
  const unresolved = uniqueAddresses(
    [...collateralAddrs, ...loanableAddrs].filter(
      (a) => describeLendingAsset(chainId, a) === undefined,
    ),
  );
  const fetched = new Map<string, LendingAsset>();
  await Promise.all(
    unresolved.map(async (a) => {
      const asset = await readErc20Identity(provider, a);
      if (asset) fetched.set(a.toLowerCase(), asset);
    }),
  );

  const unnamed: string[] = [];
  const describe = (address: string): LendingAsset | undefined => {
    const asset =
      describeLendingAsset(chainId, address) ??
      fetched.get(address.toLowerCase());
    if (!asset) unnamed.push(address);
    return asset;
  };

  return {
    collateral: collateralAddrs
      .map(describe)
      .filter((a): a is LendingAsset => a !== undefined),
    loanable: loanableAddrs
      .map(describe)
      .filter((a): a is LendingAsset => a !== undefined),
    unnamed: uniqueAddresses(unnamed),
  };
}
