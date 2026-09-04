/*
 * Checks that the landing page's capability section still matches the catalog it
 * claims to be quoting. Run with
 * `npx tsx "src/app/(marketing)/_components/capabilities.test.ts"` — tsx rather
 * than plain node, because traces.ts reaches the intent builders, which pull in
 * ethers and the address registry.
 *
 * WHY THIS SUITE EXISTS. The section's whole claim is "here is the exact tool
 * surface, check it against the source". That is only worth saying if something
 * enforces it, because the failure mode is silent: a tool renamed in
 * toolCatalog.ts leaves the landing page confidently listing a tool that no
 * longer exists, and nothing about the page looks broken. Types cannot catch it,
 * since the names are strings on both sides.
 *
 * What is asserted, in order of how badly it fails when wrong:
 *
 *   1. Coverage, both ways. The execute tabs must name exactly EXECUTE_TOOLS —
 *      nothing missing and nothing extra. A tool added to the catalog fails here
 *      until the page lists it, which is the point of checking both directions.
 *   2. Parameter lists. Each `params` must equal the catalog's `required` array
 *      in order, and `params` plus `optional` must account for every declared
 *      property. That second half is what would have caught the mistake this
 *      file was written after: `maxInterestBps` presented as required when the
 *      catalog leaves it out of `required`, and a "nine parameters" claim in the
 *      prose derived from that.
 *   3. Every example builds. A refusal renders in place of a plan, so an example
 *      that stops being valid — a token delisted, a validation tightened — has
 *      to fail here rather than ship as an error message on the landing page.
 *   4. Which entry point each tool takes, and that the two agree. The panel tags
 *      21 turns "Direct" on the strength of `parseCommand` having closed the
 *      sentence; if a grammar change quietly pushes one onto the model path, the
 *      page keeps claiming it and nothing looks broken. So the three model tools
 *      are named here, and every local tool's typed plan is compared step for step
 *      against the plan its tool call builds. That comparison is the animation's
 *      whole claim.
 *   5. The shapes the section is actually selling: a swap is two transactions, a
 *      send is one, closing a pool position is a decrease then a collect. Those
 *      are the claims a reader takes away, so they are asserted by name.
 */

import type { Group } from "./capabilities";
import type { GroupTrace, ToolTrace } from "./traces";

/*
 * Addresses fixed before the builders load, for the reason build.test.ts states
 * at length: `envVars` reads process.env once at module evaluation, and under tsx
 * there is no Next.js runtime to populate NEXT_PUBLIC_*. Left undefined, every
 * lending example would come back as "The protocol address isn't configured."
 * and this file would assert nothing but that one refusal.
 *
 * So every runtime import lives inside `load()` — a static import is evaluated
 * before any statement in the module body, which would freeze `undefined` into
 * envVars before the line below ran. Type imports stay static; they erase.
 *
 * There were two lines here. NEXT_PUBLIC_KLD_VAULT_ADDRESS was the second, and
 * it is gone with the env var itself — the vault is resolved per chain from
 * DEPLOYMENTS now, so nothing in process.env can seed it. Removing it changes
 * nothing here in any case: this file asserts over the capability copy and the
 * lending examples, and never builds a stake, so the seed was already inert.
 */
process.env.NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS =
  "0xd1a3000000000000000000000000000000000001";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/**
 * The shape this file needs out of a catalog entry. The catalog is typed for the
 * provider tool-call APIs, where `parameters` is a JSON Schema object; reading it
 * structurally here keeps the assertions independent of which provider shape it
 * is currently written in.
 */
interface CatalogEntry {
  name: string;
  kind: string;
  description: string;
  parameters: { properties?: Record<string, unknown>; required?: string[] };
}

/**
 * The three execute tools that have no typed form, and why — so that a fourth one
 * joining them has to be a decision rather than a regression.
 *
 * `grantAgentPermission` has no verb in `fromCommand.ts` at all; a mandate is a
 * form, not a sentence.
 *
 * `provideLiquidity` is excluded from the grammar by name (`ToolOnlyKind` in
 * fromCommand.ts), because opening a position carries two tokens, two amounts, a
 * fee tier and a range against a `Slot` union with one amount in it — the draft
 * machinery cannot hold that half-specified. The model collects it and calls once.
 *
 * `increasePosition` is the second `ToolOnlyKind`, and it is here for the same
 * arithmetic: a position id plus two amounts and two symbols is five values
 * against that same one-amount union. It is narrower than a mint by four
 * arguments and still one too wide for a Draft.
 *
 * `completeWithdrawal` was a third, and it left this list by being fixed rather
 * than by being edited around. Its payout token resolves through
 * `findToken("kfusd", tokens)`, which found nothing while no chain had a kfUSD
 * address; the stablecoin is deployed on all five testnets now, so the sentence
 * closes on the grammar. This assertion is what caught the move — worth saying
 * because the check reads like a formality until the day it changes.
 */
