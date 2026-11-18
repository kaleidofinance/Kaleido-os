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
import { readSynthraLaunchpadToken } from "@/lib/synthraLaunchpad/server";

const ERC20 = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

/**
 * Resolve a contract address on a given chain into verified TokenFacts
 * (quote asset -> launchpad metadata -> listed registry -> raw ERC-20).
 */
export async function resolveTokenFacts(
  chainId: number,
  rawAddr: string,
): Promise<{ status: number; facts: TokenFacts }> {
  if (!isAddress(rawAddr)) {
    return {
      status: 400,
      facts: {
        ok: false,
        address: rawAddr,
        reason: "That isn't a contract address.",
      },
    };
  }
  const address = getAddress(rawAddr);

  const provider = providerForChain(chainId);
  if (!provider) {
    return {
      status: 503,
      facts: {
        ok: false,
        address,
        reason: "No RPC available for this chain right now.",
      },
    };
  }

  if (
    chainId === ARGUS_CHAIN_ID &&
    address.toLowerCase() === ARC_USDC.toLowerCase()
  ) {
    return {
      status: 200,
      facts: {
        ok: true,
        isQuote: true,
        address,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
      },
    };
  }
  if (
    chainId === ELYSIUM_CHAIN_ID &&
    address.toLowerCase() === ELYSIUM_USDC.toLowerCase()
  ) {
    return {
      status: 200,
      facts: {
        ok: true,
        isQuote: true,
        address,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
      },
    };
  }

  const erc = new Contract(address, ERC20, provider);
  const ercReads = Promise.all([
    erc
      .symbol()
      .then(String)
      .catch(() => undefined),
    erc
      .name()
      .then(String)
      .catch(() => undefined),
    erc
      .decimals()
      .then(Number)
      .catch(() => undefined),
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
          return {
            status: 200,
            facts: {
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
              ...(launch.buyTaxBps != null
                ? { buyTaxBps: launch.buyTaxBps }
                : {}),
              ...(launch.sellTaxBps != null
                ? { sellTaxBps: launch.sellTaxBps }
                : {}),
            },
          };
        }
      }
    } catch {
      /* an Elysium launch lookup hiccup is not fatal — fall through to the registry */
    }
  }

  if (chainId === ARGUS_CHAIN_ID) {
    try {
      const launch = await readArgusLaunch(address);
      if (launch) {
        const [state, [symbol, name, dec, supply]] = await Promise.all([
          readArgusPoolState(launch),
          ercReads,
        ]);
        const decimals = dec ?? 18;
        const priceUsd =
          state && state.pricePerTokenInQuote > 0
            ? state.pricePerTokenInQuote
            : null;
        const marketCapUsd =
          priceUsd != null && supply != null
            ? priceUsd * (Number(supply) / 10 ** decimals)
            : null;
        return {
          status: 200,
          facts: {
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
          },
        };
      }
    } catch {
      /* an Argus read hiccup is not fatal — fall through to the registry */
    }

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
        {
          publicClient: peachClient,
          deployment: sdk.arcMainnetLaunchpadDeployment,
        },
        address as `0x${string}`,
      );
      if (isPeach) {
        const [symbol, name, dec] = await ercReads;
        const decimals = dec ?? 18;
        return {
          status: 200,
          facts: {
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
          },
        };
      }
    } catch {
      /* a Peach lookup hiccup is not fatal — fall through to the registry */
    }
  }

  if (chainId === 4663 || chainId === 5042) {
    try {
      const launch = await readSynthraLaunchpadToken(address, chainId);
      if (launch) {
        return {
          status: 200,
          facts: {
            ok: true,
            source: "synthra",
            launchpadId: launch.launchpadId,
            launchpadLabel: launch.launchpadLabel,
            address,
            symbol: launch.symbol,
            name: launch.name,
            decimals: launch.decimals,
            priceUsd: launch.priceUsd ?? null,
            marketCapUsd: launch.marketCapUsd ?? null,
            ...(launch.imageUrl ? { imageUrl: launch.imageUrl } : {}),
          } as TokenFacts & { imageUrl?: string },
        };
      }
    } catch {
      /* a Synthra lookup hiccup is not fatal — fall through to registry */
    }
  }

  const listed = chainTokens(chainId).find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
  if (listed) {
    return {
      status: 200,
      facts: {
        ok: true,
        source: "listed",
        address,
        symbol: listed.symbol,
        name: listed.name,
        decimals: listed.decimals,
        priceUsd: null,
      },
    };
  }

  const [symbol, name, decimals] = await ercReads;
  if (symbol === undefined || decimals === undefined) {
    return {
      status: 200,
      facts: {
        ok: false,
        address,
        reason:
          "That address isn't a token contract on this network (it may be a wallet or a trading pair).",
      },
    };
  }
  return {
    status: 200,
    facts: { ok: true, source: "unknown", address, symbol, name, decimals },
  };
}
