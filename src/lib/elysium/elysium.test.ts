import assert from "node:assert/strict";
import { AbiCoder, Interface, keccak256, parseUnits, toBeHex } from "ethers";
import { providerForChain } from "@/config/provider";
import { chainTokens } from "@/constants/tokens";
import { auditPlan } from "@/lib/ai/auditor";
import { cardFollowUp, tokenCardFrom } from "@/lib/v2/cards/tokenCard";
import { parseCommand } from "@/lib/v2/intents/fromCommand";
import {
  ELYSIUM_ALLOWANCE_HOLDER,
  ELYSIUM_CHAIN_ID,
  ELYSIUM_KNTQ,
  ELYSIUM_LAUNCHPADS,
  ELYSIUM_POOL_MANAGERS,
  ELYSIUM_USDC,
  ELYSIUM_WHYPE,
  isElysiumQuoteToken,
  isKnownElysiumLaunchRouter,
} from "./addresses";
import { readElysiumLaunch } from "./launch";
import { resolveElysiumTrade } from "./server";
import { elysiumAddressToken } from "./token";

const MONTRA_TOKEN = "0x732dc25f6dcf250a819b1040b23b89aab33fb248";
const BOXA_TOKEN = "0xc10234e43dd4d04055fca3d4366af16a0c1a055c";
const TEST_USER = "0x000000000000000000000000000000000000dEaD";

