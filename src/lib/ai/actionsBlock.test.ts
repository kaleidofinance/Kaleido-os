/**
 * The offered-actions block: parsing it, and keeping it off the screen.
 *
 * Run with `npx tsx src/lib/ai/actionsBlock.test.ts`.
 *
 * Two properties matter here and they are different. `splitActionsBlock` is
 * about the finished reply — what gets saved and shown. `visibleProse` is about
 * the live one, where the text is whatever has arrived so far and the block is
 * still being typed; a case that passes for the whole block can still flash raw
 * backticks on screen a delta earlier.
 */
import {
  ACTIONS_FENCE,
  splitActionsBlock,
  visibleProse,
} from "./actionsBlock.ts";

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
  console.log("\n— a reply with no block —");
  {
    const r = splitActionsBlock("You have $0 on this chain.");
    check(
      "prose is untouched",
      r.text === "You have $0 on this chain.",
      r.text,
    );
    check("no actions", r.actions.length === 0, String(r.actions.length));

    /* An ordinary code fence is not an actions block. The tag is what selects
       it, so a reply that shows a command keeps the command. */
    const code = splitActionsBlock("Run this:\n```\nswap 500 USDC\n```");
    check(
      "an untagged fence survives",
      code.text.includes("swap 500 USDC") && code.actions.length === 0,
      code.text,
    );
  }

  console.log("\n— a reply that offers actions —");
  {
    const raw =
      "Nothing to move yet — the wallet is empty on Sepolia.\n\n" +
      `${ACTIONS_FENCE}\n` +
      '[{"label":"Claim from the faucet","prompt":"claim everything from the faucet"},' +
      '{"label":"Check Base Sepolia","prompt":"what do I hold on Base Sepolia?"}]\n' +
      "```";
    const r = splitActionsBlock(raw);
    check(
      "the prose is the answer alone",
      r.text === "Nothing to move yet — the wallet is empty on Sepolia.",
      JSON.stringify(r.text),
    );
    check("no fence survives", !r.text.includes("```"), r.text);
    check(
      "both actions parsed",
      r.actions.length === 2,
      String(r.actions.length),
    );
    check(
      "label and prompt come through",
      r.actions[0].label === "Claim from the faucet" &&
        r.actions[0].prompt === "claim everything from the faucet",
      JSON.stringify(r.actions[0]),
    );
  }

  console.log("\n— shapes a model reaches for unprompted —");
  {
    const wrapped = splitActionsBlock(
      `Pick one.\n${ACTIONS_FENCE}\n{"actions":[{"label":"Stake","prompt":"stake 100 KLD"}]}\n\`\`\``,
    );
    check(
      "an {actions:[...]} wrapper is accepted",
      wrapped.actions.length === 1 && wrapped.actions[0].label === "Stake",
      JSON.stringify(wrapped.actions),
    );

    const partialItems = splitActionsBlock(
      `Pick one.\n${ACTIONS_FENCE}\n[{"label":"Stake","prompt":"stake 100 KLD"},{"label":"no prompt"}]\n\`\`\``,
    );
    check(
      "an entry missing a field is dropped, the rest kept",
      partialItems.actions.length === 1,
      JSON.stringify(partialItems.actions),
    );
  }

  console.log("\n— malformed blocks lose the buttons, never the answer —");
  {
    const broken = splitActionsBlock(
      `Here is where you stand.\n${ACTIONS_FENCE}\n[{"label": "oops",,]\n\`\`\``,
    );
    check(
      "the answer survives",
      broken.text === "Here is where you stand.",
      broken.text,
    );
    check(
      "no actions",
      broken.actions.length === 0,
      String(broken.actions.length),
    );
    check("and no JSON on screen", !broken.text.includes("oops"), broken.text);

    /* Cut off mid-block: no closing fence at all. */
    const cut = splitActionsBlock(
      `Two ways forward.\n${ACTIONS_FENCE}\n[{"label":"Cla`,
    );
    check(
      "a truncated block keeps the prose",
      cut.text === "Two ways forward.",
      cut.text,
    );
    check(
      "and yields nothing",
      cut.actions.length === 0,
      String(cut.actions.length),
    );
    check("and leaves no backticks", !cut.text.includes("`"), cut.text);
  }

  console.log("\n— prose that follows the block is not lost —");
  {
    const after = splitActionsBlock(
      `Pick one.\n${ACTIONS_FENCE}\n[{"label":"Stake","prompt":"stake 100 KLD"}]\n\`\`\`\nEither is fine.`,
    );
    check(
      "text after the close is kept",
      after.text.includes("Pick one.") &&
        after.text.includes("Either is fine."),
      JSON.stringify(after.text),
    );
    check(
      "still one action",
      after.actions.length === 1,
      String(after.actions.length),
    );
  }

  console.log("\n— the live view, delta by delta —");
  {
    const full =
      `All set.\n\n${ACTIONS_FENCE}\n[{"label":"Stake","prompt":"stake 100 KLD"}]\n` +
      "```";

    /* Every prefix of the reply, which is what the bubble is handed as the
       stream arrives. None of them may show a code fence or the block's JSON.
       A lone backtick is allowed through — see visibleProse for why holding it
       cost a real answer its last character. */
    let leaked: string | null = null;
    for (let i = 1; i <= full.length; i++) {
      const shown = visibleProse(full.slice(0, i));
      if (shown.includes("```") || shown.includes('{"label"')) {
        leaked = `at ${i}: ${JSON.stringify(shown.slice(-24))}`;
        break;
      }
    }
    check("no prefix ever shows the block", leaked === null, leaked ?? "");

    check(
      "the answer itself is shown in full",
      visibleProse(full) === "All set.",
      JSON.stringify(visibleProse(full)),
    );
    check(
      "a reply with no block is passed straight through",
      visibleProse("Half a sen") === "Half a sen",
      visibleProse("Half a sen"),
    );

    /* Two backticks could still become the fence, so they wait. */
    check(
      "a two-backtick tail is held",
      visibleProse("done ``") === "done",
      JSON.stringify(visibleProse("done ``")),
    );
    /* One cannot be held: an answer is allowed to end in inline code. */
    check(
      "a closing inline-code backtick is not eaten",
      visibleProse("run `swap`") === "run `swap`",
      visibleProse("run `swap`"),
    );
  }
}

main();
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
