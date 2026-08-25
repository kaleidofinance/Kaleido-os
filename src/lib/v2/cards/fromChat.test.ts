// Checks on card validation. Run with plain node — no test runner in this repo,
// and fromChat.ts has type-only imports, same as faq.test.ts.
//
// The bias under test: this is the only gate model-emitted UI passes through. A
// hallucinated intent still meets a wallet prompt; a hallucinated card renders
// immediately and looks like it came from the app. So the rule being defended
// throughout is drop, never repair — and never pass a field the validator did
// not itself write.
import { cardsFromChat, localCards } from "./fromChat.ts";
// Relative, not "@/lib/ai/faq" — plain node has no path aliases.
import { FAQ_TOPICS } from "../../ai/faq.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/** The wire shape: cards live under context.cards, beside context.plan. */
const wire = (cards) => cardsFromChat({ response: "hi", context: { cards } });

console.log("\n— valid cards survive —");
{
  const out = wire([
    { kind: "metric", label: "Health factor", value: "1.62" },
    {
      kind: "stats",
      title: "Caps",
      rows: [{ label: "Per action", value: "$1,000" }],
    },
    { kind: "notice", tone: "warn", title: "Nothing is tradable yet" },
  ]);
  check("three good cards all pass", out.length === 3);
  check(
    "kinds preserved in order",
    out.map((c) => c.kind).join(",") === "metric,stats,notice",
  );
  check("tone preserved", out[2].tone === "warn");
}
{
  const out = wire([
    {
      kind: "balance",
      rows: [{ symbol: "USDC", amount: "1,240.55", note: "on Base" }],
    },
    { kind: "actions", actions: [{ label: "Receive", prompt: "receive" }] },
  ]);
  check("balance row kept whole", out[0].rows[0].symbol === "USDC");
  check("balance note kept", out[0].rows[0].note === "on Base");
  check("action prompt kept", out[1].actions[0].prompt === "receive");
}

console.log("\n— unknown and malformed shapes are dropped —");
check(
  "unknown kind dropped",
  wire([{ kind: "iframe", src: "x" }]).length === 0,
);
check("no kind dropped", wire([{ label: "a", value: "b" }]).length === 0);
check("null entry dropped", wire([null, undefined, 7, "card"]).length === 0);
check(
  "cards not an array yields nothing",
  cardsFromChat({ context: { cards: { kind: "metric" } } }).length === 0,
);
check(
  "no context yields nothing",
  cardsFromChat({ response: "hi" }).length === 0,
);
check("garbage input yields nothing", cardsFromChat(null).length === 0);

console.log("\n— required fields are required, not defaulted —");
check(
  "metric without value dropped",
  wire([{ kind: "metric", label: "HF" }]).length === 0,
);
check(
  "metric with blank value dropped",
  wire([{ kind: "metric", label: "HF", value: "   " }]).length === 0,
);
check(
  "metric with numeric value dropped (strings only)",
  wire([{ kind: "metric", label: "HF", value: 1.62 }]).length === 0,
);
check(
  "stats with no rows dropped",
  wire([{ kind: "stats", rows: [] }]).length === 0,
);
check(
  "stats whose rows are all junk dropped",
  wire([{ kind: "stats", rows: [{ label: "a" }, null] }]).length === 0,
);
check(
  "notice without title dropped",
  wire([{ kind: "notice", tone: "bad", body: "x" }]).length === 0,
);
check(
  "actions with no usable action dropped",
  wire([{ kind: "actions", actions: [{ label: "Go" }] }]).length === 0,
);

