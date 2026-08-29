"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { getTokenFaucetContract } from "@/config/contracts";
import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import {
  getContracts,
  getToken,
  isNativeSentinel,
  nativeTokenOf,
} from "@/constants/registry";
import { getChainMeta } from "@/constants/chains";
import useTxFactory from "@/components/factory/TxFactory";
import erc20Abi from "@/abi/ERC20Abi.json";
import type { FaucetAssetRef } from "@/lib/v2/intents/build";

/**
 * The testnet faucet on the chain being viewed.
 *
 * ── Why symbol and decimals are read on-chain ───────────────────────────────
 *
 * The obvious move is to resolve each asset through `getToken(chainId, address)`
 * and take its symbol, decimals and logo from the registry. Measured against
 * `TOKENS` it does not work: the mock USDT and USDe are in no chain's token list
 * at all, and USDC is now a mintable mock on every deployed chain too — listed in
 * `TOKENS` only as Arc's 0x3600 predeploy and absent on Sepolia, Base, BSC and
 * Robinhood (switch-usdc-to-mock.js removed the last two TOKENS entries when it
 * replaced Circle's real USDC with the mock on Sepolia and Base). So `getToken`
 * misses most of what the faucet hands out, and a missing decimals is not a blank
 * field but a payout displayed off by twelve orders of magnitude.
 *
 * `symbol()` and `decimals()` are therefore read from each token, and the
 * registry is consulted only to *enrich* — a logo when it happens to know one.
 * Both are immutable for the life of an ERC20, so they are cached per
 * (chain, token) for the session rather than re-read on every refresh.
 *
 * ── Wallet-less ────────────────────────────────────────────────────────────
 *
 * The page renders before a wallet connects, showing the read chain's offer with
 * the zero address as the claimer: `claimableAt` returns 0 for an address that
 * has never claimed, so every asset reads as available, which is true of a
 * visitor who has not claimed either. Claiming needs a signer and says so.
 */
export interface FaucetAsset {
  address: string;
  symbol: string;
  decimals: number;
  /** Paid per claim, in human units. "0" when the asset is paused. */
  amount: string;
  /** What the faucet still holds, in human units. */
  stock: string;
  /**
   * The connected wallet's own balance of this token, in human units. Null when
   * no wallet is connected.
   *
   * Here rather than left to /portfolio because for most of these assets there is
   * nowhere else: the mock USDT and USDe are in no chain's `TOKENS` list, and the
   * mock USDC is in none either except Arc's predeploy, so every balance surface
   * that walks the registry skips them. Without this a successful claim is
   * invisible everywhere in the app except its own toast.
   */
  balance: string | null;
  /** Whole drips the remaining stock can cover. */
  claimsLeft: number;
  /**
   * Unix seconds at which the current claimer may next claim, 0 for now.
   *
   * A deadline, not a countdown, because that is what the contract returns and
   * for the same reason — a duration computed at fetch time is already wrong by
   * the time it renders. Any countdown built from this belongs behind a mounted
   * flag, since a live figure differs between the server pass and the first
   * client render.
   */
  nextClaimAt: number;
  /** Listed but paying nothing: the owner set its drip to 0. */
  paused: boolean;
  /** Stock will not cover one drip, so `claim` would revert. */
  empty: boolean;
  logoURI?: string;
}

export interface FaucetState {
  /** Whether this chain has a faucet recorded at all. */
  supported: boolean;
  /** The chain these figures describe — the wallet's, or the read chain. */
  chainId: number;
  address?: string;
  cooldownSeconds: number | null;
  totalUsers: number | null;
  assets: FaucetAsset[];
  loading: boolean;
  error: string | null;
  /** Claims one asset by address. Resolves once the receipt is in. */
  claim: (token: string) => Promise<void>;
  /**
   * Claims everything the current claimer can claim right now, in one
   * transaction. Resolves once the receipt is in.
   */
  claimAll: () => Promise<void>;
  /** Assets `claimAll` would claim if pressed now. Empty means nothing is due. */
  claimable: FaucetAsset[];
  /** Address of the asset currently being claimed, or null. */
  claiming: string | null;
  /** A batch claim is in flight. Separate from `claiming`, which names one asset. */
  claimingAll: boolean;
  refetch: () => void;
}

/** (chainId, token) => immutable ERC20 metadata. */
const metaCache = new Map<string, { symbol: string; decimals: number }>();

const metaKey = (chainId: number, token: string) =>
  `${chainId}:${token.toLowerCase()}`;

