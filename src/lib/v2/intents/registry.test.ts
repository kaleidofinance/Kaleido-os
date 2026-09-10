/**
 * Every intent kind must have a resolver, and nothing but this says so.
 *
 * Run with `npx tsx src/lib/v2/intents/registry.test.ts`.
 *
 * WHY THIS EXISTS. Two of the three tables an intent passes through are total
 * records keyed by `IntentKind` — `ACTION_OF` and `AUDITORS` in lib/ai/auditor.ts
 * — so a new kind without an entry does not compile. The third is not a table at
 * all: `register()` is a call, executed for its side effect when
 * intents/definitions.ts is imported. A kind nobody calls it for typechecks
 * perfectly.
 *
 * That is the worst of the three to be missing, because of WHEN it fails. A
 * missing auditor rule refuses the plan before anything is signed. A missing
 * resolver refuses nothing: the plan builds, the review panel renders it, the
 * user reads it and clicks through — and the failure lands at the moment they
 * expect a wallet prompt. Everything before that point told them it would work.
 *
 * It is not hypothetical. #60 shipped `placeOrder`, `cancelOrder` and
 * `cancelAllOrders` with types, auditor rules and a page, and no resolvers; tsc
 * was clean and the whole suite was green. It was caught by hand, one commit
 * before the PR opened, by asking `isRegistered` in a scratch script. This is
 * that scratch script, kept.
 *
 * THE LIST IS DERIVED, NOT WRITTEN. `IntentKind` is a type and erases, so a
 * literal list of kinds is a second thing to keep in step with the union — and
 * auditor.test.ts's own KINDS array had already fallen behind by exactly the
 * three kinds above. `ALL_INTENT_KINDS` is the keys of `AUDITORS`, which tsc
 * will not let be incomplete. A kind that reaches the union reaches this check
 * without anyone remembering to add it.
 */
import { ALL_INTENT_KINDS } from "../../ai/auditor.ts";
import { isRegistered } from "./registry.ts";
import type { IntentKind } from "./types.ts";

/* Imported for the side effect, which IS the registry: every register() call
   lives at this module's top level and runs on import. Without it the check
   would report every kind unregistered and be right to. */
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

function main() {
  console.log("\n— every kind can actually be executed —");

  check(
    "the derived kind list is not empty",
    ALL_INTENT_KINDS.length > 0,
    `got ${ALL_INTENT_KINDS.length}`,
  );

  /* Named individually rather than counted. A failure here is a specific kind
     that will break at signing time, and the fix is per kind, so the message
     that names them is the useful one. */
  const missing = ALL_INTENT_KINDS.filter((k) => !isRegistered(k));
  check(
    `all ${ALL_INTENT_KINDS.length} intent kinds have a resolver`,
    missing.length === 0,
    `no resolver for: ${missing.join(", ")}`,
  );

  /* The control. If `isRegistered` returned true for everything — a refactor
     that made it a stub, say — the assertion above would pass while proving
     nothing, which is the failure mode a guardrail is most likely to have. */
  check(
    "and isRegistered says no to a kind that does not exist",
    !isRegistered("notAnIntentKind" as IntentKind),
    "isRegistered answers true for everything, so the check above is vacuous",
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
