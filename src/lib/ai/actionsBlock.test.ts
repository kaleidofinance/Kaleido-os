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
  CARDS_FENCE,
  MAX_REASONING_CHARS,
  REASONING_FENCE,
  splitActionsBlock,
  splitCards,
  splitReasoning,
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

  const kindOf = (c: unknown) => (c as { kind?: string }).kind;

  console.log("\n— the cards block: display cards from the model —");
  {
    const raw =
      "Your position:\n\n" +
      `${CARDS_FENCE}\n` +
      '[{"kind":"metric","label":"Health factor","value":"1.62"},' +
      '{"kind":"gauge","label":"HF","value":"1.62","fraction":0.3,"tone":"warn"}]\n' +
      "```";
    const r = splitCards(raw);
    check("the prose is the answer alone", r.text === "Your position:", JSON.stringify(r.text));
    check("no fence survives", !r.text.includes("```"), r.text);
    check("both cards parsed as raw objects", r.cards.length === 2 && kindOf(r.cards[0]) === "metric", JSON.stringify(r.cards));

    /* A cards block AND an actions block in one reply: both come out, the
       actions wrapped as a card and appended after the display cards. */
    const both = splitCards(
      "Here.\n\n" +
        `${CARDS_FENCE}\n[{"kind":"metric","label":"Net","value":"$10"}]\n\`\`\`\n\n` +
        `${ACTIONS_FENCE}\n[{"label":"Swap","prompt":"swap 5 usdc to kld"}]\n\`\`\``,
    );
    check("cards then actions, prose clean", both.text === "Here." && both.cards.length === 2, JSON.stringify(both));
    check(
      "the last card is the wrapped actions",
      kindOf(both.cards[1]) === "actions" &&
        (both.cards[1] as { actions?: unknown[] }).actions?.length === 1,
      JSON.stringify(both.cards[1]),
    );

    /* Malformed cards JSON loses the cards, keeps the prose, shows no JSON. */
    const broken = splitCards(`You stand here.\n${CARDS_FENCE}\n[{"kind":,,]\n\`\`\``);
    check("malformed cards keep the prose", broken.text === "You stand here." && broken.cards.length === 0, JSON.stringify(broken));
    check("and leave no JSON on screen", !broken.text.includes("kind"), broken.text);

    /* A {cards:[...]} wrapper is accepted, like the actions wrapper. */
    const wrapped = splitCards(
      `x\n${CARDS_FENCE}\n{"cards":[{"kind":"notice","tone":"warn","title":"Careful"}]}\n\`\`\``,
    );
    check("a {cards:[...]} wrapper is accepted", wrapped.cards.length === 1 && kindOf(wrapped.cards[0]) === "notice", JSON.stringify(wrapped.cards));

    const plain = splitCards("You have $0 here.");
    check("no block means no cards", plain.text === "You have $0 here." && plain.cards.length === 0);
  }

  console.log("\n— the live view suppresses a cards block too —");
  {
    const full = `Reading it.\n\n${CARDS_FENCE}\n[{"kind":"metric","label":"HF","value":"1.6"}]\n\`\`\``;
    let leaked: string | null = null;
    for (let i = 1; i <= full.length; i++) {
      const shown = visibleProse(full.slice(0, i));
      if (shown.includes("```") || shown.includes('{"kind"')) {
        leaked = `at ${i}`;
        break;
      }
    }
    check("no prefix ever shows the cards block", leaked === null, leaked ?? "");
    check("the answer shows in full", visibleProse(full) === "Reading it.", JSON.stringify(visibleProse(full)));
  }

  console.log("\n— the reasoning block: the model's distilled 'why' —");
  {
    const raw =
      "Route it through the 0.05% pool.\n\n" +
      `${REASONING_FENCE}\n` +
      "Chose the 0.05% pool over 0.30% — tighter price at this size.\n" +
      "```";
    const r = splitReasoning(raw);
    check(
      "the prose is the answer alone",
      r.text === "Route it through the 0.05% pool.",
      JSON.stringify(r.text),
    );
    check("no fence survives", !r.text.includes("```"), r.text);
    check(
      "the reasoning line comes through",
      r.reasoning ===
        "Chose the 0.05% pool over 0.30% — tighter price at this size.",
      JSON.stringify(r.reasoning),
    );

    /* No block: the prose is untouched and there is no line. */
    const none = splitReasoning("You have $0 on this chain.");
    check(
      "no block means no reasoning and untouched prose",
      none.reasoning === null && none.text === "You have $0 on this chain.",
      JSON.stringify(none),
    );

    /* A multi-line body is the model over-writing the channel: the first
       non-empty line is taken, the rest dropped. */
    const many = splitReasoning(
      `Done.\n${REASONING_FENCE}\n\nThe deciding reason.\nA second line it should not have written.\n\`\`\``,
    );
    check(
      "a multi-line body keeps only the first line",
      many.reasoning === "The deciding reason." && many.text === "Done.",
      JSON.stringify(many),
    );

    /* Over-long: truncated to the cap, never allowed to push the fold apart. */
    const long = splitReasoning(
      `Ok.\n${REASONING_FENCE}\n${"x".repeat(400)}\n\`\`\``,
    );
    check(
      "an over-long line is capped",
      (long.reasoning?.length ?? 0) === MAX_REASONING_CHARS,
      String(long.reasoning?.length),
    );

    /* Cut off mid-block, no closing fence: the prose before it is a real answer;
       the half-written block is lifted out rather than shown raw. */
    const cut = splitReasoning(`The answer.\n${REASONING_FENCE}\nBecause`);
    check(
      "a truncated block keeps the prose and leaves no backticks",
      cut.text === "The answer." && !cut.text.includes("`"),
      JSON.stringify(cut.text),
    );

    /* Reasoning first, then cards: the route runs splitReasoning before
       splitCards, so a reply carrying both comes apart cleanly. */
    const withCards = splitReasoning(
      "Here.\n\n" +
        `${REASONING_FENCE}\nThe reason.\n\`\`\`\n\n` +
        `${CARDS_FENCE}\n[{"kind":"metric","label":"HF","value":"1.6"}]\n\`\`\``,
    );
    const cards = splitCards(withCards.text);
    check(
      "reasoning off first, cards still parse from the rest",
      withCards.reasoning === "The reason." &&
        cards.text === "Here." &&
        cards.cards.length === 1,
      JSON.stringify({ reasoning: withCards.reasoning, cards }),
    );
  }

  console.log("\n— the live view suppresses a reasoning block too —");
  {
    const full = `All set.\n\n${REASONING_FENCE}\nThe reason it landed here.\n\`\`\``;
    let leaked: string | null = null;
    for (let i = 1; i <= full.length; i++) {
      const shown = visibleProse(full.slice(0, i));
      if (shown.includes("```") || shown.includes("The reason it")) {
        leaked = `at ${i}: ${JSON.stringify(shown.slice(-24))}`;
        break;
      }
    }
    check("no prefix ever shows the reasoning block", leaked === null, leaked ?? "");
    check(
      "the answer shows in full",
      visibleProse(full) === "All set.",
      JSON.stringify(visibleProse(full)),
    );
  }
}

main();
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