/**
 * An asset's symbol and decimals, cached.
 *
 * Falls back to a shortened address and 18 decimals only if both calls fail,
 * which means the address is not an ERC20 — a misconfigured `setDrip`. The row
 * still renders, because a faucet listing something unreadable is worth seeing
 * rather than silently omitting.
 *
 * The native gas token is the exception: it is listed under the sentinel
 * address(1), which is the ecrecover precompile, so `symbol()`/`decimals()`
 * staticcalls against it do not revert — they return decodable garbage. It is
 * resolved from chain metadata instead, where its symbol and 18-decimal scaling
 * are fixed rather than read. Eighteen holds even on Arc, whose gas token is
 * USDC: the balance underneath is 18dp and only the ERC20 alias views it at 6.
 */
async function tokenMeta(
  provider: ethers.Provider,
  chainId: number,
  token: string,
): Promise<{ symbol: string; decimals: number }> {
  const key = metaKey(chainId, token);
  const hit = metaCache.get(key);
  if (hit) return hit;

  if (isNativeSentinel(token, "lending")) {
    const native = nativeTokenOf(getChainMeta(chainId), "lending");
    const meta = {
      symbol: native?.symbol ?? "NATIVE",
      decimals: native?.decimals ?? 18,
    };
    metaCache.set(key, meta);
    return meta;
  }

  const erc20 = new ethers.Contract(token, erc20Abi, provider);
  const [symbol, decimals] = await Promise.all([
    erc20.symbol().catch(() => `${token.slice(0, 6)}…${token.slice(-4)}`),
    erc20
      .decimals()
      .then(Number)
      .catch(() => 18),
  ]);

  const meta = { symbol: String(symbol), decimals };
  metaCache.set(key, meta);
  return meta;
}

/**
 * The faucet's offer for one claimer, in base units.
 *
 * Exported because the agent plans against the same faucet this page renders:
 * useLocalPlanner's `faucetAssets` dep calls exactly this, so a typed
 * "faucet usdt" is checked against the same drips, stock and cooldown deadlines
 * the page shows. Two readers of `assetInfo` would eventually disagree about
 * what is claimable, and the disagreement would surface as a transaction that
 * reverts after the plan said it would work.
 *
 * Raw strings rather than formatted ones because the planner compares stock
 * against the drip, and that comparison has to be integer arithmetic. The hook
 * below formats them for display.
 *
 * Throws nothing on a bad token — see tokenMeta — but does throw if `assetInfo`
 * itself fails; both callers catch and treat that as "nothing to claim".
 */
export async function readFaucetAssets(
  provider: ethers.Provider,
  chainId: number,
  claimer: string,
): Promise<FaucetAssetRef[]> {
  const faucet = getTokenFaucetContract(provider, chainId);
  const [tokens, amounts, balances, nextClaimAt] = (await faucet.assetInfo(
    claimer,
  )) as [string[], bigint[], bigint[], bigint[]];

  return Promise.all(
    tokens.map(async (token, i): Promise<FaucetAssetRef> => {
      const { symbol, decimals } = await tokenMeta(provider, chainId, token);
      return {
        address: token,
        symbol,
        decimals,
        amountRaw: String(amounts[i]),
        stockRaw: String(balances[i]),
        nextClaimAt: Number(nextClaimAt[i]),
      };
    }),
  );
}

/**
 * Why this claim should not be sent, if it should not be — checked before the
 * wallet is opened.
 *
 * Two refusals, in the order they bite. The first is structural: a wallet sitting
 * on a chain this app has no faucet on. The second is the one that actually
 * strands people, and the reason this function exists: a claim is a transaction,
 * so the address pays gas for it, and a brand-new address has none. The faucet
 * cannot bootstrap that — it is the thing being bootstrapped — so the honest
 * answer names the token rather than letting the RPC's "insufficient funds for
 * intrinsic transaction cost" reach the reader as a toast.
 *
 * The balance read is best-effort. An RPC that will not answer is not evidence of
 * an empty wallet, so the claim goes ahead and any real failure comes back from
 * the chain, where the caller's decoder can speak to it.
 */
async function claimRefusal(
  chainId: number,
  address: string,
): Promise<string | null> {
  const meta = getChainMeta(chainId);
  const where = meta?.name ?? `chain ${chainId}`;

  const faucet = getContracts(chainId).faucet;
  if (!faucet || !ethers.isAddress(faucet)) {
    return `There is no faucet on ${where}. Switch your wallet to a supported testnet and try again.`;
  }

  const provider = providerForChain(chainId);
  if (!provider) return null;
  const gas = await provider.getBalance(address).catch(() => null);
  if (gas === 0n) {
    const symbol = meta?.nativeCurrency.symbol ?? "gas";
    return `This wallet holds no ${symbol}, so it cannot pay for the claim. Send it a little ${symbol} on ${where} first — the tokens are free, the transaction that fetches them is not.`;
  }
  return null;
}

