import assert from "node:assert/strict";
import { runTurn } from "./turnRunner";
import type { ChatProvider } from "./types";

const provider: ChatProvider = {
  id: "turn-runner-test",
  model: "turn-runner-test",
  async chat() {
    return {
      text: "Ready.",
      reads: [],
      executes: [],
      provider: "turn-runner-test",
      model: "turn-runner-test",
    };
  },
};

(async () => {
  const result = await runTurn({
    providers: [provider],
    input: { message: "hello" },
  });
  assert.equal(result.text, "Ready.");
  assert.equal(result.rounds, 0);
  await assert.rejects(
    () => runTurn({ providers: [], input: { message: "hello" } }),
    /No model provider configured/,
  );
  console.log("Turn runner checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
