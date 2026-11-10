import {
  AbiCoder,
  Contract,
  Interface,
  ZeroAddress,
  ZeroHash,
  concat,
  getAddress,
  isAddress,
  toBeHex,
} from "ethers";
import { providerForChain } from "@/config/provider";
import { swapFeeBps, swapFeeReceiver } from "@/lib/swap/kyberswapServer";
import {
  ELYSIUM_ALLOWANCE_HOLDER,
  ELYSIUM_CHAIN_ID,
  ELYSIUM_KNTQ,
  ELYSIUM_POOL_MANAGERS,
  ELYSIUM_SETTLER_ETH,
  ELYSIUM_SETTLER_FALLBACK,
  ELYSIUM_SETTLER_REGISTRY,
  ELYSIUM_USDC,
  ELYSIUM_V4_NATIVE,
  ELYSIUM_VENUE_ROUTERS,
  ELYSIUM_WHYPE,
  KALOS_V3,
  isElysiumQuoteToken,
} from "./addresses";
import { readElysiumLaunch, type ElysiumLaunch } from "./launch";
import { quoteElysiumV4Hop, quoteKalosV3Hop } from "./quoter";

export interface ElysiumTradeExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
  launchpad?: string;
  launchpadLabel?: string;
}

const abi = AbiCoder.defaultAbiCoder();
const BASIS = 1_000_000n;
const MIN_PRICE = 4295128740n;
const MAX_PRICE = 1461446703485210103287273052203988822378723970341n;
const CONTRACT_BALANCE = 1n << 255n;

const REGISTRY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const ALLOWANCE_HOLDER_IFACE = new Interface([
  "function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)",
]);

const SETTLER_IFACE = new Interface([
  "function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32 zid) payable returns (bool)",
]);

const SETTLER_ACTIONS_IFACE = new Interface([
  "function TRANSFER_FROM(address recipient, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes sig)",
  "function BASIC(address sellToken, uint256 ppm, address pool, uint256 offset, bytes data)",
  "function UNISWAPV4(address recipient, address sellToken, uint256 ppm, uint8 forkId, bool feeOnTransfer, uint256 hashMul, uint256 hashMod, bytes fills, uint256 amountOutMin)",
]);

const SWAP_ROUTER_IFACE = new Interface([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
]);