async function main() {
  // 1. Registry of 12 Elysium Launchpads & helper predicates
  assert.equal(ELYSIUM_LAUNCHPADS.length, 12, "all 12 Elysium launchpads registered");
  const ids = ELYSIUM_LAUNCHPADS.map((l) => l.id);
  assert.deepEqual(ids, [
    "montra",
    "boxa",
    "ascend",
    "mesa",
    "volta",
    "kleos",
    "elyspump",
    "eleos",
    "rons",
    "obol",
    "kstr",
    "quoted",
  ]);
  assert.equal(isElysiumQuoteToken(ELYSIUM_USDC), true);
  assert.equal(isElysiumQuoteToken(ELYSIUM_WHYPE), true);
  assert.equal(isElysiumQuoteToken(ELYSIUM_KNTQ), true);
  assert.equal(isElysiumQuoteToken(MONTRA_TOKEN), false);
  assert.equal(
    isKnownElysiumLaunchRouter(ELYSIUM_CHAIN_ID, ELYSIUM_ALLOWANCE_HOLDER),
    true,
  );
  assert.equal(isKnownElysiumLaunchRouter(5042, ELYSIUM_ALLOWANCE_HOLDER), false);

  // 2. Provisional token & command grammar integration on Elysium (99901)
  const tok = elysiumAddressToken(MONTRA_TOKEN);
  assert.ok(tok, "elysiumAddressToken resolves unlisted 40-hex address");
  assert.equal(tok.chainId, ELYSIUM_CHAIN_ID);
  assert.equal(tok.decimals, 18);
  assert.deepEqual(tok.tags, ["elysium"]);
  assert.equal(
    elysiumAddressToken(ELYSIUM_USDC),
    null,
    "listed Elysium USDC stays in registry",
  );

  const vocab = chainTokens(ELYSIUM_CHAIN_ID);
  const parseCtx = { addressToken: (w: string) => elysiumAddressToken(w) };
  const buyParsed = parseCommand(
    `buy ${MONTRA_TOKEN} with 25% of my usdc`,
    vocab,
    parseCtx,
  );
  assert.equal(buyParsed.status, "ok");
  if (buyParsed.status === "ok" && buyParsed.command.kind === "swap") {
    assert.equal(
      buyParsed.command.tokenIn.address.toLowerCase(),
      ELYSIUM_USDC.toLowerCase(),
    );
    assert.equal(
      buyParsed.command.tokenOut.address.toLowerCase(),
      MONTRA_TOKEN.toLowerCase(),
    );
  } else {
    assert.fail("Expected swap command from buy preset");
  }

  const sellParsed = parseCommand(
    `sell 50% of ${BOXA_TOKEN} for usdc`,
    vocab,
    parseCtx,
  );
  assert.equal(sellParsed.status, "ok");
  if (sellParsed.status === "ok" && sellParsed.command.kind === "swap") {
    assert.equal(
      sellParsed.command.tokenIn.address.toLowerCase(),
      BOXA_TOKEN.toLowerCase(),
    );
    assert.equal(
      sellParsed.command.tokenOut.address.toLowerCase(),
      ELYSIUM_USDC.toLowerCase(),
    );
  } else {
    assert.fail("Expected swap command from sell preset");
  }

  // 3. Token Card rendering for Elysium launchpad tokens
  const card = tokenCardFrom({
    ok: true,
    source: "elysium",
    launchpadLabel: "Montra launch",
    address: MONTRA_TOKEN,
    symbol: "MNT",
    name: "Montra Token",
    decimals: 18,
    priceUsd: 0.0004215,
    marketCapUsd: 421_500,
    buyTaxBps: 100,
    sellTaxBps: 100,
  });
  assert.equal(card.kind, "token");
  if (card.kind === "token") {
    assert.equal(card.badge?.text, "Montra launch");
    assert.equal(card.badge?.tone, "good");
    assert.equal(card.ref, MONTRA_TOKEN);
    assert.equal(
      card.buys[1]?.command,
      `buy ${MONTRA_TOKEN} with 25% of my usdc`,
    );
    assert.equal(
      card.sells[1]?.command,
      `sell 25% of ${MONTRA_TOKEN} for usdc`,
    );
    assert.equal(
      cardFollowUp("buy 15 usdc", { ref: card.ref!, symbol: card.symbol }),
      `buy ${MONTRA_TOKEN} with 15 usdc`,
    );
  }

  // 4. Live on-chain launch detection + quoting + AllowanceHolder/Settler simulation
  console.log("Probing live Elysium Mainnet (99901) launchpad pools...");
  const [montraLaunch, boxaLaunch] = await Promise.all([
    readElysiumLaunch(MONTRA_TOKEN),
    readElysiumLaunch(BOXA_TOKEN),
  ]);

  assert.ok(montraLaunch, "Montra launch token detected on Shared PoolManager");
  assert.equal(montraLaunch.launchpad, "montra");
  assert.equal(montraLaunch.launchpadLabel, "Montra launch");
  assert.equal(
    montraLaunch.poolManager.toLowerCase(),
    ELYSIUM_POOL_MANAGERS.shared.toLowerCase(),
  );
  assert.ok(montraLaunch.pricePerTokenInQuote > 0);
  assert.ok(montraLaunch.priceUsd && montraLaunch.priceUsd > 0);
  console.log(
    `  Montra token (${MONTRA_TOKEN}): price=${montraLaunch.pricePerTokenInQuote.toExponential(4)} ${montraLaunch.quoteSymbol} ($${montraLaunch.priceUsd.toExponential(4)})`,
  );

  assert.ok(boxaLaunch, "BOXA launch token detected on BOXA PoolManager");
  assert.equal(boxaLaunch.launchpad, "boxa");
  assert.equal(boxaLaunch.launchpadLabel, "BOXA launch");
  assert.equal(
    boxaLaunch.poolManager.toLowerCase(),
    ELYSIUM_POOL_MANAGERS.boxa.toLowerCase(),
  );
  assert.ok(boxaLaunch.pricePerTokenInQuote > 0);
  assert.ok(boxaLaunch.priceUsd && boxaLaunch.priceUsd > 0);
  console.log(
    `  BOXA token   (${BOXA_TOKEN}): price=${boxaLaunch.pricePerTokenInQuote.toExponential(4)} ${boxaLaunch.quoteSymbol} ($${boxaLaunch.priceUsd.toExponential(4)})`,
  );

  // 5. Quote + build executable calldata for 1-hop (WHYPE) and 2-hop (USDC) trades
  const whypeIn = parseUnits("0.01", 18).toString();
  const usdcIn = parseUnits("1", 6).toString();

  const [montraWhypeBuy, boxaWhypeBuy, montraUsdcBuy, boxaUsdcBuy] =
    await Promise.all([
      resolveElysiumTrade({
        tokenIn: ELYSIUM_WHYPE,
        tokenOut: MONTRA_TOKEN,
        amountUnits: whypeIn,
        address: TEST_USER,
        slippageBps: 200,
      }),
      resolveElysiumTrade({
        tokenIn: ELYSIUM_WHYPE,
        tokenOut: BOXA_TOKEN,
        amountUnits: whypeIn,
        address: TEST_USER,
        slippageBps: 200,
      }),
      resolveElysiumTrade({
        tokenIn: ELYSIUM_USDC,
        tokenOut: MONTRA_TOKEN,
        amountUnits: usdcIn,
        address: TEST_USER,
        slippageBps: 200,
      }),
      resolveElysiumTrade({
        tokenIn: ELYSIUM_USDC,
        tokenOut: BOXA_TOKEN,
        amountUnits: usdcIn,
        address: TEST_USER,
        slippageBps: 200,
      }),
    ]);

  assert.ok(montraWhypeBuy && BigInt(montraWhypeBuy.amountOut) > 0n);
  assert.ok(boxaWhypeBuy && BigInt(boxaWhypeBuy.amountOut) > 0n);
  assert.ok(montraUsdcBuy && BigInt(montraUsdcBuy.amountOut) > 0n);
  assert.ok(boxaUsdcBuy && BigInt(boxaUsdcBuy.amountOut) > 0n);

  console.log(
    `  0.01 WHYPE -> Montra out=${montraWhypeBuy.amountOut}, BOXA out=${boxaWhypeBuy.amountOut}`,
  );
  console.log(
    `  1.00 USDC  -> Montra out=${montraUsdcBuy.amountOut}, BOXA out=${boxaUsdcBuy.amountOut}`,
  );

  // Simulate on-chain via eth_call against live Elysium Settler
  const provider = providerForChain(ELYSIUM_CHAIN_ID)!;
  const ahIface = new Interface([
    "function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)",
  ]);
  const settlerIface = new Interface([
    "function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32 zid) payable returns (bool)",
  ]);
  const settlerActionsIface = new Interface([
    "function TRANSFER_FROM(address recipient, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes sig)",
    "function NATIVE_CHECK(uint256 deadline, uint256 msgValue)",
    "function BASIC(address sellToken, uint256 ppm, address pool, uint256 offset, bytes data)",
  ]);

  for (const [label, trade] of [
    ["Montra WHYPE buy (1-hop)", montraWhypeBuy],
    ["BOXA WHYPE buy (1-hop)", boxaWhypeBuy],
  ] as const) {
    const [operator, token, amount, target, innerData] =
      ahIface.decodeFunctionData("exec", trade.data);
    assert.equal(operator.toLowerCase(), target.toLowerCase());
    assert.equal(token.toLowerCase(), ELYSIUM_WHYPE.toLowerCase());
    assert.equal(BigInt(amount), BigInt(whypeIn));

    const [slippage, actions, zid] = settlerIface.decodeFunctionData(
      "execute",
      innerData,
    );
    assert.equal(slippage.recipient.toLowerCase(), TEST_USER.toLowerCase());
    assert.ok(BigInt(slippage.minAmountOut) > 0n);

    const [tfRecipient, permit] = settlerActionsIface.decodeFunctionData(
      "TRANSFER_FROM",
      actions[0],
    );
    assert.equal(tfRecipient.toLowerCase(), operator.toLowerCase());
    assert.equal(
      permit.permitted.token.toLowerCase(),
      ELYSIUM_WHYPE.toLowerCase(),
    );
    assert.equal(BigInt(permit.permitted.amount), BigInt(whypeIn));

    // Replace TRANSFER_FROM(WHYPE) with NATIVE_CHECK + BASIC(wrap HYPE -> WHYPE)
    // so the remaining swap actions and Settler's minAmountOut check execute live on-chain.
    const simActions = [
      settlerActionsIface.encodeFunctionData("NATIVE_CHECK", [
        permit.deadline,
        BigInt(whypeIn),
      ]),
      settlerActionsIface.encodeFunctionData("BASIC", [
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        1_000_000n,
        ELYSIUM_WHYPE.toLowerCase(),
        0n,
        "0x",
      ]),
      ...actions.slice(1),
    ];
    const simCalldata = settlerIface.encodeFunctionData("execute", [
      slippage,
      simActions,
      zid,
    ]);
    const rawRet = (await provider.send("eth_call", [
      {
        from: TEST_USER,
        to: operator,
        value: "0x" + BigInt(whypeIn).toString(16),
        data: simCalldata,
      },
      "latest",
      {
        [TEST_USER]: {
          balance: "0x" + parseUnits("10", 18).toString(16),
        },
      },
    ])) as string;
    const [ok] = settlerIface.decodeFunctionResult("execute", rawRet);
    assert.equal(
      ok,
      true,
      `${label} Settler.execute returned true on-chain with minAmountOut=${slippage.minAmountOut}`,
    );
    console.log(
      `  Simulated ${label} on-chain: Settler.execute => true (minAmountOut=${slippage.minAmountOut})`,
    );
  }

  // 6. Auditor validation of an Elysium [approve, aggregatorSwap] plan
  const fixedPricer = async (sym: string, amt: string) =>
    sym === "USDC"
      ? { usd: Number(amt), source: "test" }
      : { usd: null, source: "none" };

  const audited = await auditPlan({
    plan: [
      {
        kind: "approve",
        token: ELYSIUM_USDC,
        spender: montraUsdcBuy.spender,
        amount: "1",
        decimals: 6,
        symbol: "USDC",
      },
      {
        kind: "aggregatorSwap",
        to: montraUsdcBuy.to,
        data: montraUsdcBuy.data,
        value: "0",
        tokenIn: ELYSIUM_USDC,
        amountIn: "1",
        decimalsIn: 6,
        symbolIn: "USDC",
        tokenOut: MONTRA_TOKEN,
        amountOut: "100",
        amountOutMin: "98",
        decimalsOut: 18,
        symbolOut: "0x732d…b248",
        chainId: ELYSIUM_CHAIN_ID,
        venue: "elysium",
        spender: montraUsdcBuy.spender,
        slippageBps: 200,
      },
    ],
    chainId: ELYSIUM_CHAIN_ID,
    pricer: fixedPricer,
  });
  assert.equal(
    audited.ok,
    true,
    `Expected Elysium launchpad plan to pass audit, got: ${audited.blocked.join(", ")}`,
  );

  console.log("elysium.test.ts: all assertions passed!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
