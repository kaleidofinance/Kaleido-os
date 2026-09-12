import { ethers } from "ethers";
import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { getContracts, resolveUserToken } from "@/constants/registry";
import { getChainMeta } from "@/constants/chains";
import { readOpenBook } from "@/lib/lending/book";
import { MULTICALL3_ADDRESS, readContracts } from "@/lib/chain/multicall";
import { readOpenOrders } from "@/lib/dex/orderStore";
import {
  describeDuration,
  describeInterval,
  nextFillAt,
  pairLabelFor,
  shortHash,
  swapInputFor,
} from "@/lib/dex/orders";
import { retryRpc } from "@/lib/dex/rpcRetry";
import protocolAbi from "@/abi/ProtocolFacet.json";
import {
  chainTokenByAddress,
  chainTokenBySymbol,
  chainTokens,
  symbolForAddress,
  toIToken,
} from "@/constants/tokens";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import {
  fetchOmniAssetBalance,
  indexedAssets,
} from "@/constants/utils/omniChainBalances";
import { getSpotPrice, PRICED_SYMBOLS } from "@/lib/v2/prices/spot";
import { FEE_TIERS } from "@/lib/dex/liquidity";
import {
  describeRoute,
  findRouteAcrossSources,
  intermediateTokens,
  poolSide,
} from "@/lib/dex/route";
import { fallbackVenues } from "@/constants/venues";
import { serverPathQuoter, serverQuote, serverPositions } from "./planDeps";
import { readPoolState } from "@/lib/dex/pool";
import { getBridgeQuote } from "./bridgeQuotes";

/**
 * Server-side execution of Luca's READ tools.
 *
 * These run in the agent loop (not the browser), so they read over plain
 * JSON-RPC with no signer and no wallet. That's why they can't reuse the React
 * hooks: useQuote/usePortfolio are client-only. The contract calls are the same.
 *
 * **Every handler is scoped to one chain, passed in from the request.** This was
 * the other half of a measured defect and it is worth naming, because the half
 * that was fixed first made this half worse. The plan/audit path used to supply
 * its own `chainId: READ_ONLY_CHAIN_ID` while resolving token symbols on the
 * wallet's chain, so a plan mixed two chains' addresses; that was closed on
 * 2026-08-24 by threading the connected chain through `serverPlanDeps` and
 * pinning the router and diamond in the auditor. These handlers were not
 * touched, and they read `envVars.lendbitDiamondAddress` — one address for every
 * chain — through a provider pinned to `READ_ONLY_CHAIN_ID`.
 *
 * The result was an agent that would correctly *build* a BSC transaction while
 * telling the user their collateral was 0 and their health factor unknown,
 * because it had read Sepolia's diamond. Nothing throws in that state: the reads
 * succeed, the numbers render, and every one of them is about a chain the user
 * is not on. A wrong balance is not a recoverable error the way a missing row is
 * — the model relays it as fact and reasons a plan off it.
 *
 * `READ_ONLY_CHAIN_ID` remains the fallback for the genuinely walletless case
 * (the protocol-wide panels, where there is no user to ask), but it is resolved
 * once in `runReadTool` so every handler in a round agrees on the answer, rather
 * than each reaching for its own default.
 *
 * Every handler returns a plain object that gets fed back to the model as the
 * tool result. Failures return { error } rather than throwing — the model can
 * reason about a failed lookup ("I couldn't fetch your positions") far better
 * than the loop can recover from an exception.
 */

type Json = Record<string, unknown>;

const HEALTH_SCALE = 1e-18;
/**
 * `_healthFactor`'s "no debt" answer, as ProtocolFacet returns it.
 *
 * The facet short-circuits to `type(uint256).max` when a user's borrowed value is
 * zero (ProtocolFacet.sol, `_healthFactor`), which is a sentinel and not a ratio.
 * It has to be recognised as a bigint, before any scaling: `Number(2^256-1)` is
 * 1.16e77, times HEALTH_SCALE it is 1.16e59, and `Number.isFinite(1.16e59)` is
 * `true`. So the finiteness guard below — written to catch exactly this — passed
 * it through, and the agent relayed a sixty-digit health factor as the user's
 * position. Measured on Sepolia 2026-08-25 against a wallet holding $400 of
 * collateral against two serviced loans.
 *
 * Worth being precise about what "no debt" means here, because it is currently
 * two different situations wearing one answer. A wallet that has genuinely never
 * borrowed reads this. So does a wallet with live loans whose debt index was
 * never written — the state every borrower on the five deployed diamonds is in
 * until ProtocolFacet's self-indexing fix is cut. `null` is the honest answer to
 * both from here: this handler cannot tell them apart, and a number would assert
 * a solvency margin nobody computed.
 */
const NO_DEBT_SENTINEL = (1n << 256n) - 1n;
/* 18 decimals, matching the scale ProtocolFacet.getUsdValue documents and — since
 * _priceScaled18 replaced the inverted per-function exponent handling — actually
 * returns. Was 1e16, the scale the old bug produced for a -8 Pyth feed. */
const USD_SCALE = 1e18;

/**
 * The lending diamond on one chain, or the reason there isn't one to read.
 *
 * Both failure modes are returned as text because the model relays them and they
 * call for different answers: an unregistered chain has no RPC endpoint here and
 * never will until chains.ts carries it, whereas a registered chain with no
 * diamond is simply a deploy that hasn't reached it yet. Collapsing them into one
 * "not configured" string — which is what this replaced — told the user nothing
 * either way.
 *
 * Provider and address are resolved from the same `chainId` in the same place on
 * purpose. Independently sourced, they are exactly the pair that produced real
 * reads labelled with the wrong chain.
 */
