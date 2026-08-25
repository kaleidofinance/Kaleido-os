import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { getTokenFaucetContract } from "@/config/contracts";
import protocolAbi from "@/abi/ProtocolFacet.json";
import erc20Abi from "@/abi/ERC20Abi.json";
import { borrowCurrencies, getContracts } from "@/constants/registry";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { readMarketRow } from "@/lib/lending/book";
import { readPoolState } from "@/lib/dex/pool";
import { resolveBridgeRoute } from "@/lib/bridge/route";
import type {
  FaucetAssetRef,
  LoanRef,
  MarketRow,
  PlanDeps,
  PoolPositionRef,
  QuoteRequest,
} from "@/lib/v2/intents/build";

/**
 * Server-side implementation of PlanDeps.
 *
 * Same five reads useLocalPlanner performs in the browser, done with plain
 * JSON-RPC instead of a wallet provider and a relative fetch. Nothing here
 * shapes an intent — that is build.ts's only job, and the point of this file is
 * that the AI path gets to call it.
 *
 * Every read degrades to a null/empty answer rather than throwing. build.ts
 * turns each of those into a specific refusal the user can act on ("I can't
 * find an open listing #7"), which is more useful than a 500 and keeps one
 * dead RPC from taking down the whole chat turn.
 *
 * EVERY READ TAKES THE CALLER'S CHAIN ID, and that is the whole design of this
 * file rather than a parameter-passing style.
 *
 * It used to take none. `serverPlanDeps` set `chainId: READ_ONLY_CHAIN_ID` and
 * every read resolved against that same constant, so a wallet on any chain but
 * the read chain got a plan built against the read chain's contracts. Measured
 * on the five deployed testnets: `claimTestTokens` was blocked by the auditor on
 * four of them ("faucet is not the faucet this app deploys against"), and — the
 * case that made this urgent — a swap on Base Sepolia PASSED the audit carrying
 * Base's USDC, Base's WETH and *Sepolia's* router as the approve spender. Every
 * address in DEPLOYMENTS is distinct per chain, so mixing two chains in one plan
 * is never harmless: the approve grants allowance to an address the user never
 * chose, on a chain where it holds no code.
 *
 * So the chain id is threaded rather than defaulted. A read on a chain with no
 * RPC in chains.ts gets `null` from `providerForChain` and returns the same
 * empty answer as a dead node — the caller cannot tell those apart and does not
 * need to, because both mean "no data for this chain".
 */

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

/**
 * Position-manager fragments, copied rather than imported.
 *
 * useV3Positions.ts declares the same three, but that file imports
 * thirdweb/react at module scope, so importing from it would pull the wallet
 * stack into a route handler. Three ERC721Enumerable/V3 signatures are stable
 * ABI, not logic that can drift.
 */
const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

/**
 * Quote through the V3 quoter, server-side.
 *
 * quoteExactInputSingle is state-changing on-chain but callable via
 * staticCall, which needs no signer — so the same quote the Swap page gets in
 * the browser is available to a route handler. This is what makes a
 * model-planned swap signable at all: the swap Intent requires amountOutMin,
 * the model was never asked for it, and a plan without it either threw in the
 * resolver or was refused by the auditor.
 *
 * Returns null rather than "0" on failure. The browser hook returns "0", which
 * build.ts already rejects, but null says "no price" without ever looking like
 * a floor of zero — a swap that accepts any output is exactly the plan this
 * whole path exists to prevent.
 *
 * Chain: the quoter address and the provider are both resolved from the SAME
 * chainId, so they cannot point at different networks. A chain with no V3
 * quoter deployed, or none in chains.ts to dial, returns null here rather than
 * constructing a contract at `undefined`.
 */
