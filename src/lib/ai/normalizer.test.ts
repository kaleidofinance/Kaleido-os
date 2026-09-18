// The normalizer tier, checked offline: the sentinel, the addendum's contents,
// which cheap provider is chosen (never the expensive default), and that a
// single-shot run really is single-shot — a model that asks for reads gets no
// second call and no read runs. Fake providers throughout; no network.
//
//   npm run test:normalizer

import type { ChatInput, ChatProvider, ChatResult } from "./types.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

async function main() {
  /* No provider keys during the module load: getNormalizerProvider is asked
     with a controlled environment below, and index.ts reads the keys at call
     time, so they can be set and unset between calls. */
  for (const k of [
    "GEMINI_API_KEY",
    "AI_GATEWAY_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AGENTROUTER_API_KEY",
    "AI_PROVIDER",
    "NORMALIZER_MODEL",
  ]) {
    delete process.env[k];
  }

  const {
    ESCALATE,
    NORMALIZER_MODELS,
    getNormalizerProvider,
    getNormalizerProviders,
    productFacts,
    isEscalation,
    normalizerAddendum,
    PRODUCT_STATE,
    GLOSSARY,
    MAINNET_DIRECTIVE,
  } = await import("./normalizer.ts");
  const { runAgent } = await import("./agent.ts");

  console.log("\n— the sentinel —");
  check("bare word", isEscalation("ESCALATE", 0));
  check("lower case", isEscalation("escalate", 0));
  check("with a reason after it", isEscalation("ESCALATE — needs the balance", 0));
  check("wrapped in backticks", isEscalation("`ESCALATE`", 0));
  check("leading whitespace", isEscalation("  \nESCALATE", 0));
  check("a sentence that merely contains it is not", !isEscalation("I would not escalate this", 0));
  check("a reply that carries a tool call is never one", !isEscalation("ESCALATE", 1));
  check("empty text is not (the route treats empty separately)", !isEscalation("", 0));
  check("the exported sentinel is the word the rules quote", ESCALATE === "ESCALATE");

  console.log("\n— the addendum —");
  const arc = normalizerAddendum({ chainId: 5042 });
  check("names the connected chain's tokens", /Tokens on Arc: .*USDC.*EURC/.test(arc), arc.slice(0, 200));
  check("rules the symbols to that list", arc.includes("ONLY symbols you may put in a tool call"));
  check("KLD is stated as not launched", /KLD.*has NOT launched/.test(arc));
  check("and dated to the FAQ's own date", arc.includes("end of September 2026"));
  check("Arc mainnet is stated as live", arc.includes("Arc mainnet is live"));
  check("default addendum (testnets shown) carries no mainnet directive", !arc.includes("MAINNET MODE"));
  check("mainnet-only addendum forbids testnet steering", normalizerAddendum({ chainId: 5042, mainnetOnly: true }).includes(MAINNET_DIRECTIVE));
  check("lending/staking/limit-orders stated as testnet-only", /lending book, kfUSD\/kafUSD, KLD staking, and limit orders run only on the testnets/.test(arc));
  check("concentrated-liquidity pools stated as available on Arc", /concentrated-liquidity pools/.test(arc) && arc.includes("available today"));
  check("carries the escalate rule with the sentinel", arc.includes(`reply with exactly the word ${ESCALATE}`));
  check("forbids sending the user to the docs", arc.includes("never tell them to read the docs"));
  check("forbids read tools in this mode", arc.includes("Never call a read tool"));
  for (const dialect of ["NEWCOMER", "TRADER", "MEMECOIN", "YIELD FARMER", "LIQUIDITY PROVIDER", "STABLECOIN", "LENDING", "STAKING", "BRIDGING", "POINTS"]) {
    check(`glosses the ${dialect} dialect`, arc.includes(`- ${dialect}`));
  }
  check("every product-state line is in it", PRODUCT_STATE.every((l) => arc.includes(l)));
  check("every glossary line is in it", GLOSSARY.every((l) => arc.includes(l)));
  const none = normalizerAddendum({});
  check("with no wallet it says to connect one and lists no tokens", none.includes("connect a wallet first") && !none.includes("Tokens on"));

  console.log("\n— which cheap provider —");
  check("no keys → no provider (tier is skipped)", getNormalizerProvider() === null);
  process.env.GEMINI_API_KEY = "test";
  const gem = getNormalizerProvider();
  check("Gemini key → gemini-flash-latest", gem?.model === NORMALIZER_MODELS[0], gem?.model);
  delete process.env.GEMINI_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test";
  const gw = getNormalizerProvider();
  check("Gateway key only → gpt-5-mini", gw?.model === NORMALIZER_MODELS[1], gw?.model);
  process.env.NORMALIZER_MODEL = "openai/gpt-5-mini";
  process.env.GEMINI_API_KEY = "test";
  check("NORMALIZER_MODEL override wins when its key is present", getNormalizerProvider()?.model === "openai/gpt-5-mini");
  process.env.NORMALIZER_MODEL = "claude-opus-5";
  /* The override names an expensive router model with NO router key: getProvider
     would fall back to some default — it must not be accepted as the cheap tier. */
  const notOpus = getNormalizerProvider();
  check("an override whose key is absent is not silently swapped for a default", notOpus !== null && notOpus.model !== "claude-opus-5", notOpus?.model);
  delete process.env.NORMALIZER_MODEL;
  process.env.AGENTROUTER_API_KEY = "test";
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  check("only an expensive default configured → null, never the default", getNormalizerProvider() === null, getNormalizerProvider()?.model);
  delete process.env.AGENTROUTER_API_KEY;

  console.log("\n— every cheap provider, in order —");
  process.env.GEMINI_API_KEY = "test";
  process.env.AI_GATEWAY_API_KEY = "test";
  const both = getNormalizerProviders().map((p) => p.model);
  check("both keys → both cheap models, Gemini first", both.join(",") === NORMALIZER_MODELS.join(","), both.join(","));
  process.env.NORMALIZER_MODEL = "openai/gpt-5-mini";
  const overridden = getNormalizerProviders().map((p) => p.model);
  check("the override goes first and is not duplicated", overridden.join(",") === "openai/gpt-5-mini,gemini-flash-latest", overridden.join(","));
  delete process.env.NORMALIZER_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  check("no keys → an empty list (the tier is skipped)", getNormalizerProviders().length === 0);

  console.log("\n— the product facts for the full model —");
  const facts = productFacts();
  check("carries every product-state line", PRODUCT_STATE.every((l) => facts.includes(l)));
  check("tells the full model never to recommend another protocol", facts.includes("never recommend another protocol"));
  check("but none of the quick-read rules", !facts.includes("QUICK-READ MODE") && !facts.includes("ESCALATE"));
  check("productFacts() is testnet-neutral by default (no steering directive)", !facts.includes("MAINNET MODE"));
  check("productFacts(true) forbids testnet steering", productFacts(true).includes(MAINNET_DIRECTIVE) && productFacts(true).includes("MAINNET MODE"));

  console.log("\n— single-shot —");
  const seen: ChatInput[] = [];
  const asksForReads: ChatProvider = {
    id: "fake",
    model: "fake-model",
    chat: async (input) => {
      seen.push(input);
      const r: ChatResult = {
        text: "",
        executes: [],
        reads: [{ name: "getPortfolio", args: {} }],
        provider: "fake",
        model: "fake-model",
      };
      return r;
    },
  };
  const run = await runAgent(asksForReads, {
    message: "what should i do with my idle usdc",
    chainId: 5042,
    maxReadRounds: 0,
    systemAddendum: "QUICK-READ MODE. marker-7f3a",
  });
  check("the provider is called exactly once", seen.length === 1, String(seen.length));
  check("no read round ran", run.rounds === 0 && run.trace.length === 0, `${run.rounds} ${run.trace.length}`);
  check("the reads it asked for are still reported", run.reads.length === 1);
  check("the addendum reached the model, after the base prompt", seen[0].system.endsWith("QUICK-READ MODE. marker-7f3a") && seen[0].system.includes("You are Luca"));
  check("the full tool catalog was offered (the model may still pick an execute)", seen[0].tools.some((t) => t.name === "swap"));

  const emitsPlan: ChatProvider = {
    id: "fake2",
    model: "fake2-model",
    chat: async () => ({
      text: "",
      executes: [{ name: "swap", args: { amount: "50", tokenIn: "USDC", tokenOut: "EURC" } }],
      reads: [],
      provider: "fake2",
      model: "fake2-model",
    }),
  };
  const planned = await runAgent(emitsPlan, { message: "ape 50 usdc into eurc", chainId: 5042, maxReadRounds: 0 });
  check("an execute call comes back as-is for the route to build and audit", planned.executes.length === 1 && planned.executes[0].name === "swap");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