function protocolOn(
  chainId: number,
):
  | { contract: ethers.Contract; error?: undefined }
  | { contract?: undefined; error: string } {
  const provider = providerForChain(chainId);
  if (!provider)
    return {
      error:
        `Chain ${chainId} isn't in Kaleido's chain registry, so there's no ` +
        `endpoint to read it from.`,
    };

  const diamond = getContracts(chainId).diamond;
  if (!diamond)
    return {
      error: `Kaleido's lending contracts aren't deployed on chain ${chainId}.`,
    };

  return { contract: new ethers.Contract(diamond, protocolAbi, provider) };
}

/**
 * Total repayment and interest for a hypothetical loan.
 *
 * The 18 decimals are not a guess and not a placeholder. `getQuote`
 * (ProtocolFacet.sol) takes no token and reads no feed — it is
 * `amount + amount * interest * duration / (BASIS_POINTS * SECONDS_PER_YEAR)`,
 * pure proportional arithmetic — so parsing in at 18 and formatting out at 18
 * round-trips exactly whatever the real token's decimals are. Scoping this to
 * the token would be the change that introduced an error, not the one that
 * removed one.
 */
async function getQuote(args: Json, chainId: number): Promise<Json> {
  const { contract, error } = protocolOn(chainId);
  if (!contract) return { error };
  try {
    const amount = ethers.parseUnits(String(args.amount ?? "0"), 18);
    const [totalRepayment, interestAmount, durationSeconds] =
      await contract.getQuote(
        amount,
        Number(args.interestBps ?? 0),
        Number(args.returnDate ?? 0),
      );
    return {
      totalRepayment: ethers.formatUnits(totalRepayment, 18),
      interestAmount: ethers.formatUnits(interestAmount, 18),
      durationDays: Number(durationSeconds) / 86_400,
    };
  } catch (err) {
    return { error: `getQuote failed: ${(err as Error).message}` };
  }
}

async function getPortfolio(args: Json, chainId: number): Promise<Json> {
  const address = String(args.address ?? "");
  if (!ethers.isAddress(address))
    return { error: "A valid wallet address is required" };

  const { contract, error } = protocolOn(chainId);
  if (!contract) return { error };

  try {
    const [collateralRaw, healthRaw] = await Promise.all([
      contract.getAccountCollateralValue(address).catch(() => null),
      contract.getHealthFactor(address).catch(() => null),
    ]);

    /* Sentinel first, on the bigint, then scale. Doing it the other way round is
       what let 1.16e59 reach the model — see NO_DEBT_SENTINEL. */
    const noDebt =
      healthRaw !== null && BigInt(healthRaw) === NO_DEBT_SENTINEL;
    const health =
      healthRaw === null || noDebt ? null : Number(healthRaw) * HEALTH_SCALE;

    return {
      chainId,
      collateralUsd:
        collateralRaw === null ? null : Number(collateralRaw) / USD_SCALE,
      healthFactor:
        health === null || !Number.isFinite(health)
          ? null
          : Number(health.toFixed(4)),
      /* Said explicitly, because `healthFactor: null` on its own is ambiguous —
         the model has to be able to tell "you have no debt" from "we could not
         read your health factor", and it would otherwise guess. */
      healthFactorNote: noDebt
        ? "This wallet has no borrowed value recorded against it, so there is no health factor to report — not a high one. Say they have no open debt on this chain. Do not describe the position as safe by some large margin, and do not quote a number."
        : healthRaw === null
          ? "The health factor could not be read. Say so rather than implying the position is fine."
          : undefined,
      note: "Positions are per chain — this is chain " + chainId + " only. Liquidation occurs at health factor 1.0. Liquidity, staking and vault positions are read client-side and may not appear here.",
    };
  } catch (err) {
    return { error: `getPortfolio failed: ${(err as Error).message}` };
  }
}


const ERC20_BALANCE = new ethers.Interface([
  "function balanceOf(address owner) view returns (uint256)",
]);