const UNIVERSAL_ROUTER_IFACE = new Interface([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

const TOKEN_IFACE = new Interface([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function withdraw(uint256 amount)",
]);

const OFFSETS = {
  exactInput: 132n,
  transfer: 36n,
  withdraw: 4n,
} as const;

let cachedSettler: { address: string; expiresAt: number } | null = null;

async function resolveActiveSettler(): Promise<string> {
  const now = Date.now();
  if (cachedSettler && cachedSettler.expiresAt > now) {
    return cachedSettler.address;
  }
  const provider = providerForChain(ELYSIUM_CHAIN_ID);
  if (provider) {
    try {
      const reg = new Contract(ELYSIUM_SETTLER_REGISTRY, REGISTRY_ABI, provider);
      const addr = (await reg.ownerOf(2n)) as string;
      if (isAddress(addr) && addr !== ZeroAddress) {
        const checksummed = getAddress(addr);
        cachedSettler = { address: checksummed, expiresAt: now + 60_000 };
        return checksummed;
      }
    } catch {
      // fall through to fallback
    }
  }
  return ELYSIUM_SETTLER_FALLBACK;
}

const same = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * 0x Settler's perfect hash for UNISWAPV4 token notes (`mulmod(token, mul, mod) % 8`).
 */
function tokensHash(tokens: string[]): [bigint, bigint] {
  const list = tokens.map((t) => BigInt(t));
  for (let mod = 9n; mod < 4096n; mod++) {
    for (let mul = mod >> 1n; mul < mod + (mod >> 1n); mul++) {
      if (new Set(list.map((t) => ((t * mul) % mod) % 8n)).size === list.length) {
        return [mul, mod];
      }
    }
  }
  throw new Error("No token hash for v4 route");
}

function v4ZeroForOne(sell: string, buy: string): boolean {
  return (
    same(sell, ELYSIUM_SETTLER_ETH) ||
    (!same(buy, ELYSIUM_SETTLER_ETH) && BigInt(sell) < BigInt(buy))
  );
}

function encodeV4SingleFill(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  tickSpacing: number,
  hooks: string,
): string {
  const zfo = v4ZeroForOne(tokenIn, tokenOut);
  const priceLimit = zfo ? MIN_PRICE : MAX_PRICE;
  return concat([
    toBeHex(BASIS, 3),
    toBeHex(priceLimit, 20),
    "0x01",
    tokenOut.toLowerCase(),
    toBeHex(fee, 3),
    toBeHex(tickSpacing, 3),
    hooks.toLowerCase(),
    toBeHex(0, 3),
  ]);
}

function encodeVenueRouterCall(
  tokenIn: string,
  tokenOut: string,
  launch: ElysiumLaunch,
  deadline: bigint,
): { data: string; offset: bigint } {
  const a = same(tokenIn, ELYSIUM_SETTLER_ETH)
    ? ZeroAddress
    : tokenIn.toLowerCase();
  const b = same(tokenOut, ELYSIUM_SETTLER_ETH)
    ? ZeroAddress
    : tokenOut.toLowerCase();
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  const settle = abi.encode(
    ["address", "uint256", "bool"],
    [a, CONTRACT_BALANCE, false],
  );
  const swap = abi.encode(
    [
      "tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)",
    ],
    [
      {
        poolKey: {
          currency0,
          currency1,
          fee: launch.poolKey.fee,
          tickSpacing: launch.poolKey.tickSpacing,
          hooks: launch.poolKey.hooks.toLowerCase(),
        },
        zeroForOne: same(a, currency0),
        amountIn: 0n,
        amountOutMinimum: 0n,
        hookData: "0x",
      },
    ],
  );
  const take = abi.encode(["address", "uint256"], [b, 0n]);
  const input = abi.encode(
    ["bytes", "bytes[]"],
    ["0x0b060f", [settle, swap, take]],
  );
  const data = UNIVERSAL_ROUTER_IFACE.encodeFunctionData("execute", [
    "0x10",
    [input],
    deadline,
  ]).toLowerCase();

  if (a !== ZeroAddress) return { data, offset: 0n };
  const word = CONTRACT_BALANCE.toString(16).padStart(64, "0");
  const body = data.slice(10);
  const hits: number[] = [];
  for (let k = 0; k + 64 <= body.length; k += 64) {
    if (body.slice(k, k + 64) === word) hits.push(k / 2);
  }
  if (hits.length !== 1) {
    throw new Error("Venue router call missing single CONTRACT_BALANCE word");
  }
  return { data, offset: BigInt(4 + hits[0]) };
}

function encodeV3Path(tokenIn: string, fee: number, tokenOut: string): string {
  return (
    "0x" +
    tokenIn.toLowerCase().slice(2) +
    fee.toString(16).padStart(6, "0") +
    tokenOut.toLowerCase().slice(2)
  );
}

/**
 * Quote and build an atomic 0x AllowanceHolder -> Settler transaction for any
 * token launched across the 12 Elysium Launchpads (and 5 Uniswap v4 PoolManagers).
 *
 * Supports:
 * - Direct 1-hop trades against the launchpad pool's quote currency (`WHYPE`, `USDC`, `KNTQ`, or `WHYPE <-> HYPE` wrap/unwrap),
 * - Automatic 2-hop bridging via Kalos V3 (`USDC <-> WHYPE <-> HYPE <-> LaunchToken` or `KNTQ <-> WHYPE <-> HYPE <-> LaunchToken`)
 *   when the user's quote asset differs from the launchpad pool's quote currency.
 */
export async function resolveElysiumTrade(args: {
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<ElysiumTradeExecution | null> {
  if (
    !args.tokenIn ||
    !args.tokenOut ||
    !args.address ||
    !isAddress(args.tokenIn.toLowerCase()) ||
    !isAddress(args.tokenOut.toLowerCase()) ||
    !isAddress(args.address.toLowerCase()) ||
    same(args.tokenIn, args.tokenOut)
  ) {
    return null;
  }

  const inIsQuote = isElysiumQuoteToken(args.tokenIn);
  const outIsQuote = isElysiumQuoteToken(args.tokenOut);
  if (inIsQuote === outIsQuote) {
    // Both sides are quote tokens (handled by KyberSwap/LI.FI) or neither is a quote token
    return null;
  }

  const amountIn = BigInt(args.amountUnits);
  if (amountIn <= 0n) return null;

  const side: "buy" | "sell" = inIsQuote ? "buy" : "sell";
  const rawQuote = inIsQuote ? args.tokenIn : args.tokenOut;
  const normalizedQuote =
    same(rawQuote, ELYSIUM_SETTLER_ETH) || same(rawQuote, ZeroAddress)
      ? ELYSIUM_WHYPE
      : rawQuote;
  const userQuote = getAddress(normalizedQuote.toLowerCase());
  const launchToken = getAddress(
    (inIsQuote ? args.tokenOut : args.tokenIn).toLowerCase(),
  );

  const launch = await readElysiumLaunch(launchToken);
  if (!launch) return null;

  const settler = await resolveActiveSettler();
  const recipient = getAddress(args.address.toLowerCase());
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const slipBps = Math.max(1, Math.min(Number(args.slippageBps || 200), 5000));

  // Optional Kaleido integrator fee on the quote token leg (never on the memecoin leg)
  const feeReceiverRaw = swapFeeReceiver();
  const feeBpsVal = swapFeeBps();
  const feeReceiver =
    feeReceiverRaw && isAddress(feeReceiverRaw)
      ? getAddress(feeReceiverRaw)
      : null;
  const feePpm =
    feeReceiver && feeBpsVal > 0 && feeBpsVal <= 300
      ? BigInt(feeBpsVal) * 100n
      : 0n;

  const actions: string[] = [];
  const sellToken = getAddress(
    (same(args.tokenIn, ELYSIUM_SETTLER_ETH) || same(args.tokenIn, ZeroAddress)
      ? ELYSIUM_WHYPE
      : args.tokenIn
    ).toLowerCase(),
  );
  const buyToken = getAddress(
    (same(args.tokenOut, ELYSIUM_SETTLER_ETH) || same(args.tokenOut, ZeroAddress)
      ? ELYSIUM_WHYPE
      : args.tokenOut
    ).toLowerCase(),
  );

  // 1. Pull ERC-20 input from user into Settler through AllowanceHolder
  actions.push(
    SETTLER_ACTIONS_IFACE.encodeFunctionData("TRANSFER_FROM", [
      settler.toLowerCase(),
      {
        permitted: { token: sellToken.toLowerCase(), amount: amountIn },
        nonce: 0n,
        deadline,
      },
      "0x",
    ]),
  );

  // Account for input-side transfer tax on sell (e.g. Obol 1% transfer tax)
  const inTaxBps =
    side === "sell" && launch.sellTaxBps ? BigInt(launch.sellTaxBps) : 0n;
  let heldAmount =
    inTaxBps > 0n ? amountIn - (amountIn * inTaxBps) / 10_000n : amountIn;

  // Input-side integrator fee when buying (userQuote is input)
  if (side === "buy" && feePpm > 0n && feeReceiver) {
    actions.push(
      SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
        userQuote.toLowerCase(),
        feePpm,
        userQuote.toLowerCase(),
        OFFSETS.transfer,
        TOKEN_IFACE.encodeFunctionData("transfer", [
          feeReceiver.toLowerCase(),
          0n,
        ]),
      ]),
    );
    heldAmount -= (heldAmount * feePpm) / BASIS;
  }

  const isSharedPm = same(launch.poolManager, ELYSIUM_POOL_MANAGERS.shared);
  const venueRouter =
    ELYSIUM_VENUE_ROUTERS[launch.poolManager.toLowerCase()] ?? null;
  if (!isSharedPm && !venueRouter) return null;

  const poolUsesNativeHype = same(launch.quoteCurrency, ELYSIUM_V4_NATIVE);
  const poolQuoteErc20 = poolUsesNativeHype
    ? ELYSIUM_WHYPE
    : launch.quoteCurrency;
  const poolQuoteSettlerToken = poolUsesNativeHype
    ? ELYSIUM_SETTLER_ETH
    : launch.quoteCurrency.toLowerCase();

  const appendV4SwapAction = (v4TokenIn: string, v4TokenOut: string) => {
    if (isSharedPm) {
      const [hashMul, hashMod] = tokensHash([v4TokenIn, v4TokenOut]);
      const fills = encodeV4SingleFill(
        v4TokenIn,
        v4TokenOut,
        launch.poolKey.fee,
        launch.poolKey.tickSpacing,
        launch.poolKey.hooks,
      );
      actions.push(
        SETTLER_ACTIONS_IFACE.encodeFunctionData("UNISWAPV4", [
          settler.toLowerCase(),
          v4TokenIn.toLowerCase(),
          BASIS,
          0,
          false,
          hashMul,
          hashMod,
          fills,
          0n,
        ]),
      );
    } else {
      const { data: routerData, offset } = encodeVenueRouterCall(
        v4TokenIn,
        v4TokenOut,
        launch,
        deadline,
      );
      if (same(v4TokenIn, ELYSIUM_SETTLER_ETH)) {
        actions.push(
          SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
            ELYSIUM_SETTLER_ETH,
            BASIS,
            venueRouter!,
            offset,
            routerData,
          ]),
        );
      } else {
        actions.push(
          SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
            v4TokenIn.toLowerCase(),
            BASIS,
            v4TokenIn.toLowerCase(),
            OFFSETS.transfer,
            TOKEN_IFACE.encodeFunctionData("transfer", [venueRouter!, 0n]),
          ]),
        );
        actions.push(
          SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
            ZeroAddress,
            0n,
            venueRouter!,
            0n,
            routerData,
          ]),
        );
      }
    }
  };

  const appendKalosV3Action = (
    v3TokenIn: string,
    v3Fee: number,
    v3TokenOut: string,
  ) => {
    const path = encodeV3Path(v3TokenIn, v3Fee, v3TokenOut);
    actions.push(
      SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
        v3TokenIn.toLowerCase(),
        BASIS,
        KALOS_V3.swapRouter.toLowerCase(),
        OFFSETS.exactInput,
        SWAP_ROUTER_IFACE.encodeFunctionData("exactInput", [
          {
            path,
            recipient: settler.toLowerCase(),
            deadline,
            amountIn: 0n,
            amountOutMinimum: 0n,
          },
        ]),
      ]),
    );
  };

  let quotedOut: bigint | null = null;

  if (side === "buy") {
    // Step A: If userQuote != poolQuoteErc20, bridge userQuote -> poolQuoteErc20 via Kalos V3
    let v4QuoteAmountIn = heldAmount;
    if (!same(userQuote, poolQuoteErc20)) {
      // Currently supported Kalos V3 bridges: USDC <-> WHYPE and KNTQ <-> WHYPE
      if (
        same(userQuote, ELYSIUM_USDC) &&
        same(poolQuoteErc20, ELYSIUM_WHYPE)
      ) {
        const hop1Out = await quoteKalosV3Hop(
          KALOS_V3.usdcWhypePool,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_USDC,
          ELYSIUM_WHYPE,
          heldAmount,
        );
        if (!hop1Out || hop1Out <= 0n) return null;
        v4QuoteAmountIn = hop1Out;
        appendKalosV3Action(
          ELYSIUM_USDC,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_WHYPE,
        );
      } else if (
        same(userQuote, ELYSIUM_KNTQ) &&
        same(poolQuoteErc20, ELYSIUM_WHYPE)
      ) {
        const hop1Out = await quoteKalosV3Hop(
          KALOS_V3.kntqWhypePool,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_KNTQ,
          ELYSIUM_WHYPE,
          heldAmount,
        );
        if (!hop1Out || hop1Out <= 0n) return null;
        v4QuoteAmountIn = hop1Out;
        appendKalosV3Action(
          ELYSIUM_KNTQ,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_WHYPE,
        );
      } else if (
        same(userQuote, ELYSIUM_WHYPE) &&
        same(poolQuoteErc20, ELYSIUM_USDC)
      ) {
        const hop1Out = await quoteKalosV3Hop(
          KALOS_V3.usdcWhypePool,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_WHYPE,
          ELYSIUM_USDC,
          heldAmount,
        );
        if (!hop1Out || hop1Out <= 0n) return null;
        v4QuoteAmountIn = hop1Out;
        appendKalosV3Action(
          ELYSIUM_WHYPE,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_USDC,
        );
      } else if (
        same(userQuote, ELYSIUM_WHYPE) &&
        same(poolQuoteErc20, ELYSIUM_KNTQ)
      ) {
        const hop1Out = await quoteKalosV3Hop(
          KALOS_V3.kntqWhypePool,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_WHYPE,
          ELYSIUM_KNTQ,
          heldAmount,
        );
        if (!hop1Out || hop1Out <= 0n) return null;
        v4QuoteAmountIn = hop1Out;
        appendKalosV3Action(
          ELYSIUM_WHYPE,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_KNTQ,
        );
      } else {
        return null;
      }
    }

    // Step B: If the launchpad pool is paired with native HYPE, unwrap WHYPE -> HYPE
    if (poolUsesNativeHype) {
      actions.push(
        SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
          ELYSIUM_WHYPE.toLowerCase(),
          BASIS,
          ELYSIUM_WHYPE.toLowerCase(),
          OFFSETS.withdraw,
          TOKEN_IFACE.encodeFunctionData("withdraw", [0n]),
        ]),
      );
    }

    // Step C: Swap quote -> launchToken on the launchpad v4 pool
    // Buy means spending quote (!launch.tokenIs0)
    const zeroForOne = !launch.tokenIs0;
    quotedOut = await quoteElysiumV4Hop(launch, zeroForOne, v4QuoteAmountIn);
    if (!quotedOut || quotedOut <= 0n) return null;

    appendV4SwapAction(poolQuoteSettlerToken, launchToken.toLowerCase());
  } else {
    // SELL: launchToken -> poolQuote -> userQuote
    // Step A: Swap launchToken -> poolQuote on the launchpad v4 pool
    const zeroForOne = launch.tokenIs0;
    const v4Out = await quoteElysiumV4Hop(launch, zeroForOne, heldAmount);
    if (!v4Out || v4Out <= 0n) return null;

    appendV4SwapAction(launchToken.toLowerCase(), poolQuoteSettlerToken);

    // Step B: If the launchpad pool paid native HYPE, wrap HYPE -> WHYPE
    if (poolUsesNativeHype) {
      actions.push(
        SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
          ELYSIUM_SETTLER_ETH,
          BASIS,
          ELYSIUM_WHYPE.toLowerCase(),
          0n,
          "0x",
        ]),
      );
    }

    // Step C: If poolQuoteErc20 != userQuote, bridge poolQuoteErc20 -> userQuote via Kalos V3
    let finalQuoteOut = v4Out;
    if (!same(poolQuoteErc20, userQuote)) {
      if (
        same(poolQuoteErc20, ELYSIUM_WHYPE) &&
        same(userQuote, ELYSIUM_USDC)
      ) {
        const hop2Out = await quoteKalosV3Hop(
          KALOS_V3.usdcWhypePool,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_WHYPE,
          ELYSIUM_USDC,
          v4Out,
        );
        if (!hop2Out || hop2Out <= 0n) return null;
        finalQuoteOut = hop2Out;
        appendKalosV3Action(
          ELYSIUM_WHYPE,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_USDC,
        );
      } else if (
        same(poolQuoteErc20, ELYSIUM_WHYPE) &&
        same(userQuote, ELYSIUM_KNTQ)
      ) {
        const hop2Out = await quoteKalosV3Hop(
          KALOS_V3.kntqWhypePool,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_WHYPE,
          ELYSIUM_KNTQ,
          v4Out,
        );
        if (!hop2Out || hop2Out <= 0n) return null;
        finalQuoteOut = hop2Out;
        appendKalosV3Action(
          ELYSIUM_WHYPE,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_KNTQ,
        );
      } else if (
        same(poolQuoteErc20, ELYSIUM_USDC) &&
        same(userQuote, ELYSIUM_WHYPE)
      ) {
        const hop2Out = await quoteKalosV3Hop(
          KALOS_V3.usdcWhypePool,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_USDC,
          ELYSIUM_WHYPE,
          v4Out,
        );
        if (!hop2Out || hop2Out <= 0n) return null;
        finalQuoteOut = hop2Out;
        appendKalosV3Action(
          ELYSIUM_USDC,
          KALOS_V3.usdcWhypeFee,
          ELYSIUM_WHYPE,
        );
      } else if (
        same(poolQuoteErc20, ELYSIUM_KNTQ) &&
        same(userQuote, ELYSIUM_WHYPE)
      ) {
        const hop2Out = await quoteKalosV3Hop(
          KALOS_V3.kntqWhypePool,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_KNTQ,
          ELYSIUM_WHYPE,
          v4Out,
        );
        if (!hop2Out || hop2Out <= 0n) return null;
        finalQuoteOut = hop2Out;
        appendKalosV3Action(
          ELYSIUM_KNTQ,
          KALOS_V3.kntqWhypeFee,
          ELYSIUM_WHYPE,
        );
      } else {
        return null;
      }
    }

    // Output-side integrator fee when selling (userQuote is output)
    if (feePpm > 0n && feeReceiver) {
      actions.push(
        SETTLER_ACTIONS_IFACE.encodeFunctionData("BASIC", [
          userQuote.toLowerCase(),
          feePpm,
          userQuote.toLowerCase(),
          OFFSETS.transfer,
          TOKEN_IFACE.encodeFunctionData("transfer", [
            feeReceiver.toLowerCase(),
            0n,
          ]),
        ]),
      );
      finalQuoteOut -= (finalQuoteOut * feePpm) / BASIS;
    }

    quotedOut = finalQuoteOut;
  }

  if (!quotedOut || quotedOut <= 0n) return null;

  // Apply slippage tolerance; Settler checks its own balance BEFORE paying out,
  // whereas net received by user after an output transfer tax is slightly lower.
  const minAmountOut = (quotedOut * BigInt(10_000 - slipBps)) / 10_000n;
  const safeMinAmountOut = minAmountOut > 0n ? minAmountOut : 1n;

  const outTaxBps =
    side === "buy" && launch.buyTaxBps ? BigInt(launch.buyTaxBps) : 0n;
  const netReceivedOut =
    outTaxBps > 0n ? quotedOut - (quotedOut * outTaxBps) / 10_000n : quotedOut;

  const settlerExecData = SETTLER_IFACE.encodeFunctionData("execute", [
    {
      recipient: recipient.toLowerCase(),
      buyToken: buyToken.toLowerCase(),
      minAmountOut: safeMinAmountOut,
    },
    actions,
    ZeroHash,
  ]);

  const data = ALLOWANCE_HOLDER_IFACE.encodeFunctionData("exec", [
    settler.toLowerCase(),
    sellToken.toLowerCase(),
    amountIn,
    settler.toLowerCase(),
    settlerExecData,
  ]);

  return {
    to: ELYSIUM_ALLOWANCE_HOLDER,
    spender: ELYSIUM_ALLOWANCE_HOLDER,
    data,
    value: "0",
    amountOut: String(netReceivedOut > 0n ? netReceivedOut : 1n),
    launchpad: launch.launchpad,
    launchpadLabel: launch.launchpadLabel,
  };
}
