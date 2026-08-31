/**
 * A read's identity, which is what decides whether a round touches the chain.
 *
 * Run with `npx tsx src/lib/ai/readKey.test.ts`.
 *
 * `readKey` is the whole dedup in src/lib/ai/agent.ts: two reads collide iff
 * their keys are equal, so a key that is too loose drops a question the model
 * genuinely needed to ask, and a key that is too strict lets the duplicate
 * through and hands the user a reply that retracts itself. Both failures are
 * silent — nothing throws either way, which is why they are pinned here rather
 * than left to the loop.
 */
import { readKey } from "./readKey.ts";

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
  console.log("\n— the same question, however it is spelled —");
  {
    /* The model emits object keys in whatever order it writes them, and that
       order carries no meaning. Two spellings of one call must collide. */
    check(
      "key order does not matter",
      readKey("getQuote", { from: "USDC", to: "KLD" }) ===
        readKey("getQuote", { to: "KLD", from: "USDC" }),
      readKey("getQuote", { to: "KLD", from: "USDC" }),
    );
    check(
      "identical calls collide",
      readKey("getPortfolio", { address: "0xabc" }) ===
        readKey("getPortfolio", { address: "0xabc" }),
    );
    check(
      "no args is stable",
      readKey("getChains", undefined) === readKey("getChains", undefined),
      readKey("getChains", undefined),
    );
  }

  console.log("\n— different questions stay different —");
  {
    check(
      "a different tool is a different key",
      readKey("getPortfolio", { address: "0xabc" }) !==
        readKey("getMarkets", { address: "0xabc" }),
    );
    check(
      "a different value is a different key",
      readKey("getPortfolio", { address: "0xabc" }) !==
        readKey("getPortfolio", { address: "0xdef" }),
    );
    /* An extra argument narrows the question, so it is not the same question. */
    check(
      "an extra argument is a different key",
      readKey("getPortfolio", { address: "0xabc" }) !==
        readKey("getPortfolio", { address: "0xabc", chainId: 84532 }),
    );
  }

  console.log("\n— nested arguments survive —");
  {
    /* The bug this shape exists to avoid: JSON.stringify's array-replacer form
       sorts the top level but applies the same allowlist to every nested object,
       so `{ filter: { minApy: 3 } }` would serialise with the nested key gone and
       collide with a filter asking something else entirely. */
    const a = readKey("getMarkets", { filter: { minApy: 3 } });
    const b = readKey("getMarkets", { filter: { minApy: 9 } });
    check("a nested value distinguishes two calls", a !== b, `${a} vs ${b}`);
    check("the nested key is not dropped", a.includes("minApy"), a);

    check(
      "nested key order still does not matter",
      readKey("getMarkets", { f: { y: 2, z: 1 } }) ===
        readKey("getMarkets", { f: { z: 1, y: 2 } }),
    );
  }

  console.log("\n— arrays are ordered —");
  {
    /* Unlike an object's keys, position in an array is meaning: a route
       USDC→KLD is not the route KLD→USDC. */
    check(
      "array order is preserved",
      readKey("getQuote", { path: ["USDC", "KLD"] }) !==
        readKey("getQuote", { path: ["KLD", "USDC"] }),
    );
    check(
      "an equal array still collides",
      readKey("getQuote", { path: ["USDC", "KLD"] }) ===
        readKey("getQuote", { path: ["USDC", "KLD"] }),
    );
  }

  console.log("\n— values that are not objects —");
  {
    /* null is typeof "object" and would throw on Object.keys if it reached the
       object branch, so it has its own path. All three spellings of "no
       arguments" are one question: a no-argument read must not run twice because
       one round wrote `{}` and the next wrote nothing. */
    check(
      "null args",
      readKey("t", null) === readKey("t", null),
      readKey("t", null),
    );
    check(
      "absent, null and empty-object all collide",
      readKey("t", undefined) === readKey("t", null) &&
        readKey("t", null) === readKey("t", {}),
      `${readKey("t", undefined)} / ${readKey("t", null)} / ${readKey("t", {})}`,
    );
    check(
      "no arguments keys to the bare tool name",
      readKey("getChains", undefined) === "getChains",
      readKey("getChains", undefined),
    );
    /* An empty array is not an empty argument list — it is an argument whose
       value happens to be empty, and a later non-empty one is a real change. */
    check(
      "an empty array is not no-arguments",
      readKey("t", []) !== readKey("t", undefined),
      `${readKey("t", [])} vs ${readKey("t", undefined)}`,
    );
    check(
      "a nested null does not throw",
      readKey("t", { a: null }) === readKey("t", { a: null }),
      readKey("t", { a: null }),
    );
    check(
      "a string arg differs from a number that looks like it",
      readKey("t", { n: "1" }) !== readKey("t", { n: 1 }),
    );
  }
}

main();
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