/** Multicall3 carries this view on itself, so the gas balance rides the batch. */
const NATIVE_BALANCE = new ethers.Interface([
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);

/**
 * What the wallet actually holds, on the chain it is connected to.
 *
 * Nothing answered this before, and the gap showed: asked "what's my balance",
 * the model reached for `getPortfolio` - which reads the lending diamond's
 * collateral and health factor and knows nothing about tokens sitting in a
 * wallet - or for `getChains`, which needs a symbol named up front and sweeps
 * every chain to answer about one asset. Neither can list holdings, so the agent
 * either said it could not check or relayed a collateral figure as though it
 * were a balance. `getChains` is still the right tool for "where are my USDC",
 * and this one for "what do I have here".
 *
 * ONE round trip for the whole wallet. Multicall3 exposes `getEthBalance` as a
 * view on itself, so the native asset batches alongside every `balanceOf`
 * instead of needing a request of its own - verified against `eth_getBalance` on
 * Sepolia, same wei through both paths.
 *
 * The native-alias face is dropped, and the registry says why in its own words:
 * a UI that lists Arc's 0x3600 USDC next to the native asset "is showing one
 * holding twice". The alias mirrors the gas balance rather than holding anything
 * separate, so listing both would report a wallet's USDC at double what it has.
 * Same filter and same reason as `bySymbol` in lib/dex/route.ts.
 *
 * A symbol that could not be read goes in `unread` rather than appearing as 0.
 * That distinction is the whole reason this is not one flat list: the model
 * relays what it is given as fact, and "you hold no USDC" built from a failed
 * request is the class of answer that gets planned off. Measured zeros are
 * dropped for the opposite reason - they were read, and a wallet does not need
 * forty rows of nothing. When NOTHING could be read the whole call refuses, for
 * the same reason `readOpenBook` returns null rather than an empty book: an
 * empty holdings list is a sentence about the user's money.
 */
async function getBalances(args: Json, chainId: number): Promise<Json> {
  const address = String(args.address ?? "");
  if (!ethers.isAddress(address))
    return { error: "A valid wallet address is required" };

  if (!providerForChain(chainId))
    return {
      error:
        `Chain ${chainId} isn't in Kaleido's chain registry, so there's no ` +
        `endpoint to read balances from.`,
    };

  const chainName = getChainMeta(chainId)?.name ?? `chain ${chainId}`;
  const tokens = chainTokens(chainId).filter(
    (t) => !t.tags?.includes("native-alias"),
  );

  const results = await readContracts(
    chainId,
    tokens.map((t) =>
      t.isNative
        ? {
            target: MULTICALL3_ADDRESS,
            iface: NATIVE_BALANCE,
            method: "getEthBalance",
            args: [address],
          }
        : {
            target: t.address,
            iface: ERC20_BALANCE,
            method: "balanceOf",
            args: [address],
          },
    ),
  );

  const holdings: { symbol: string; address: string; amount: string }[] = [];
  const unread: string[] = [];
  tokens.forEach((t, i) => {
    const r = results[i];
    if (!r?.success || r.value === null) {
      unread.push(t.symbol);
      return;
    }
    /* Decimals are the registry's declared value, never a guess: BSC's USDC is
       18 where every other chain's is 6, so guessing 18 overstates a balance by
       a factor of 10^12. */
    const amount = ethers.formatUnits(r.value as bigint, t.decimals);
    if (!(Number(amount) > 0)) return;
    holdings.push({ symbol: t.symbol, address: t.address, amount });
  });

  if (tokens.length > 0 && unread.length === tokens.length)
    return {
      error:
        `Balances could not be read on ${chainName} - the RPC did not answer. ` +
        `Do not tell the user their wallet is empty; say the balance check failed.`,
    };

  return {
    chainId,
    chain: chainName,
    holdings,
    unread,
    note:
      (holdings.length === 0
        ? `This wallet holds none of the tokens Kaleido knows about on ${chainName}. It may hold funds on another chain - getChains checks one asset across all of them - or tokens that aren't in the registry, which this cannot see. Say which of those you checked. `
        : `Balances on ${chainName} only, in token units. They carry no USD value: use getPrice for that, and say so rather than implying a total we did not compute. `) +
      (unread.length > 0
        ? `These could not be read and are NOT zero - say they could not be checked: ${unread.join(", ")}. `
        : "") +
      "Wallet balances are separate from positions: collateral deposited into the lending pool, staked KLD and liquidity in a pool have left the wallet and appear in getPortfolio, not here.",
  };
}

/**
 * Resolves a token address to its symbol; falls back to a short address.
 *
 * Needs the chain because the order book stores bare addresses, and an address
 * means a different token on a different chain — deployer-nonce alignment across
 * our own testnet deploys makes that literal rather than theoretical:
 * 0xa2e10393… is USDe on BSC Testnet and USDT on Arc.
 */
function symbolFor(chainId: number, address: string): string {
  return symbolForAddress(chainId, address);
}

/**
 * The open offer book, read from the caller's own diamond.
 *
 * Listings are lender offers (what you can borrow from); requests are borrower
 * asks (what you can fund). Sorting is side-aware: a borrower wants the lowest
 * APR, a lender the highest — the same polarity rule the Borrow page's rate
 * colouring uses.
 *
 * **This used to be the one read here that was NOT scoped to the caller's chain,
 * and both halves of that — the source and the pin — were wrong together.** It
 * queried the Supabase mirror, and because those tables carry no chainId column
 * it had to pin itself to `LENDING_CHAIN_ID` to say anything coherent about which
 * deployment a row belonged to. The pin was the correct response to the source.
 *
 * The source was measured failing on 2026-08-25: Sepolia's diamond held an open
 * listing and an open request, the mirror held zero rows, and this tool answered
 * "No open offers match. Suggest the user post their own offer at the rate they
 * want." A model relays that as fact, so the user is told the market is empty and
 * advised to duplicate an offer already sitting on it. `lib/lending/book.ts`
 * carries the full account, including why the keeper being fixed would not make
 * the mirror the right source for this.
 *
 * Reading the chain removes the reason for the pin as well. The old docblock
 * argued — correctly, for a mirror-backed read — that resolving the asset on the
 * wallet's chain would be a regression, because `USDC` on BSC Testnet is our mock
 * while the table holds Sepolia addresses, so the filter would match nothing.
 * Addresses that come from the caller's own diamond cannot develop that mismatch:
 * they are on the chain being asked about by construction.
 *
 * A chain with no diamond gets a named refusal, not an empty book. "No offers
 * here" and "the protocol isn't deployed here" are different facts and the second
 * one is actionable.
 */
async function getMarkets(args: Json, chainId: number): Promise<Json> {
  const asset = String(args.asset ?? "").toUpperCase();
  const side = String(args.side ?? "borrow").toLowerCase();
  const wantLend = side === "lend";

  const token = asset ? chainTokenBySymbol(chainId, asset) : undefined;
  if (asset && !token) {
    const known = chainTokens(chainId).map((t) => t.symbol);
    // Distinguish "that symbol isn't one of ours" from "we have no token
    // registry on this chain at all". The model relays this to the user, and
    // the two call for completely different answers.
    return known.length === 0
      ? {
          error: `No tokens are registered on chain ${chainId}, so no asset can be resolved by symbol.`,
          knownAssets: [],
        }
      : {
          error: `Unknown asset "${asset}" on chain ${chainId}`,
          knownAssets: known,
        };
  }

  try {
    const book = await readOpenBook(
      providerForChain(chainId),
      chainId,
      wantLend ? "requests" : "listings",
      /* Asked for more than the 12 returned, because the asset filter and the
         maturity filter both cut below this line — a book whose newest 12 entries
         are all WETH would otherwise report "no USDC offers" over a book holding
         them. */
      { want: 40 },
    );

    if (book === null) {
      const name = getChainMeta(chainId)?.name ?? `chain ${chainId}`;
      return {
        error: `Kaleido's order book could not be read on ${name}. Either the protocol isn't deployed there or the RPC is unavailable — do not tell the user the market is empty.`,
        chainId,
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const offers = book.entries
      .filter(
        (e) =>
          !token ||
          e.tokenAddress.toLowerCase() === token.address.toLowerCase(),
      )
      .map((e) => {
        let amount: string | null = null;
        try {
          amount = ethers.formatUnits(
            e.amountRaw,
            getTokenDecimals(chainId, e.tokenAddress),
          );
        } catch {
          amount = null;
        }
        return {
          id: e.id,
          asset: symbolFor(chainId, e.tokenAddress),
          amount,
          aprBps: e.interestBps,
          maturesUnix: e.returnDateUnix || null,
          termDays:
            e.returnDateUnix > nowSec
              ? Number(((e.returnDateUnix - nowSec) / 86_400).toFixed(1))
              : null,
          counterparty: e.counterparty,
        };
      })
      // Drop anything already past maturity — it isn't fillable.
      .filter((o) => o.termDays !== null)
      // Borrowers want the cheapest rate first; lenders the richest.
      .sort((a, b) => (wantLend ? b.aprBps - a.aprBps : a.aprBps - b.aprBps))
      .slice(0, 12);

    const chainName = getChainMeta(chainId)?.name ?? `chain ${chainId}`;
    /* Said out loud when the scan hit its cap, because "12 offers" and "the 12
       best offers of everything open" are different claims and only one of them
       is true here. */
    const partial = book.scanned < book.total;

    return {
      venue: "Kaleido",
      chainId,
      side: wantLend ? "lend" : "borrow",
      asset: token?.symbol ?? "all",
      offers,
      note:
        (offers.length === 0
          ? `No open offers on ${chainName}${token ? ` for ${token.symbol}` : ""}. Suggest the user post their own offer at the rate they want. `
          : "aprBps is an annual rate in basis points (100 bps = 1%). Use getQuote with a specific amount and maturity to compute the real cost over the term before comparing offers. ") +
        (partial
          ? `Read the ${book.scanned} most recent of ${book.total} ${wantLend ? "requests" : "listings"} ever posted, so older open offers may exist. `
          : "") +
        `These are the offers on ${chainName}, the chain the user is connected to. Kaleido's book is per-chain — an offer on another deployment cannot be filled from here.`,
      coverage:
        "Only Kaleido's own order book is indexed here. You may reason about external protocols in general terms, but never state a specific external rate as fact.",
    };
  } catch (err) {
    return { error: `getMarkets failed: ${(err as Error).message}` };
  }
}

/**
 * Chains swept by the balance indexer, all of which must be registered in
 * src/constants/chains.ts — that is where their RPC URLs come from, and a chain
 * listed here but absent there is silently skipped rather than read.
 */
const INDEXED_CHAINS = [
  2741,
  11124, // Abstract
  1,
  11155111, // Ethereum / Sepolia
  8453,
  84532, // Base / Base Sepolia
  56,
  97, // BSC / BSC Testnet
  4663,
  46630, // Robinhood Chain / Testnet
  5042002, // Arc Testnet
  137,
  42161,
  999, // Polygon, Arbitrum, Hyperliquid
];

/**
 * Cross-chain balance read.
 *
 * Reuses fetchOmniAssetBalance (constants/utils/omniChainBalances.ts), which is
 * pure ethers against a read-only RPC per chain, so it runs server-side
 * unchanged. A chain whose RPC errors resolves to "0" inside the indexer rather
 * than rejecting, so one dead endpoint degrades a single row instead of the whole
 * read; a chain with no RPC in the registry, or one where the asset is not issued
 * at all, is dropped entirely instead, since "0" there would assert a balance
 * nobody checked. Every id in INDEXED_CHAINS is registered, so the missing-RPC
 * case is a guard rather than a live path — the not-issued case is very much
 * live, and is the correct answer for "my ETH balance" on BSC.
 */
async function getChains(args: Json): Promise<Json> {
  const address = String(args.address ?? "");
  const asset = String(args.asset ?? "").toUpperCase();

  if (!ethers.isAddress(address)) {
    return { error: "A valid wallet address is required" };
  }

  /*
   * What the indexer can resolve, asked of the indexer rather than remembered.
   *
   * Was a literal `["ETH","USDC","USDT","USDR","kfUSD"]`, and it had already
   * drifted twice over: USDR was removed from the registry (no deployment on any
   * of the five chains), and the list was blind to every canonical token the
   * registry does carry — WETH, WBTC, DAI, EURC, each chain's own native symbol.
   * So the tool refused assets it could read and offered one it could not.
   * indexedAssets() enumerates the same resolver fetchOmniAssetBalance uses, so
   * the advertised set and the readable set cannot disagree.
   */
  const SUPPORTED = indexedAssets(INDEXED_CHAINS);
  const match = SUPPORTED.find((s) => s.toUpperCase() === asset);
  if (!match) {
    return {
      error: `Cross-chain balances are not indexed for "${asset}"`,
      indexedAssets: SUPPORTED,
    };
  }

  try {
    const result = await fetchOmniAssetBalance(address, match, INDEXED_CHAINS);
    const byChain = result.chains.map((c) => ({
      chain: c.chainName,
      chainId: c.chainId,
      balance: c.balance,
    }));

    return {
      asset: result.token,
      totalBalance: result.totalBalance,
      // The indexer filters out zero balances, so this is where funds actually are.
      byChain,
      note:
        byChain.length === 0
          ? "No balance found for this asset on any indexed chain."
          : byChain.length > 1
            ? "Holdings span multiple chains. Call getBridgeRoute for the real cost and time of moving them. Kaleido still cannot execute a bridge itself, so present it as a manual step the user completes with the provider, never as a signable action."
            : "All holdings for this asset are on a single chain.",
    };
  } catch (err) {
    return { error: `getChains failed: ${(err as Error).message}` };
  }
}

/**
 * Spot USD price for one asset.
 *
 * This tool exists because its absence was expensive in a way that did not look
 * like a bug. "What is the price of ETH" is the most ordinary question a trading
 * surface receives, and with no handler for it the model did the reasonable
 * thing: it called getMarkets, found no ETH offers, was seeded getPortfolio, got
 * nulls, and spent the entire MAX_READ_ROUNDS budget — four provider round
 * trips, thirty to sixty seconds — before answering that it could not find out.
 * Correct, grounded, and useless. A read tool that returns the number in one
 * round replaces all of it.
 *
 * Priced off the chart's own allowlist, so there is exactly one place that
 * decides what Kaleido claims to know a price for. KLD, kfUSD, kafUSD and stKLD
 * are deliberately absent from it — they have no market because they have no
 * deployment — and this returns the "no feed" answer for them rather than a
 * number, which is the honest result and the one the model can relay.
 */
async function getPrice(args: Json): Promise<Json> {
  const asset = String(args.asset ?? "").trim();
  if (!asset) return { error: "An asset symbol is required, e.g. ETH" };

  try {
    const spot = await getSpotPrice(asset);

    /* Not an error: the request was well-formed, we just do not price that
       asset. The model has to be able to say which of the two happened, so the
       shape it gets back differs. */
    if (!spot) {
      return {
        asset: asset.toUpperCase(),
        priced: false,
        pricedAssets: PRICED_SYMBOLS,
        note: `No price feed for "${asset.toUpperCase()}". Kaleido's own tokens (KLD, kfUSD, kafUSD, stKLD) have no market price to read. Say so plainly — do not estimate one, do not substitute a different asset's price, and do not speculate about why.`,
      };
    }

    const ageSec = Math.round((Date.now() - spot.asOf) / 1000);
    return {
      asset: spot.symbol,
      priced: true,
      usd: spot.usd,
      change24hPct: spot.change24hPct,
      asOfSecondsAgo: ageSec,
      source: "CoinGecko",
      note:
        "Spot mid price in USD, for reference only. Wrapped and bridged assets " +
        "(WETH, WBTC, cbBTC, BTCB) are priced as their underlying. Never size a " +
        "swap or a collateral amount from this — the DEX quote at execution is " +
        "the only number that binds." +
        (ageSec > 90
          ? ` This reading is ${ageSec}s old because the live fetch failed; tell the user it is stale.`
          : ""),
    };
  } catch (err) {
    return {
      error: `getPrice failed: ${(err as Error).message}`,
      note: "The price feed is unreachable. Say that rather than estimating.",
    };
  }
}

/**
 * Bridge quote. Kaleido cannot execute the bridge, so this is strictly a read:
 * it tells the user what a move would cost and who would perform it.
 */
async function getBridgeRoute(args: Json): Promise<Json> {
  const result = await getBridgeQuote({
    fromChain: String(args.fromChain ?? ""),
    toChain: String(args.toChain ?? ""),
    asset: String(args.asset ?? ""),
    amount: String(args.amount ?? ""),
    address: args.address ? String(args.address) : undefined,
  });
  return result as unknown as Json;
}

/**
 * Whether a swap can be routed, and through what — without proposing it.
 *
 * WHY THIS TOOL HAD TO EXIST. Nothing in the catalog could answer "can I get KLD
 * with my ETH?" or "what would 0.1 ETH get me?". The only DEX tool was `swap`, an
 * execute tool, so the model's choices were to propose a transaction the user had
 * not asked for — a plan card, a signature request, and an audit against their
 * spend caps, in answer to a question — or to guess. Both are wrong, and the guess
 * was wrong in a specific and repeatable way: the model would reach for `getPrice`
 * (which does not price KLD, kfUSD, kafUSD or stKLD, and says so) and conclude the
 * pair could not be traded, when KLD/USDC is the best-seeded pool on two chains.
 *
 * AND IT IS WHERE THE ROUTING FINALLY BECOMES SAYABLE. `findBestRoute` has been
 * quoting two-hop paths for the plan builder and the Swap card since the routing
 * fix, and the model was never told: its `swap` description described a pool, so
 * the honest answer it could give about a pair with no direct pool was "there
 * isn't one". This returns the hops, so the model can say ETH → USDC → KLD and be
 * describing the route the plan would actually take — the same function, the same
 * quoter, the same tie-breaks.
 *
 * Native currency resolves through `poolSide` here exactly as it does in the
 * builder, so "can I swap ETH for KLD" is answered about the wrapped pools the
 * trade would really touch, and the reply still names ETH.
 *
 * The quote is explicitly NOT a floor. `amountOut` is what the pools would fill
 * right now; the slippage minimum is set from the user's own setting at build
 * time, and the note says so, because a model that relays this number as
 * guaranteed has promised something no pool can honour.
 */
async function getSwapRoute(args: Json, chainId: number): Promise<Json> {
  const inSym = String(args.tokenIn ?? "").trim();
  const outSym = String(args.tokenOut ?? "").trim();
  /* Default rather than required. "Is there a route from ETH to KLD?" is a real
     question with no amount in it, and a tool that refused it would send the
     model back to guessing — which is the behaviour this replaces. One unit is
     enough to establish that pools exist and to state a rate; it is a poor
     estimate of a large fill, so the note says which of the two the caller got. */
  const raw = String(args.amount ?? "").trim();
  const sized = raw !== "" && Number(raw) > 0;
  const amount = sized ? raw : "1";

  if (!inSym || !outSym)
    return { error: "Two token symbols are required, e.g. tokenIn ETH, tokenOut KLD" };

  if (!getContracts(chainId).v3Router)
    return {
      routable: false,
      note: "Kaleido's DEX isn't deployed on this chain, so no swap can be routed here — not a liquidity problem.",
    };

  const meta = getChainMeta(chainId);
  const inEntry = resolveUserToken(meta, inSym, "dex");
  const outEntry = resolveUserToken(meta, outSym, "dex");
  if (!inEntry || !outEntry)
    return {
      error: `I don't know a token called ${!inEntry ? inSym : outSym} on this chain.`,
      tokens: chainTokens(chainId)
        .map((t) => t.symbol)
        .join(", "),
    };

  /* The wrapped substitution, from the same function build.ts uses. Without it
     this tool would answer "no route" for every native pair — which is the
     default state of the Swap card — and would be quoting a sentinel while doing
     it. */
  const sell = poolSide(chainId, toIToken(inEntry));
  const buy = poolSide(chainId, toIToken(outEntry));
  if (!sell || !buy)
    return {
      routable: false,
      note: "That pair needs the chain's wrapped native currency to route through, and none is recorded here. Our deployment records, not the user's request.",
    };

  if (sell.token.address.toLowerCase() === buy.token.address.toLowerCase())
    return {
      routable: false,
      sameAsset: true,
      note: `${sell.token.symbol} and ${buy.token.symbol} are the same asset — one is the wrapped form of the other, held one for one. There is no pool between them and there never will be; say that rather than reporting missing liquidity.`,
    };

  try {
    /* Ours first, then any external fallback venue — the same order and helper
       buildIntents uses, so the route this tool reports is the route the plan
       will build. Capped at two intermediates, unlike the Swap card's unbounded
       search: this runs inside a chat turn already several round trips deep. */
    const path = await findRouteAcrossSources(
      chainId,
      sell.token,
      buy.token,
      amount,
      [
        {
          quote: serverPathQuoter(chainId),
          router: getContracts(chainId).v3Router,
          venue: null,
        },
        ...fallbackVenues(chainId).map((venue) => ({
          quote: serverPathQuoter(chainId, venue.quoter),
          router: venue.router,
          venue,
        })),
      ],
      { maxIntermediates: 2 },
    );

    if (!path)
      return {
        routable: false,
        tokenIn: sell.token.symbol,
        tokenOut: buy.token.symbol,
        triedTiers: FEE_TIERS.map((f) => `${f / 10_000}%`),
        triedVia: intermediateTokens(chainId).map((t) => t.symbol),
        note: "No pool at any tier and no two-hop route either. Report which tiers and intermediates were tried — a bare 'not supported' reads as a missing feature when it is missing liquidity.",
      };

    const rate = path.amountOut / Number(amount);
    return {
      routable: true,
      tokenIn: sell.token.symbol,
      tokenOut: buy.token.symbol,
      amountIn: amount,
      amountOut: path.amountOut,
      rate: `1 ${sell.token.symbol} ≈ ${Number(rate.toPrecision(6))} ${buy.token.symbol}`,
      hops: path.hops.map((h) => ({
        from: h.symbolIn,
        to: h.symbolOut,
        feeTier: `${h.fee / 10_000}%`,
      })),
      route: describeRoute(path),
      /* Named only for a fallback venue; our own pools are the default. */
      venue: path.venue?.label ?? null,
      nativeIn: sell.native,
      nativeOut: buy.native,
      note:
        `A live pool quote, not a promise: the minimum output is set from the user's own slippage setting when the swap is built, and this number moves with the pools. ` +
        (sized
          ? "Quoted at the amount asked about, so it includes that size's price impact."
          : "No amount was given, so this is quoted at 1 unit — state it as an indicative rate and re-quote before claiming what a specific size would fill.") +
        (path.hops.length > 1
          ? ` This routes through ${path.hops.length} pools, so ${path.hops.length} fee tiers are charged.`
          : "") +
        (sell.native || buy.native
          ? ` The chain's own currency is ${sell.native ? "spent" : "received"} here; the pools hold its wrapped form, which the router wraps and unwraps inside the transaction. Talk about it as ${sell.native ? sell.token.symbol : buy.token.symbol}.`
          : ""),
    };
  } catch (err) {
    return {
      error: `getSwapRoute failed: ${(err as Error).message}`,
      note: "The quoter is unreachable. Say that rather than concluding the pair cannot be traded.",
    };
  }
}

/**
 * Handlers take the chain even when they don't read one.
 *
 * `getPrice` (CoinGecko), `getChains` (sweeps INDEXED_CHAINS) and
 * `getBridgeRoute` (chains named in the args) are chain-independent here, so they
 * simply declare fewer parameters — TypeScript accepts that, and it keeps the fact
 * that they don't take one visible in their signatures rather than buried in an
 * ignored argument. `getMarkets` used to be in that list, pinned to
 * `LENDING_CHAIN_ID` because the mirror tables it read carry no chain column; it
 * reads the caller's own diamond now and takes the chain like the rest.
 */
/**
 * One fragment, because one value is read.
 *
 * One value is read, so one fragment is imported rather than the artifact, and
 * a single `view returns (uint16)` is stable ABI regardless. The width matters:
 * it is a `uint16 public` in the contract
 * (KaleidoOrders.sol:183), and an ABI fragment is what decodes the returned word.
 * See `swapInputFor` in dex/orders.ts for what the value does.
 */
const ORDERS_FEE_ABI = ["function fillerFeeBps() external view returns (uint16)"];

/**
 * Resting limit orders and recurring buys, from our own store.
 *
 * The one read tool that queries no protocol contract, because there is nothing
 * to query: a signed order is a signature until someone fills it, so KaleidoOrders
 * holds only signatures' consequences and the book itself lives in Supabase.
 *
 * Two sources in one answer, and the split is worth being exact about because the
 * model relays both. Everything about WHAT the order is — the amounts, the floor,
 * the schedule, whether its start time has passed, whether its interval has
 * elapsed since the last fill — comes from the stored row, which is the object the
 * signature was computed over and therefore authoritative. Only `awayPct` is a
 * live read, quoted off the pool. So a stale pool read makes one field vague; it
 * cannot misdescribe the order.
 *
 * `hash` is in every row whether or not the rest of it could be described. It is
 * the handle a cancel keys on, so an order in a token this registry cannot name
 * still lists - a failed symbol lookup drops the amounts and keeps the order,
 * because a cancel names no amount.
 *
 * No cancel TOOL exists yet, though: the `cancelOrder`/`cancelAllOrders` intents
 * shipped with the limit page but nothing maps a model's call onto them. Until
 * that lands this tool is read-only and its note says so rather than offering
 * something the agent cannot do.
 */
async function getOrders(args: Json, chainId: number): Promise<Json> {
  const address = String(args.address ?? "");
  if (!ethers.isAddress(address))
    return { error: "A valid wallet address is required" };

  const chainName = getChainMeta(chainId)?.name ?? `chain ${chainId}`;

  /* Answered by name rather than by an empty list, because the two mean opposite
     things to the next turn: no contract here means the user cannot place one
     either, while an empty list on a live chain is an invitation to place one. */
  if (!getContracts(chainId).orders) {
    return {
      chainId,
      chain: chainName,
      orders: [],
      note: `Limit orders and recurring buys aren't live on ${chainName} yet, so this wallet cannot have any resting here. Say that rather than reporting an empty list, and do not offer to place one on this chain.`,
    };
  }

  let rows;
  try {
    rows = await readOpenOrders(address, chainId);
  } catch {
    /* Never an empty list. "You have no resting orders" would invite placing a
       duplicate of one that is already out there and fillable. */
    return {
      error:
        `Couldn't read the order book, so it is unknown whether this wallet has ` +
        `resting orders on ${chainName}. Do NOT say there are none, and do not ` +
        `place a new order until this has been read — it could duplicate one ` +
        `that is already resting.`,
    };
  }

  /*
   * The filler's cut, read once for the whole batch rather than per row.
   *
   * It is zero today and capped at 1%, but it has to be read rather than assumed
   * because it changes the input the pool is quoted on: a filler swaps
   * `amountIn` minus the fee, so quoting the full amount overstates the output
   * and makes every order look closer to filling than it is. Defaulting to 0 on a
   * failed read leaves the quote optimistic by at most the fee, which is the
   * right direction for a value that is currently exactly that.
   */
  let feeBps = 0;
  try {
    const provider = providerForChain(chainId);
    if (provider) {
      const c = new ethers.Contract(
        getContracts(chainId).orders as string,
        ORDERS_FEE_ABI,
        provider,
      );
      feeBps = Number(await retryRpc(() => c.fillerFeeBps()));
    }
  } catch {
    /* Left at 0. See above. */
  }

  const now = Math.floor(Date.now() / 1000);

  const orders = await Promise.all(
    rows.map(async (row) => {
      const o = row.order;
      const tin = chainTokenByAddress(chainId, o.tokenIn);
      const tout = chainTokenByAddress(chainId, o.tokenOut);

      /* Derived from the row, not from the chain: every one of these values is
         inside the signature, so the stored copy cannot be stale relative to what
         the contract will enforce. */
      const fillsLeft = Math.max(0, o.maxFills - row.fills);
      /*
       * Three answers, because `nextFillAt` has three — and each one is a different
       * sentence rather than a different number. A future timestamp is a wait the
       * user can be told the length of; 0 is an order whose rounds are spent and is
       * only here because the keeper has not reconciled the row yet; null is a row
       * whose last fill has no recorded time, and the only honest thing to say about
       * that is that we cannot time it. See dex/orders.ts for why none of the three
       * collapses into another.
       */
      const next = nextFillAt(row);
      const timing =
        next === null
          ? "unknown — the book has recorded fills for this order but not when the last one happened, so its next fill can't be timed"
          : next === 0
            ? "no — it has used all its fills already"
            : next > now
              ? row.fills > 0
                ? `not yet — its next fill can't happen for another ${describeDuration(next - now)}`
                : `not yet — it doesn't start for another ${describeDuration(next - now)}`
              : "yes — its terms allow a fill now, so only the price decides";

      const base: Json = {
        hash: row.hash,
        /* Both forms. The full digest is what `cancel` needs; the short one is
           what a model should put in front of the user, and offering only the
           full one produced sentences with 66 hex characters in them. */
        shortHash: shortHash(row.hash),
        pair: pairLabelFor(o, tin?.symbol, tout?.symbol),
        kind: o.maxFills > 1 ? "recurring buy" : "limit order",
        ...(o.maxFills > 1
          ? { every: describeInterval(o.interval), fillsDone: row.fills, fillsLeft }
          : {}),
        expiresIn: describeDuration(Math.max(0, o.expiry - now)),
        /* Unconditional, and phrased as an answer rather than as a flag. An absent
           key would leave "the terms permit a fill now" to be inferred from the
           absence of a wait, and a model that missed the inference would report a
           resting order as though nothing had been said about its schedule. */
        eligibleForAFillNow: timing,
      };

      /* Amounts need declared decimals, and a token this registry cannot name has
         none to declare. The order still lists — it can still be cancelled, and a
         cancel names no amount — but nothing here will guess a scale. */
      if (!tin || !tout) {
        return {
          ...base,
          note: `Amounts unavailable: this order is in a token Kaleido has no declared decimals for, so its size and floor cannot be stated accurately. It can still be cancelled by hash.`,
        };
      }

      const amountIn = ethers.formatUnits(o.amountIn, tin.decimals);
      const minOut = ethers.formatUnits(o.minOut, tout.decimals);

      /*
       * How far the pool is from the floor, in percent, and the sign is the whole
       * answer: at or below zero the order can fill on the next keeper pass, above
       * zero it waits. Every tier at once for the reason build.ts gives — a pair
       * whose pool is at the last tier would otherwise read as unpriceable.
       */
      const swapIn = ethers.formatUnits(
        swapInputFor(BigInt(o.amountIn), feeBps),
        tin.decimals,
      );
      const quotes = await Promise.all(
        FEE_TIERS.map((fee) =>
          serverQuote(chainId, {
            tokenIn: o.tokenIn,
            tokenOut: o.tokenOut,
            amountIn: swapIn,
            fee,
            decimalsIn: tin.decimals,
            decimalsOut: tout.decimals,
          }).catch(() => null),
        ),
      );
      let market: number | null = null;
      for (const q of quotes) {
        const n = Number(q);
        if (q && Number.isFinite(n) && n > 0 && (market === null || n > market))
          market = n;
      }
      const floorNum = Number(minOut);
      const awayPct =
        market !== null && floorNum > 0
          ? Number((((floorNum - market) / market) * 100).toFixed(2))
          : null;

      return {
        ...base,
        sells: `${amountIn} ${tin.symbol}${o.maxFills > 1 ? " per fill" : ""}`,
        floor: `at least ${minOut} ${tout.symbol}${o.maxFills > 1 ? " per fill" : ""}`,
        /* Null is "no pool to quote", never "at the market". A model told 0 would
           report an order as ready to fill on a pair that cannot be traded. */
        awayPct,
        canFillOnPriceNow: awayPct === null ? null : awayPct <= 0,
      };
    }),
  );

  return {
    chainId,
    chain: chainName,
    orders,
    note:
      (orders.length === 0
        ? `This wallet has no resting orders on ${chainName}. `
        : `${orders.length} resting on ${chainName}. `) +
      "These are signatures, not transactions: nothing has moved for any of them, and the wallet's balance is untouched until one fills. " +
      "A fill needs two things at once, so do not report either one alone as 'about to fill': `eligibleForAFillNow` is whether the order's own terms permit a fill this second, and `awayPct` is how far its floor sits above the pool's live price — 0 or below means the price is there. A null awayPct means the pair has no pool to quote, which is not the same as ready. " +
      "Never say an order will fill: the floor guarantees the price it fills at, not that anyone fills it, and an order can rest until it expires. " +
      "Everything except awayPct comes from the signed order itself. " +
      "Cancelling is not something you can do yet - there is no cancel tool - so do not offer to. " +
      "Point the user at the Limit tab under Trade, where each resting order has its own cancel, and give them the shortHash so they can find the right one.",
  };
}

async function getPositions(args: Json, chainId: number): Promise<Json> {
  const address = typeof args.address === "string" ? args.address : undefined;
  if (!address) return { error: "getPositions needs the wallet address." };
  try {
    const positions = await serverPositions(chainId, address);
    if (positions.length === 0) {
      return {
        positions: [],
        note:
          "No liquidity positions on chain " +
          chainId +
          ". Positions are per chain, so the user may hold some on another network.",
      };
    }
    const provider = providerForChain(chainId);
    const rows = await Promise.all(
      positions.map(async (p) => {
        const pair = `${symbolFor(chainId, p.token0)} / ${symbolFor(chainId, p.token1)}`;
        const closed = p.liquidity === "0";
        /* positions() returns token0/token1 pre-sorted, so readPoolState reads
           the pool in its own order and returns the RAW tick — comparable
           directly to the position's tick range, no inversion. */
        let status = "unknown";
        if (closed) {
          status = "closed";
        } else if (provider) {
          const state = await readPoolState(
            provider,
            chainId,
            p.token0,
            p.token1,
            p.fee,
            getTokenDecimals(chainId, p.token0),
            getTokenDecimals(chainId, p.token1),
          );
          if (state) {
            status =
              state.tick >= p.tickLower && state.tick < p.tickUpper
                ? "in range"
                : "out of range";
          }
        }
        return {
          id: p.tokenId,
          pair,
          feePct: p.fee / 10_000,
          status,
          needsAttention: status === "out of range",
        };
      }),
    );
    return {
      positions: rows,
      note:
        "Each id is one liquidity position. Deposited amounts and unclaimed fees show in the app's Liquidity → Your positions tab, not here; to act, use collectFees, increasePosition or removePosition with the id, so the user need not look it up. 'out of range' earns no fees until the price returns or the range is moved.",
    };
  } catch (err) {
    return { error: `getPositions failed: ${(err as Error).message}` };
  }
}

const HANDLERS: Record<string, (args: Json, chainId: number) => Promise<Json>> =
  {
    getQuote,
    getPortfolio,
    getPositions,
    getBalances,
    getMarkets,
    getOrders,
    getPrice,
    getChains,
    getBridgeRoute,
    getSwapRoute,
  };

export function isReadTool(name: string): boolean {
  return name in HANDLERS;
}

/**
 * Runs one read tool against one chain.
 *
 * `chainId` is the connected wallet's chain, threaded from the request. Falling
 * back to `READ_ONLY_CHAIN_ID` when it is absent is the walletless case the
 * constant exists for, and resolving it here — once, rather than inside each
 * handler — is deliberate: several handlers run concurrently in a round and their
 * results are concatenated into one context block for the model, so two of them
 * disagreeing about which chain they described would be invisible in the output
 * and unrecoverable in the model's reasoning.
 */
export async function runReadTool(
  name: string,
  args: Json,
  chainId?: number,
): Promise<Json> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown read tool: ${name}` };
  try {
    return await handler(args, chainId ?? READ_ONLY_CHAIN_ID);
  } catch (err) {
    return { error: `${name} threw: ${(err as Error).message}` };
  }
}
