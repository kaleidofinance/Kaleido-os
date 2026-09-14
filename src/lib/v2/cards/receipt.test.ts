// A settled plan turned into a headline and a receipt card. Run with plain node
// like the rest — receipt.ts is pure and imports no component.
//
// Asserted through localCards too, because that validator is what the frame
// actually receives: a receipt that vanished between here and the screen would
// leave a completed plan reporting nothing, which is the failure this replaces.
import { receiptFromSettled } from "./receipt.ts";
import { localCards } from "./fromChat.ts";

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

console.log("\n— two transactions, from the screenshot —");
{
  const { head, card } = receiptFromSettled([
    { title: "Approve USDC", hash: "0xde20a80d000000fbb1c6", skipped: false, ms: 35300 },
    { title: "Swap 5 USDC for KLD", hash: "0xc377664cc0000ed7d3c", skipped: false, ms: 13300 },
  ]);
  check("headline counts the txs and the total time", head === "Done — 2 transactions confirmed in 48.6s.", head);
  check("a steps card, one row per step", card?.kind === "steps" && card.steps.length === 2, JSON.stringify(card));
  check(
    "a ran step is done, with timing then a shortened hash",
    card.steps[0].status === "done" &&
      card.steps[0].detail?.includes("35.3s") &&
      card.steps[0].detail?.includes("0xde20a80d…fbb1c6"),
    card.steps[0].detail,
  );
  check("nothing sent is not claimed — both hashes present", card.steps.every((s) => s.status === "done"));
  check("survives the validator as one card", localCards([card]).length === 1);
}

console.log("\n— a skipped approve does not inflate the count —");
{
  const { head, card } = receiptFromSettled([
    { title: "Approve USDC", skipped: true },
    { title: "Swap 5 USDC for KLD", hash: "0xabc0000000000000def", skipped: false, ms: 12000 },
  ]);
  check(
    "the skipped step is marked skipped and says why",
    card.steps[0].status === "skipped" && card.steps[0].detail === "already in place",
    JSON.stringify(card.steps[0]),
  );
  check("the count is of what actually sent, so 1 not 2", head.startsWith("Done — 1 transaction confirmed"), head);
}

console.log("\n— a signature-only step broadcast nothing —");
{
  const { head, card } = receiptFromSettled([
    { title: "Place order", skipped: false },
  ]);
  check(
    "no hash and not skipped → done, no transaction needed",
    card.steps[0].status === "done" && card.steps[0].detail?.includes("no transaction needed"),
    JSON.stringify(card.steps[0]),
  );
  check("nothing sent → the 'nothing needed' headline", head === "Done — nothing needed to be sent.", head);
}

console.log("\n— an empty plan is a bare Done, no card —");
{
  const { head, card } = receiptFromSettled([]);
  check("headline is just Done", head === "Done.", head);
  check("and there is no card to itemise nothing", card === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
