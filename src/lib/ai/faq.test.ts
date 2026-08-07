// Checks on FAQ matching. Run with plain node — no test runner in this repo,
// and no runtime imports in faq.ts, same as fromCommand.test.ts.
//
// The bias under test: a genuine miss must fall through silently (null), never
// guess a nearby topic. A wrong FAQ answer is worse than no answer, because it
// reads as confident and correct.
import { matchFaq, FAQ_TOPICS } from "./faq.ts";

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

console.log("\n— matches real phrasing —");
check("health factor", matchFaq("what's my health factor")?.id === "health-factor");
check("liquidation, no exact phrase", matchFaq("can I get liquidated here")?.id === "health-factor");
check("points, casual phrasing", matchFaq("hows the points system work")?.id === "points");
check("kfusd", matchFaq("what is kfUSD")?.id === "kfusd");
check("kafusd, case insensitive", matchFaq("WHAT IS KAFUSD")?.id === "kafusd");
check("staking", matchFaq("how does staking work exactly")?.id === "staking");
check("agent permission", matchFaq("what can luca do for me")?.id === "agent-permission");
check("slippage", matchFaq("what is slippage tolerance")?.id === "slippage");
check("chains", matchFaq("which chains do you support")?.id === "chains");
check("model credits", matchFaq("how many reasoning requests do I get")?.id === "model-credits");
check("audit status", matchFaq("is this audited")?.id === "audit-status");

console.log("\n— genuine misses fall through silently —");
check("unrelated question returns null", matchFaq("what's the weather like") === null);
check("a stated command is not a question", matchFaq("swap 500 usdc to kld") === null);
check("empty string", matchFaq("") === null);
check("close-but-not-quite still misses", matchFaq("what is a factor of ten") === null);

console.log("\n— overlap resolves to the more specific topic —");
{
  // "vault" alone isn't a trigger for anything; the full phrase should still
  // land on kafusd specifically, not some shorter unrelated match.
  const r = matchFaq("how does the vault work");
  check("longest/most specific trigger wins", r?.id === "kafusd", r?.id);
}

console.log("\n— every topic is reachable and non-degenerate —");
{
  let allReachable = true;
  let noEmptyTriggers = true;
  for (const topic of FAQ_TOPICS) {
    if (topic.triggers.length === 0) noEmptyTriggers = false;
    for (const trigger of topic.triggers) {
      if (matchFaq(trigger)?.id !== topic.id) {
        allReachable = false;
        console.log(`  FAIL trigger "${trigger}" does not resolve to topic "${topic.id}"`);
      }
    }
  }
  check("every trigger phrase actually resolves to its own topic", allReachable);
  check("no topic has an empty trigger list", noEmptyTriggers);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