const MODEL_PATH = [
  "grantAgentPermission",
  "increasePosition",
  "provideLiquidity",
];

async function load() {
  const catalogMod = await import("../../../lib/ai/toolCatalog");
  const caps = await import("./capabilities");
  const traces = await import("./traces");
  const fromToolCall = await import("../../../lib/ai/fromToolCall");
  return {
    catalog: catalogMod.TOOL_CATALOG as unknown as CatalogEntry[],
    executeTools: catalogMod.EXECUTE_TOOLS,
    ...caps,
    getCapabilityTraces: traces.getCapabilityTraces,
    planFromToolCalls: fromToolCall.planFromToolCalls,
    TRACE_CHAIN: traces.TRACE_CHAIN,
    TRACE_OPTS: traces.TRACE_OPTS,
    TRACE_DEPS: traces.TRACE_DEPS,
  };
}

async function main() {
  const {
    catalog,
    executeTools,
    ALL_GROUPS,
    ALL_TOOLS,
    EXECUTE_COUNT,
    GROUPS,
    INTERNAL_TOOLS,
    READS,
    getCapabilityTraces,
    planFromToolCalls,
    TRACE_CHAIN,
    TRACE_OPTS,
    TRACE_DEPS,
  } = await load();

  const byName = new Map(catalog.map((t) => [t.name, t]));

  console.log("\n— coverage —");

  /*
   * The execute surface this page is responsible for: the catalog's execute set
   * minus the tools capabilities.ts declares internal. Every count below is taken
   * against this rather than against EXECUTE_TOOLS, so the exclusion is applied in
   * exactly one place and the two-way coverage check still holds — a tool that is
   * neither listed nor excluded still fails.
   */
  const surface = [...executeTools].filter((n) => !INTERNAL_TOOLS.includes(n));

  /* The exclusion cannot outlive what it excludes. A name here that the catalog
     no longer carries as an execute tool is a stale exemption, and a stale
     exemption is how a real tool goes missing from the page. */
  for (const name of INTERNAL_TOOLS) {
    check(
      `${name}: excluded from the page, and still an execute tool in the catalog`,
      executeTools.has(name),
      "not in EXECUTE_TOOLS — remove it from INTERNAL_TOOLS",
    );
  }

  const listed = GROUPS.flatMap((g: Group) => g.tools.map((t) => t.name));
  const missing = surface.filter((n) => !listed.includes(n));
  const extra = listed.filter((n) => !executeTools.has(n));
  check(
    "the execute tabs name every tool in EXECUTE_TOOLS",
    missing.length === 0,
    `missing: ${missing.join(", ")}`,
  );
  check(
    "and name nothing that is not one",
    extra.length === 0,
    `extra: ${extra.join(", ")}`,
  );
  check(
    "EXECUTE_COUNT is the size of the catalog's execute set",
    EXECUTE_COUNT === surface.length,
    `${EXECUTE_COUNT} vs ${surface.length}`,
  );

  const catalogReads = catalog
    .filter((t) => t.kind === "read")
    .map((t) => t.name)
    .sort();
  const pageReads = READS.tools.map((t) => t.name).sort();
  check(
    "the reads tab lists exactly the catalog's read tools",
    JSON.stringify(catalogReads) === JSON.stringify(pageReads),
    `catalog [${catalogReads.join(",")}] vs page [${pageReads.join(",")}]`,
  );

  check(
    "no name appears on two tabs",
    new Set(ALL_TOOLS).size === ALL_TOOLS.length,
  );
  check(
    "the flat list is every tool exactly once",
    ALL_TOOLS.length === surface.length + catalogReads.length,
    `${ALL_TOOLS.length} vs ${surface.length + catalogReads.length}`,
  );

  console.log("\n— parameter lists —");

  for (const group of ALL_GROUPS) {
    for (const tool of group.tools) {
      const entry = byName.get(tool.name);
      if (!entry) {
        check(`${tool.name}: exists in the catalog`, false);
        continue;
      }

      const required = entry.parameters.required ?? [];
      check(
        `${tool.name}: params is the catalog's required list, in order`,
        JSON.stringify(tool.params) === JSON.stringify(required),
        `page [${tool.params.join(",")}] vs catalog [${required.join(",")}]`,
      );

      /* The half that catches a *new* property. Every key the catalog declares
         has to be accounted for as either required or explicitly optional; one
         added to the catalog and left out of both lists means the page is
         understating the API, which is the quieter of the two failures and so
         the easier one to miss. */
      const declared = Object.keys(entry.parameters.properties ?? {}).sort();
      const accounted = [...tool.params, ...(tool.optional ?? [])].sort();
      check(
        `${tool.name}: params + optional covers every declared property`,
        JSON.stringify(declared) === JSON.stringify(accounted),
        `declared [${declared.join(",")}] vs listed [${accounted.join(",")}]`,
      );

      const wronglyOptional = (tool.optional ?? []).filter((p) =>
        required.includes(p),
      );
      check(
        `${tool.name}: nothing called optional is actually required`,
        wronglyOptional.length === 0,
        wronglyOptional.join(","),
      );

      const example = tool.example;
      if (example) {
        const unknownKeys = Object.keys(example).filter(
          (k) => !declared.includes(k),
        );
        check(
          `${tool.name}: every example argument is a declared property`,
          unknownKeys.length === 0,
          `unknown: ${unknownKeys.join(",")}`,
        );
        const absent = required.filter((r) => !(r in example));
        check(
          `${tool.name}: the example supplies every required argument`,
          absent.length === 0,
          `absent: ${absent.join(",")}`,
        );
      } else {
        check(
          `${tool.name}: carries no example, and is a read`,
          entry.kind === "read",
          `kind ${entry.kind}`,
        );
      }
    }
  }

  console.log("\n— every example builds —");

  const traced = await getCapabilityTraces();
  check(
    "one trace group per tab",
    traced.length === ALL_GROUPS.length,
    `${traced.length}`,
  );

  for (const group of traced) {
    const isReads = group.tab === READS.tab;
    for (const tool of group.tools) {
      if (isReads) {
        check(
          `${tool.name}: no steps, because a read signs nothing`,
          tool.steps.length === 0 && tool.returns !== undefined,
        );
        /* The sentence is cut out of the catalog description by a regex, so its
           two failure modes are an empty string (no period found where one was
           expected) and a mid-sentence cut. Length and the trailing period catch
           both; the backtick check catches markdown reaching a panel that does
           not render it. */
        check(
          `${tool.name}: the catalog sentence came out whole`,
          !!tool.returns &&
            tool.returns.length > 20 &&
            tool.returns.endsWith(".") &&
            !tool.returns.includes("`"),
          JSON.stringify(tool.returns),
        );
        continue;
      }

      check(
        `${tool.name}: builds a plan rather than a refusal`,
        tool.refusal === undefined && tool.steps.length > 0,
        tool.refusal ?? "no steps",
      );
      check(
        `${tool.name}: every step has a kind and a title`,
        tool.steps.every((s) => !!s.kind && !!s.title),
      );
    }
  }

  console.log("\n— which entry point served the turn —");

  const all: ToolTrace[] = traced.flatMap((g: GroupTrace) => [...g.tools]);
  const find = (name: string) => all.find((t) => t.name === name);

  /* The prompt is what gets typed on screen, so an empty one plays an empty
     composer and then a plan that nobody asked for. Trimmed length rather than
     presence, because `""` is a perfectly good string and the types would pass
     it — and no minimum beyond that, because `repay`'s prompt is the single word
     "repay" on purpose: the whole point of that turn is that the server resolves
     the loan from nothing. */
  for (const tool of all) {
    check(
      `${tool.name}: carries a prompt to type`,
      tool.prompt.trim().length > 0,
      JSON.stringify(tool.prompt),
    );
  }

  const localTools = all.filter((t) => t.via === "local").map((t) => t.name);
  const modelExecute = all
    .filter((t) => t.via === "model" && t.returns === undefined)
    .map((t) => t.name)
    .sort();
  check(
    "exactly the named tools need a model, and no others",
    JSON.stringify(modelExecute) === JSON.stringify([...MODEL_PATH].sort()),
    `on the model path: [${modelExecute.join(",")}]`,
  );
  check(
    "so the count of turns tagged Direct is every other execute tool",
    localTools.length === surface.length - MODEL_PATH.length,
    `${localTools.length} of ${surface.length}`,
  );

  for (const tool of all) {
    if (tool.returns !== undefined) {
      check(
        `${tool.name}: a read takes the model path and answers nothing`,
        tool.via === "model" && tool.say === undefined,
        `via ${tool.via}, say ${JSON.stringify(tool.say)}`,
      );
      continue;
    }
    /* Computed on a local turn, authored on the one model turn — but empty either
       way is a turn where the agent replies with nothing and then produces a
       plan, which reads as a rendering fault rather than as a design. */
    check(
      `${tool.name}: Luca says something above the plan`,
      !!tool.say && tool.say.trim().length > 0,
      JSON.stringify(tool.say),
    );
  }

  console.log("\n— the two paths agree —");

  /*
   * The section's strongest claim, and the only one that needs both builders run
   * side by side: that typing the sentence and calling the tool arrive at the same
   * transactions. The panel says "Direct" on 21 turns, which is a statement that
   * the model was not needed — not that it would have produced something else.
   *
   * Compared by `kind` sequence rather than by whole intents. The two paths pass
   * different amounts (the prompt says "1000 USDC", the example may say something
   * else) and deadlines are wall-clock, so field equality would fail for reasons
   * that are not drift. The step *shapes* are what the reader is being shown.
   */
  const exampleOf = new Map(
    ALL_GROUPS.flatMap((g: Group) =>
      g.tools.map((t) => [t.name, t.example] as const),
    ),
  );

  for (const tool of all) {
    if (tool.via !== "local") continue;
    const args = exampleOf.get(tool.name);
    if (!args) {
      check(
        `${tool.name}: has an example to compare the typed plan against`,
        false,
      );
      continue;
    }
    const built = await planFromToolCalls(
      [{ name: tool.name, args }],
      TRACE_CHAIN,
      TRACE_DEPS,
      TRACE_OPTS,
    );
    const byCall = built.plan.map((i) => i.kind).join(",");
    const byTyping = tool.steps.map((s) => s.kind).join(",");
    check(
      `${tool.name}: typing it and calling it plan the same steps`,
      byCall === byTyping,
      `typed [${byTyping}] vs call [${byCall}] ${built.errors.join("; ")}`,
    );
  }

  console.log("\n— the shapes the section claims —");

  const swap = find("swap");
  check(
    "a swap is an approve and then the swap",
    swap?.steps.map((s) => s.kind).join(",") === "approve,swap",
    swap?.steps.map((s) => s.kind).join(","),
  );
  /* Guards the fixture, not the builder. `quote` returns an amount of the output
     token, and a fixture returning the ETH *price* instead type-checks and reads
     plausibly — it printed a minimum of 1825 WETH against 1000 USDC in, which is
     several million dollars of ETH for a thousand. A thousand dollars cannot buy
     a whole ETH at the fixture's price, so the minimum belongs under 1. */
  const minOut = Number(
    /Minimum received ([\d.]+)/.exec(swap?.steps[1]?.detail ?? "")?.[1],
  );
  check(
    "and its quoted minimum is an amount of WETH, not a USD price",
    minOut > 0.1 && minOut < 1,
    `${minOut}`,
  );

  const send = find("send");
  check(
    "a send is one transaction, and a plain transfer",
    send?.steps.length === 1 && send.steps[0].kind === "transfer",
    send?.steps.map((s) => s.kind).join(","),
  );

  const remove = find("removePosition");
  check(
    "closing a pool position is a decrease and then a collect",
    remove?.steps.map((s) => s.kind).join(",") ===
      "decreasePoolLiquidity,collectPoolFees",
    remove?.steps.map((s) => s.kind).join(","),
  );

  const repay = find("repay");
  check(
    "repay is called with no arguments at all",
    repay?.call === "repay()",
    repay?.call,
  );
  /* The trace's real point: the server picked the loan, so the model never had
     to invent an id. If the resolution breaks, the step still renders — with the
     id missing from the detail — which is why this asserts the id and not just
     the step count. */
  check(
    "and it still names the one open loan it resolved",
    !!repay?.steps.some((s) => (s.detail ?? "").includes("#314")),
    JSON.stringify(repay?.steps.map((s) => s.detail)),
  );

  const grant = find("grantAgentPermission");
  check(
    "a delegation grant is a single transaction",
    grant?.steps.length === 1 && grant.steps[0].kind === "grantAgentPermission",
    grant?.steps.map((s) => s.kind).join(","),
  );
  /* The bitmask is the argument that degrades silently: `numOf` yields null for
     anything non-numeric and fromToolCall.ts carries that through as 0, so a
     mandate permitting nothing renders identically to one permitting two
     actions. Typed here rather than eyeballed in the panel. */
  const grantExample = GROUPS.find((g: Group) => g.tab === "Delegation")
    ?.tools[0].example;
  check(
    "its allowedActions example is a number, not a list of verb names",
    typeof grantExample?.allowedActions === "number",
    typeof grantExample?.allowedActions,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
