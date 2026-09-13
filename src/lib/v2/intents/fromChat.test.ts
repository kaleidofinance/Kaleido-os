/**
 * Every registered intent kind must survive the client's plan gate.
 *
 * Run with `npx tsx src/lib/v2/intents/fromChat.test.ts`.
 *
 * WHY THIS EXISTS. `intentsFromChat` is the only parser on both of the agent
 * page's model paths, and it drops any step it does not recognise so a
 * hallucinated action can't reach a resolver. For a long time it recognised a
 * hand-written list of 25 kinds while the union had grown to 35, so ten kinds —
 * `swapMultiHop`, `transfer`, `bridge`, `placeOrder`, `cancelOrder`,
 * `cancelAllOrders`, and the unstake trio, `increasePoolLiquidity` — were dropped
 * on the way to the review panel. The model's prose said "here's the plan" and no
 * steps rendered. Nothing caught it: the typed-grammar path never goes through
 * this function, so `test:turn` and the capabilities gate stayed green.
 *
 * THE LIST IS DERIVED, NOT WRITTEN. `ALL_INTENT_KINDS` is the keys of `AUDITORS`,
 * which tsc will not let be incomplete, so a kind that reaches the union reaches
 * this check without anyone remembering to add it — the same discipline
 * registry.test.ts uses for resolvers.
 */
import { ALL_INTENT_KINDS } from "../../ai/auditor.ts";
import { intentsFromChat } from "./fromChat.ts";
import type { IntentKind } from "./types.ts";

/* Imported for the side effect: register() runs on import and IS the registry
   isRegistered reads. Without it every kind would look unregistered. */
import "./definitions.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` ${got}`}`);
  }
};

/** Wraps steps in the shape /api/chat returns. */
const fromPlan = (plan: unknown[]) =>
  intentsFromChat({ context: { plan } });

function main() {
  console.log("\n— every registered kind survives the plan gate —");

  check(
    "the derived kind list is not empty",
    ALL_INTENT_KINDS.length > 0,
    `got ${ALL_INTENT_KINDS.length}`,
  );

  /* Named individually rather than counted: a failure is a specific kind whose
     model-built plan renders no step, and the fix would be per kind. A bare
     `{ kind }` is enough — the gate checks only that the kind resolves, not the
     rest of the shape, which the server already audited. */
  const dropped = ALL_INTENT_KINDS.filter(
    (k) => fromPlan([{ kind: k }]).length !== 1,
  );
  check(
    `all ${ALL_INTENT_KINDS.length} registered kinds survive intentsFromChat`,
    dropped.length === 0,
    `dropped: ${dropped.join(", ")}`,
  );

  console.log("\n— and nothing else does —");

  check(
    "an unregistered kind is dropped",
    fromPlan([{ kind: "notAnIntentKind" }]).length === 0,
  );
  check(
    "a step with no kind is dropped",
    fromPlan([{ amount: "5" }, null, "swap"]).length === 0,
  );
  check(
    "a non-array plan yields no steps",
    intentsFromChat({ context: { plan: "swap" } }).length === 0 &&
      intentsFromChat({}).length === 0,
  );

  /* The mixed case is the real one: a good step next to a bad one keeps the good
     one and only the good one. Uses a kind that the old hand-list omitted, so
     this fails against the regression it guards. */
  const mixed = fromPlan([
    { kind: "swapMultiHop" as IntentKind },
    { kind: "notAKind" },
    { kind: "bridge" as IntentKind },
  ]);
  check(
    "a valid step beside an invalid one is kept, alone",
    mixed.length === 2 &&
      mixed.every((s) => s.kind === "swapMultiHop" || s.kind === "bridge"),
    `kept ${mixed.map((s) => s.kind).join(", ")}`,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
