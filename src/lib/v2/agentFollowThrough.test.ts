import { asksAboutLastResult, followThroughReply, reviveFollowThrough, reconcileFollowThrough } from "./agentFollowThrough.ts";

const outcome = { kind: "confirmed" as const, at: 1, steps: [{ title: "Swap USDC → EURC", hash: "0xabc", skipped: false }] };
if (!asksAboutLastResult("what happened with that?")) throw new Error("result question not recognised");
if (asksAboutLastResult("swap half of it")) throw new Error("fresh follow-up misclassified");
if (!followThroughReply(outcome).includes("0xabc")) throw new Error("hash missing from reply");
if (!reviveFollowThrough(outcome)?.steps[0]?.title) throw new Error("receipt did not revive");
if (reviveFollowThrough({ ...outcome, steps: [{ title: 4, skipped: false }] })) throw new Error("invalid receipt revived");
void (async () => {
  const checked = await reconcileFollowThrough(outcome, async () => ({ status: 0 }));
  if ((checked.steps[0] as { status?: string }).status !== "reverted") throw new Error("receipt was not reconciled");
  console.log("agent follow-through tests passed");
})();