export const useFaucet = (): FaucetState => {
  const account = useActiveAccount();
  const activeChain = useActiveWalletChain();

  const chainId = activeChain?.id ?? READ_ONLY_CHAIN_ID;
  const faucetAddress = getContracts(chainId).faucet;
  const supported = Boolean(
    faucetAddress &&
    ethers.isAddress(faucetAddress) &&
    providerForChain(chainId),
  );

  const [cooldownSeconds, setCooldown] = useState<number | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [assets, setAssets] = useState<FaucetAsset[]>([]);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { handleTransactionResult, handleError } = useTxFactory();

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  /* The claimer whose cooldowns these figures describe. See the header on why
     the zero address is the right stand-in for a disconnected visitor. */
  const claimer = account?.address ?? ethers.ZeroAddress;

  useEffect(() => {
    if (!supported) {
      setAssets([]);
      setCooldown(null);
      setTotalUsers(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const provider = providerForChain(chainId);
        if (!provider) throw new Error(`No RPC for chain ${chainId}`);

        const faucet = getTokenFaucetContract(provider, chainId);
        const [info, cooldown, users] = await Promise.all([
          readFaucetAssets(provider, chainId, claimer),
          faucet.cooldown().then(Number),
          faucet.getTotalUsers().then(Number),
        ]);

        const rows = await Promise.all(
          info.map(async (a): Promise<FaucetAsset> => {
            const { decimals } = a;
            const drip = BigInt(a.amountRaw);
            const stock = BigInt(a.stockRaw);
            /* The native gas token has no ERC20 to query — its balance is the
               account's own, read straight off the provider. balanceOf against
               the address(1) precompile would not revert, it would return
               garbage. */
            const held =
              claimer === ethers.ZeroAddress
                ? null
                : isNativeSentinel(a.address, "lending")
                  ? await provider.getBalance(claimer).catch(() => null)
                  : await new ethers.Contract(a.address, erc20Abi, provider)
                      .balanceOf(claimer)
                      .catch(() => null);
            return {
              address: a.address,
              symbol: a.symbol,
              decimals,
              amount: ethers.formatUnits(drip, decimals),
              stock: ethers.formatUnits(stock, decimals),
              balance:
                held === null ? null : ethers.formatUnits(held, decimals),
              claimsLeft: drip > 0n ? Number(stock / drip) : 0,
              nextClaimAt: a.nextClaimAt,
              paused: drip === 0n,
              empty: drip > 0n && stock < drip,
              logoURI: getToken(chainId, a.address)?.logoURI,
            };
          }),
        );

        /* Hide a retired duplicate. setDrip has no "remove" — pausing a token
           (drip 0) is how an asset is retired, and its row lingers in assetInfo
           forever. After switch-usdc-to-mock.js the Sepolia and Base faucets each
           list USDC twice: Circle's real token, now paused at drip 0, and the
           mintable mock that replaced it. Both read symbol() === "USDC" on-chain,
           so without this the faucet shows two USDC rows, one of them dead. Drop a
           paused row only when a live one of the same symbol exists; a symbol
           paused with nothing to replace it stays visible. */
        const liveSymbols = new Set(
          rows.filter((r) => !r.paused).map((r) => r.symbol),
        );
        const deduped = rows.filter(
          (r) => !(r.paused && liveSymbols.has(r.symbol)),
        );

        if (cancelled) return;
        setAssets(deduped);
        setCooldown(cooldown);
        setTotalUsers(users);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        /* Left null rather than zeroed, like the staking atoms: an unread
           faucet and an empty one look identical once both render as 0. */
        setAssets([]);
        setCooldown(null);
        setTotalUsers(null);
        setError(e instanceof Error ? e.message : "Could not read the faucet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported, chainId, claimer, nonce]);

  const byAddress = useMemo(
    () => new Map(assets.map((a) => [a.address.toLowerCase(), a])),
    [assets],
  );

  /**
   * What a batch claim would pay right now.
   *
   * Derived from `assets` rather than recomputed per render, so the cooldown
   * cutoff is the moment the list was last built, not the moment it is read. That
   * is the same staleness the per-row buttons already carry — a row whose cooldown
   * expires while the page sits open stays disabled until a refetch — and it is
   * deliberate here too: a list that silently grows between the render and the
   * click would send a different transaction than the button described.
   *
   * Empty on the server pass and the first client render, because `assets` is
   * populated by the effect above. Nothing derived from a clock is rendered before
   * that, so there is no hydration mismatch to gate.
   */
  const claimable = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return assets.filter(
      (a) => !a.paused && !a.empty && a.nextClaimAt <= now,
    );
  }, [assets]);

  const claim = useCallback(
    async (token: string) => {
      if (!activeChain || !account) {
        toast.error("Connect a wallet to claim");
        return;
      }
      const asset = byAddress.get(token.toLowerCase());
      if (!asset) {
        toast.error("That asset is not on this chain's faucet");
        return;
      }
      /* Both are pre-flight refusals for states the contract also rejects. The
         point is the message: AssetNotListed and InsufficientContractBalance
         both read as "your claim failed" once they come back as a revert. */
      if (asset.paused) {
        toast.error(`${asset.symbol} is paused on this faucet`);
        return;
      }
      if (asset.empty) {
        toast.error(`The faucet is out of ${asset.symbol}`);
        return;
      }
      /* And the two that need a read: wrong chain, and no gas to pay with. */
      const refusal = await claimRefusal(activeChain.id, account.address);
      if (refusal) {
        toast.error(refusal);
        return;
      }

      const signer = ethers6Adapter.signer.toEthers({
        client,
        chain: activeChain,
        account,
      });
      if (!signer) {
        toast.error("Signer not available");
        return;
      }

      const toastId = toast.loading(
        `Claiming ${asset.amount} ${asset.symbol}…`,
      );
      try {
        setClaiming(asset.address);
        const contract = getTokenFaucetContract(signer, activeChain.id);
        const tx = await contract.claim(asset.address);
        await handleTransactionResult(tx, toastId, asset.amount, asset.symbol);
      } catch (e) {
        await handleError(e, toastId);
      } finally {
        setClaiming(null);
        refetch();
      }
    },
    [
      activeChain,
      account,
      byAddress,
      handleTransactionResult,
      handleError,
      refetch,
    ],
  );

  /**
   * One transaction for every asset that is currently claimable.
   *
   * On a six-asset chain the alternative is six signatures for an action whose
   * whole point is to get out of the way before the real testing starts. It is
   * `claimMany` on the contract, which skips anything unavailable rather than
   * reverting the batch — see Faucet.sol.
   *
   * A single claimable asset is sent through `claim` instead. `claimMany` would
   * work, but it reverts with NothingClaimable, where `claim` reverts with the
   * specific reason — paused, on cooldown, or out of stock — and with one asset
   * there is no ambiguity for the batch error to be covering up. That matters on a
   * race: the pre-flight filter above reads state that can change before the
   * transaction lands.
   *
   * The count in the toast comes from the receipt's Claimed logs rather than from
   * the list that was sent, because they can differ: `claimMany` returns how many
   * it actually paid, and a member that became unavailable between the read and
   * the block is skipped silently. Claiming the sent length would over-report.
   */
  const claimAll = useCallback(async () => {
    if (!activeChain || !account) {
      toast.error("Connect a wallet to claim");
      return;
    }
    if (claimable.length === 0) {
      toast.error("Nothing to claim on this faucet right now");
      return;
    }
    if (claimable.length === 1) {
      await claim(claimable[0].address);
      return;
    }
    const refusal = await claimRefusal(activeChain.id, account.address);
    if (refusal) {
      toast.error(refusal);
      return;
    }

    const signer = ethers6Adapter.signer.toEthers({
      client,
      chain: activeChain,
      account,
    });
    if (!signer) {
      toast.error("Signer not available");
      return;
    }

    const targets = claimable.map((a) => a.address);
    const toastId = toast.loading(`Claiming ${targets.length} assets…`);
    try {
      setClaimingAll(true);
      const contract = getTokenFaucetContract(signer, activeChain.id);
      const tx = await contract.claimMany(targets);
      const receipt = await tx.wait();
      if (!receipt?.status) {
        toast.error("Transaction failed!", { id: toastId });
        return;
      }
      const topic = contract.interface.getEvent("Claimed")?.topicHash;
      const paid = receipt.logs.filter(
        (l: { topics: readonly string[] }) => l.topics[0] === topic,
      ).length;
      toast.success(
        paid === targets.length
          ? `Claimed ${paid} assets`
          : `Claimed ${paid} of ${targets.length} assets — the rest were no longer available`,
        { id: toastId },
      );
    } catch (e) {
      await handleError(e, toastId);
    } finally {
      setClaimingAll(false);
      refetch();
    }
  }, [activeChain, account, claimable, claim, handleError, refetch]);

  return {
    supported,
    chainId,
    address: supported ? faucetAddress : undefined,
    cooldownSeconds,
    totalUsers,
    assets,
    loading,
    error,
    claim,
    claimAll,
    claimable,
    claiming,
    claimingAll,
    refetch,
  };
};

export default useFaucet;