async function serverQuote(
  chainId: number | undefined,
  req: QuoteRequest,
): Promise<string | null> {
  try {
    const provider = providerForChain(chainId);
    const quoterAddress = getContracts(chainId).v3Quoter;
    if (!provider || !quoterAddress) return null;
    const quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
    const amountInWei = ethers.parseUnits(req.amountIn, req.decimalsIn);
    const amountOutWei = await quoter.quoteExactInputSingle.staticCall(
      req.tokenIn,
      req.tokenOut,
      req.fee,
      amountInWei,
      0,
    );
    const out = ethers.formatUnits(amountOutWei, req.decimalsOut);
    return Number(out) > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * One listing or request, from the diamond.
 *
 * Delegates to `readMarketRow`, which is the same function useLocalPlanner calls
 * in the browser — so the chat API and the agent page cannot disagree about
 * whether an order exists. That file carries the full account of why this reads
 * the chain rather than the `kaleido_listings` / `kaleido_requests` mirror it used
 * to query: measured 2026-08-25, the mirror held zero rows while Sepolia's
 * diamond held an OPEN listing and an OPEN request, so `takeListing 1` refused an
 * order with real tokens escrowed in it.
 */
async function serverMarketRow(
  chainId: number | undefined,
  kind: "listings" | "requests",
  id: number,
): Promise<MarketRow | null> {
  return readMarketRow(providerForChain(chainId), chainId, kind, id);
}

/**
 * The wallet's open loans, for repay.
 *
 * getPortfolio deliberately returns only collateral and health, so this is a
 * separate read. Tuple indices match useGetActiveRequest.ts's live decoding
 * (requestId 1, totalRepayment 5, tokenAddress 8, status 10) — note that file
 * also carries a commented-out earlier decoding with different indices; those
 * are stale and would misread every field.
 *
 * totalRepaymentRaw is kept as the raw base-unit string. repayLoan is handed
 * that value, not the formatted one: repaying a rounded number underpays the
 * loan, and the contract will not close it.
 *
 * The diamond comes from the registry, not from
 * `envVars.lendbitDiamondAddress`. That env var is ONE address for every chain —
 * the same shape of bug that retired NEXT_PUBLIC_TOKENFAUCET_ADDRESS — so it
 * cannot answer "which diamond serves this wallet's chain" even in principle.
 * The five deployed testnets have five distinct diamonds.
 */
async function serverLoans(
  chainId: number | undefined,
  address: string | undefined,
): Promise<LoanRef[]> {
  const provider = providerForChain(chainId);
  const diamond = getContracts(chainId).diamond;
  if (!provider || !diamond || !address || !ethers.isAddress(address))
    return [];
  try {
    const contract = new ethers.Contract(diamond, protocolAbi, provider);
    const res = await contract.getUserActiveRequests(address);
    const loans: LoanRef[] = [];
    for (const req of res ?? []) {
      // Status 1 is SERVICED — an open loan someone can repay. Anything else
      // is unfunded, closed or liquidated, and repaying it would revert.
      if (String(Number(req[10])) !== "1") continue;
      const raw = String(req[5]);
      if (!(Number(raw) > 0)) continue;
      const tokenAddress = String(req[8]);
      loans.push({
        requestId: Number(req[1]),
        totalRepayment: ethers.formatUnits(
          raw,
          getTokenDecimals(chainId, tokenAddress),
        ),
        totalRepaymentRaw: raw,
        symbol: symbolOf(chainId, tokenAddress),
        tokenAddress,
      });
    }
    return loans;
  } catch {
    return [];
  }
}

/**
 * Symbol for a lending-side token address, falling back to a truncated address.
 * The fallback is only ever shown in a confirmation line, so an unknown token
 * still produces a plan the user can read rather than a blank label.
 */
function symbolOf(chainId: number | undefined, address: string): string {
  const lower = address.toLowerCase();
  const match = borrowCurrencies(chainId).find(
    (c) => c.address.toLowerCase() === lower,
  );
  return match ? match.symbol : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The wallet's V3 positions, enumerated the same way useV3Positions does:
 * balanceOf, then tokenOfOwnerByIndex per slot, then positions(tokenId).
 *
 * liquidity is kept as the raw uint128 string the position manager stores. It
 * is not a token amount and must never be formatted with token decimals —
 * decreaseLiquidity takes exactly this value.
 */
async function serverPositions(
  chainId: number | undefined,
  address: string | undefined,
): Promise<PoolPositionRef[]> {
  if (!address || !ethers.isAddress(address)) return [];
  try {
    const provider = providerForChain(chainId);
    const managerAddress = getContracts(chainId).v3PositionManager;
    if (!provider || !managerAddress) return [];
    const pm = new ethers.Contract(
      managerAddress,
      POSITION_MANAGER_ABI,
      provider,
    );
    const balance = Number(await pm.balanceOf(address));
    if (!Number.isFinite(balance) || balance <= 0) return [];

    // Capped: a wallet with hundreds of positions would otherwise issue
    // hundreds of sequential RPC calls inside one chat turn.
    const slots = Array.from({ length: Math.min(balance, 40) }, (_, i) => i);
    const found = await Promise.all(
      slots.map(async (i) => {
        try {
          const tokenId = await pm.tokenOfOwnerByIndex(address, i);
          const pos = await pm.positions(tokenId);
          return {
            tokenId: String(tokenId),
            token0: String(pos.token0 ?? pos[2]),
            token1: String(pos.token1 ?? pos[3]),
            liquidity: String(pos.liquidity ?? pos[7]),
          };
        } catch {
          return null;
        }
      }),
    );
    return found.filter(Boolean) as PoolPositionRef[];
  } catch {
    return [];
  }
}

/**
 * What the faucet lists, for one caller.
 *
 * `assetInfo` answers in a single eth_call — drips, the faucet's own stock and
 * this caller's next-claim deadlines together — so the only extra reads are
 * `symbol()` and `decimals()` per asset.
 *
 * Those two are read from the token and not from the registry, which is the one
 * thing worth explaining here: measured against `TOKENS`, the mock USDT and USDe
 * are in no chain's list and the mock USDC is missing from two of the five, so a
 * registry lookup would fail on most of what the faucet hands out. useFaucet.ts
 * carries the same note and the same fallback — a token whose `symbol()` and
 * `decimals()` both fail is not an ERC20, i.e. a misconfigured `setDrip`, and it
 * still comes back so the drip is visible rather than silently dropped. What the
 * 18-decimal fallback can spoil is the amount *printed* in the plan summary;
 * `claim(address)` takes no amount, so the transaction is unaffected.
 *
 * Paused assets are included, because the contract includes them: a zero drip is
 * how an asset is switched off, and build.ts turns that into "paused" rather
 * than "the faucet doesn't have it".
 */
async function serverFaucetAssets(
  chainId: number | undefined,
  address: string | undefined,
): Promise<FaucetAssetRef[]> {
  const provider = providerForChain(chainId);
  if (!provider || !getContracts(chainId).faucet) return [];
  try {
    const faucet = getTokenFaucetContract(provider, chainId);

    /* The zero address stands in for a turn with no wallet bound to it, exactly
       as it does on the faucet page: `claimableAt` returns 0 for an address that
       has never claimed, so every asset reads as claimable — true of a caller we
       cannot identify, and the contract enforces the cooldown regardless. */
    const claimer =
      address && ethers.isAddress(address) ? address : ethers.ZeroAddress;

    const [tokens, amounts, balances, nextClaimAt] = (await faucet.assetInfo(
      claimer,
    )) as [string[], bigint[], bigint[], bigint[]];

    return await Promise.all(
      tokens.map(async (token, i): Promise<FaucetAssetRef> => {
        const erc20 = new ethers.Contract(token, erc20Abi, provider);
        const [symbol, decimals] = await Promise.all([
          erc20.symbol().catch(() => `${token.slice(0, 6)}…${token.slice(-4)}`),
          erc20
            .decimals()
            .then(Number)
            .catch(() => 18),
        ]);
        return {
          address: token,
          symbol: String(symbol),
          decimals,
          /* Base units, unformatted. build.ts compares stock against the drip
             with BigInt arithmetic — a formatted string would put that
             comparison through a float. */
          amountRaw: String(amounts[i]),
          stockRaw: String(balances[i]),
          nextClaimAt: Number(nextClaimAt[i]),
        };
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Assembles the deps for one chat turn, bound to the user's wallet AND chain.
 *
 * `chainId` is the wallet's chain, straight from the request body — the same
 * value /api/chat already hands to `planFromToolCalls` for token resolution and
 * to `auditPlan` for its pins. Passing it here too is what makes those three
 * agree; when this function supplied its own constant instead, the builder
 * resolved contracts on one chain while the auditor pinned against another.
 *
 * `undefined` is a legitimate argument, not a bug to default away. A turn with
 * no chain resolves no contracts, every read returns empty, and build.ts refuses
 * by name ("there's no test-token faucet on this chain"). That is the correct
 * answer for a request that never said where it was — inventing a chain here
 * would be inventing the addresses to sign against.
 */
export function serverPlanDeps(
  address: string | undefined,
  chainId: number | undefined,
): PlanDeps {
  return {
    chainId,
    quote: (req) => serverQuote(chainId, req),
    marketRow: (kind, id) => serverMarketRow(chainId, kind, id),
    positions: () => serverPositions(chainId, address),
    loans: () => serverLoans(chainId, address),
    faucetAssets: () => serverFaucetAssets(chainId, address),
    /* Delegated to the same reader useLocalPlanner and the /pool/new range
       picker call. Sharing it is not tidiness here: a ±10% band that centres on
       one price in the chat and another on the page would put the money in two
       different places, and only one of them would earn. See dex/pool.ts. */
    poolState: (tokenA, tokenB, fee, decimalsA, decimalsB) =>
      readPoolState(
        providerForChain(chainId),
        chainId,
        tokenA,
        tokenB,
        fee,
        decimalsA,
        decimalsB,
      ),
    /* The one dep that can leave this chain's own RPC for an external provider,
       and only for a non-canonical corridor — a canonical one is encoded with no
       call at all. build.ts refuses a bridge before it reaches here when the
       chain is unknown, so this guard is the type-level echo of that, degrading
       to a named refusal rather than calling the resolver with no source chain. */
    bridgeRoute: (req) =>
      chainId === undefined
        ? Promise.resolve({
            error: "Connect a wallet to a supported chain to bridge.",
          })
        : resolveBridgeRoute({
            ...req,
            fromChainId: chainId,
            userAddress: address ?? "",
          }),
  };
}