console.log("\n— hostile fields cannot ride along —");
{
  const out = wire([
    {
      kind: "metric",
      label: "Balance",
      value: "1.00",
      href: "https://evil.example",
      onClick: "alert(1)",
      dangerouslySetInnerHTML: { __html: "<script>x</script>" },
      intent: { kind: "swap", amount: "999" },
    },
  ]);
  check("card survives", out.length === 1);
  check("href stripped", !("href" in out[0]));
  check("onClick stripped", !("onClick" in out[0]));
  check("innerHTML stripped", !("dangerouslySetInnerHTML" in out[0]));
  check("smuggled intent stripped", !("intent" in out[0]));
}
{
  // An unknown tone must not reach a CSS class name.
  const out = wire([{ kind: "notice", tone: "evil", title: "x" }]);
  check("unknown tone falls back to neutral", out[0].tone === "neutral");
  const s = wire([
    { kind: "stats", rows: [{ label: "a", value: "b", tone: "../../x" }] },
  ]);
  check("unknown row tone omitted entirely", !("tone" in s[0].rows[0]));
}

console.log("\n— strings are single-line and capped —");
{
  const out = wire([{ kind: "metric", label: "a\nb\tc", value: "1" }]);
  check("newlines and tabs collapse to a space", out[0].label === "a b c");
}
{
  const out = wire([{ kind: "metric", label: "L".repeat(200), value: "1" }]);
  check("over-long label is truncated", out[0].label.length <= 40);
  check("truncation is marked with an ellipsis", out[0].label.endsWith("…"));
}
{
  const out = wire([
    { kind: "actions", actions: [{ label: "Go", prompt: "x".repeat(500) }] },
  ]);
  check("over-long prompt is capped", out[0].actions[0].prompt.length <= 120);
}

console.log("\n— counts are capped, so one turn cannot own the viewport —");
{
  const many = Array.from({ length: 12 }, (_, i) => ({
    kind: "metric",
    label: `m${i}`,
    value: "1",
  }));
  check("cards per turn capped at 3", wire(many).length === 3);
}
{
  const rows = Array.from({ length: 40 }, (_, i) => ({
    label: `r${i}`,
    value: "1",
  }));
  check(
    "stats rows capped at 8",
    wire([{ kind: "stats", rows }])[0].rows.length === 8,
  );
  check(
    "balance rows capped at 8",
    wire([
      {
        kind: "balance",
        rows: rows.map((r) => ({ symbol: r.label, amount: r.value })),
      },
    ])[0].rows.length === 8,
  );
}
{
  const actions = Array.from({ length: 10 }, (_, i) => ({
    label: `a${i}`,
    prompt: "receive",
  }));
  check(
    "actions capped at 4",
    wire([{ kind: "actions", actions }])[0].actions.length === 4,
  );
}

console.log("\n— the FAQ's own static cards survive their own validator —");
{
  // A topic that writes a 300-character body or a tenth row would silently lose
  // it at runtime. This is the check that turns that into a red test instead.
  let allIntact = true;
  for (const topic of FAQ_TOPICS) {
    if (!topic.cards) continue;
    const out = localCards(topic.cards);
    if (out.length !== topic.cards.length) {
      allIntact = false;
      console.log(`  FAIL topic "${topic.id}" lost a card to the validator`);
      continue;
    }
    if (JSON.stringify(out) !== JSON.stringify(topic.cards)) {
      allIntact = false;
      console.log(
        `  FAIL topic "${topic.id}" was altered (truncated or a field dropped)`,
      );
    }
  }
  check("every FAQ card passes through unchanged", allIntact);
  check(
    "no topic exceeds the per-turn card cap once a figure is added",
    FAQ_TOPICS.every((t) => (t.cards?.length ?? 0) + (t.figure ? 1 : 0) <= 3),
  );
}

console.log("\n— localCards applies the same gate —");
check(
  "local cards pass through the validator",
  localCards([{ kind: "metric", label: "x", value: "1" }]).length === 1,
);
check(
  "a local emitter cannot exceed the row cap either",
  localCards([
    {
      kind: "stats",
      rows: Array.from({ length: 20 }, () => ({ label: "a", value: "b" })),
    },
  ])[0].rows.length === 8,
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
