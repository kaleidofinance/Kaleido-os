import { Contract, getAddress, isAddress } from "ethers";
import { createPublicClient, defineChain, http } from "viem";
import { providerForChain } from "@/config/provider";
import { CHAINS_BY_ID } from "@/constants/chains";
import { chainTokens } from "@/constants/tokens";
import { ARC_USDC, ARGUS_CHAIN_ID } from "@/lib/argus/addresses";
import { readArgusLaunch, readArgusPoolState } from "@/lib/argus/launch";
import { isSnipeWindow } from "@/lib/argus/poolMath";
import {
  ELYSIUM_CHAIN_ID,
  ELYSIUM_USDC,
  isElysiumQuoteToken,
} from "@/lib/elysium/addresses";
import { readElysiumLaunch } from "@/lib/elysium/launch";
import type { TokenFacts } from "@/lib/v2/cards/tokenCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a pasted contract into the facts a token card shows.
 *
 * Server-side because the Argus reads (Portal launch record, StateView price,
 * the hook's surcharge) run over RPC and are gated by the server-only
 * ARGUS_ENABLED. Read-only: this route never builds or signs anything — the
 * card's buttons send ordinary commands, and trading goes through the normal
 * plan path with its own audit and signature.
 *
 * Order of resolution, most specific first: the quote asset itself → an Argus
 * launch (full facts) → a token in this chain's registry → any readable ERC-20
 * (identity only; the card won't offer to trade it). Arc only for now.
 */

const ERC20 = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const json = (body: TokenFacts, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawAddr = url.searchParams.get("address") ?? "";
  const chainId = Number(url.searchParams.get("chainId"));

  if (!isAddress(rawAddr)) {
    return json({ ok: false, address: rawAddr, reason: "That isn't a contract address." }, 400);
  }
  const address = getAddress(rawAddr);

  const provider = providerForChain(chainId);
  if (!provider) {
    return json(
      { ok: false, address, reason: "No RPC available for this chain right now." },
      503,
    );
  }

  if (chainId === ARGUS_CHAIN_ID && address.toLowerCase() === ARC_USDC.toLowerCase()) {
    return json({ ok: true, isQuote: true, address, symbol: "USDC", name: "USD Coin", decimals: 6 });
  }
  if (chainId === ELYSIUM_CHAIN_ID && address.toLowerCase() === ELYSIUM_USDC.toLowerCase()) {
    return json({ ok: true, isQuote: true, address, symbol: "USDC", name: "USD Coin", decimals: 6 });
  }

  const erc = new Contract(address, ERC20, provider);
  /* Start the ERC-20 reads now, alongside the Portal lookup rather than after
     it: Arc's public RPCs are slow (~1–2s a round trip), and a paste should feel
     instant. Both the Argus and the unknown-token paths need these; the listed
     path simply ignores them. */
  const ercReads = Promise.all([
    erc.symbol().then(String).catch(() => undefined),
    erc.name().then(String).catch(() => undefined),
    erc.decimals().then(Number).catch(() => undefined),
    erc.totalSupply().catch(() => null),
  ]);

  if (chainId === ELYSIUM_CHAIN_ID) {
    try {
      const [symbol, name, dec, supply] = await ercReads;
      const decimals = dec ?? 18;
      if (!isElysiumQuoteToken(address)) {
        const launch = await readElysiumLaunch(address, decimals);
        if (launch) {
          const priceUsd =
            launch.priceUsd != null && launch.priceUsd > 0
              ? launch.priceUsd
              : null;
          const marketCapUsd =
            priceUsd != null && supply != null
              ? priceUsd * (Number(supply) / 10 ** decimals)
              : null;
          return json({
            ok: true,
            source: "elysium",
            launchpadId: launch.launchpad,
            launchpadLabel: launch.launchpadLabel,
            address,
            symbol,
            name,
            decimals,
            priceUsd,
            marketCapUsd,
            ...(launch.buyTaxBps != null ? { buyTaxBps: launch.buyTaxBps } : {}),
            ...(launch.sellTaxBps != null
              ? { sellTaxBps: launch.sellTaxBps }
              : {}),
          });
        }
      }
    } catch {
      /* an Elysium launch lookup hiccup is not fatal — fall through to the registry */
    }
  }

  // 1. An Argus launch — the verified buy + sell path, so it gets the full card.
  if (chainId === ARGUS_CHAIN_ID) {
  try {
    const launch = await readArgusLaunch(address);
    if (launch) {
      const [state, [symbol, name, dec, supply]] = await Promise.all([
        readArgusPoolState(launch),
        ercReads,
      ]);
      const decimals = dec ?? 18;
      // The quote is USDC on Arc, so price-in-quote is price in USD.
      const priceUsd = state && state.pricePerTokenInQuote > 0 ? state.pricePerTokenInQuote : null;
      const marketCapUsd =
        priceUsd != null && supply != null
          ? priceUsd * (Number(supply) / 10 ** decimals)
          : null;
      return json({
        ok: true,
        source: "argus",
        launchpadId: "argus",
        launchpadLabel: "Argus launch",
        address,
        symbol,
        name,
        decimals,
        priceUsd,
        marketCapUsd,
        buyTaxBps: launch.buyTaxBps,
        sellTaxBps: launch.sellTaxBps,
        snipeActive: state ? isSnipeWindow(state.snipeBps) : false,
        bonded: state?.bonded ?? false,
      });
    }
  } catch {
    /* an Argus read hiccup is not fatal — fall through to the registry */
  }

  // 2. A Peach launch. Peach's SDK is the source of truth for launch-token
  // membership; unlike Argus, its curve quote is resolved when the card action
  // is pressed, so the card only needs identity here.
  try {
    const sdk = await import("@masterpeach/launchpad-sdk");
    const rpc = CHAINS_BY_ID[chainId]?.rpcUrls?.[0];
    const peachClient = rpc
      ? createPublicClient({
          chain: defineChain({
            id: chainId,
            name: "Arc",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: { default: { http: [rpc] } },
          }),
          transport: http(rpc),
        })
      : null;
    if (!peachClient) throw new Error("Arc RPC unavailable");
    const isPeach = await sdk.isLaunchpadToken(
      { publicClient: peachClient, deployment: sdk.arcMainnetLaunchpadDeployment },
      address as `0x${string}`,
    );
    if (isPeach) {
      const [symbol, name, dec] = await ercReads;
      const decimals = dec ?? 18;
      return json({
        ok: true,
        source: "peach",
        launchpadId: "peach",
        launchpadLabel: "Peach launch",
        address,
        symbol,
        name,
        decimals,
        priceUsd: null,
        marketCapUsd: null,
      });
    }
  } catch {
    /* a Peach lookup hiccup is not fatal — fall through to the registry */
  }
  }

  // 3. A token this chain's registry already lists.
  const listed = chainTokens(chainId).find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
  if (listed) {
    return json({
      ok: true,
      source: "listed",
      address,
      symbol: listed.symbol,
      name: listed.name,
      decimals: listed.decimals,
      priceUsd: null,
    });
  }

  // 4. Any readable ERC-20 — identity only; the card won't route it. No symbol
  //    or decimals back means it isn't a token (a wallet, a pair, a router).
  const [symbol, name, decimals] = await ercReads;
  if (symbol === undefined || decimals === undefined) {
    return json({
      ok: false,
      address,
      reason: "That address isn't a token contract on this network (it may be a wallet or a trading pair).",
    });
  }
  return json({ ok: true, source: "unknown", address, symbol, name, decimals });
}
