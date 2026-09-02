// Checks on the campaign recipient cleaner. Run with plain node (tsx).
//
// This module decides who receives the testnet access code and who silently does
// not, and the failure mode is quiet: a rule that drops the wrong people produces a
// smaller number and nothing says the number is wrong. So the checks below are
// mostly about inclusion — that a person who filled in the form correctly is never
// lost to a parser detail, and that the one real mistake this made is fixed and
// stays fixed.
//
// The measurement it exists to protect, from the 2026-09-02 export of the whitelist
// form: 3,165 registrations, 32 addresses recovered from another column, 88
// duplicates, 0 unusable, 3,077 deliverable, 98.1% of them gmail.com. The export
// itself cannot be committed — it is 3,000 people's addresses and this repository is
// public — so the shapes that produced those numbers are reproduced synthetically
// here instead.
import { cleanList, findEmailColumn, isDeliverable, isRoleAddress, parseCsv } from "./recipients.ts";

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

const throws = (name, fn, match = "") => {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, msg.includes(match), `threw "${msg}", wanted it to mention "${match}"`);
  }
};

console.log("\n— the CSV reader survives what a form export actually contains —");
{
  /* A line-splitting parser reads a newline inside a quoted answer as several
     broken rows, which shifts every column. That does not fail loudly; it mangles
     the addresses. Everything here is a shape seen in real Forms output. */
  const rows = parseCsv(
    'a,b,c\n"has, a comma",plain,"said ""hi"""\n"two\nlines",x,y\r\nlast,row,here',
  );
  check("keeps a comma inside quotes as one cell", rows[1][0] === "has, a comma", JSON.stringify(rows[1]));
  check("unescapes a doubled quote", rows[1][2] === 'said "hi"', JSON.stringify(rows[1][2]));
  check("keeps a newline inside quotes in one cell", rows[2][0] === "two\nlines", JSON.stringify(rows[2][0]));
  check("does not leave \\r on a CRLF row", rows[2][2] === "y", JSON.stringify(rows[2][2]));
  check("reads a final row with no trailing newline", rows[3]?.[2] === "here", JSON.stringify(rows[3]));
  check("every row has the same width", rows.every((r) => r.length === 3), rows.map((r) => r.length).join(","));

  /* A trailing newline otherwise yields a final empty row, which counts as a
     registration and then as an invalid address. */
  check("drops a wholly blank row", parseCsv("a,b\n1,2\n,,\n").length === 2);
  check("drops the row a trailing newline leaves behind", parseCsv("a,b\n1,2\n").length === 2);
  check("an empty cell is still a cell", parseCsv("a,b,c\n1,,3")[1].length === 3);
}

console.log("\n— what counts as deliverable —");
{
  /* Plus-addressing is how a large minority of a crypto list signs up. Stripping or
     rejecting it mails a different mailbox than the one someone typed. */
  check("accepts plus-addressing", isDeliverable("carol+testnet@gmail.com"));
  check("accepts a dotted local part", isDeliverable("first.last@gmail.com"));
  check("accepts a multi-level domain", isDeliverable("a@mail.sub.example.co.uk"));
  check("accepts a hyphenated domain", isDeliverable("a@kaleido-test.xyz"));
  check("normalises case and whitespace", isDeliverable("  Alice@Example.COM  "));

  check("rejects a missing @", !isDeliverable("yes"));
  check("rejects a wallet address", !isDeliverable("0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955"));
  check("rejects a trailing dot", !isDeliverable("eve@example."));
  check("rejects a domain with no dot", !isDeliverable("eve@localhost"));
  check("rejects a space in the middle", !isDeliverable("frank smith@example.com"));
  check("rejects a leading @", !isDeliverable("@@vrjfb75151"));
  check("rejects empty", !isDeliverable(""));
  check("rejects a hyphen at the start of a label", !isDeliverable("a@-example.com"));
  /* Only the whole cell counts. Otherwise a support address quoted in a free-text
     answer becomes a recipient. */
  check("rejects a sentence containing an address", !isDeliverable("mail me at a@b.com please"));

  check("info@ is a role address", isRoleAddress("info@company.com"));
  check("support@ is a role address", isRoleAddress("support@vendor.io"));
  check("a person is not", !isRoleAddress("grace@kaleido-test.xyz"));
  check("a name that merely starts with a role word is not", !isRoleAddress("supportive@gmail.com"));
}

console.log("\n— finding the column the addresses are in —");
{
  const named = parseCsv('Timestamp,Name,Email Address,Chain\n1,Al,al@x.com,Base');
  check("uses a header that says Email Address", findEmailColumn(named).column === 2);
  check("does not report a named column as guessed", findEmailColumn(named).guessed === false);

  check(
    "uses a header that says E-mail",
    findEmailColumn(parseCsv("Name,E-mail\nAl,al@x.com")).column === 1,
  );

  /* Forms names the column after the question, so there may be no "email" anywhere
     in the header. Falling back to content is what stops that mailing nobody. */
  const asked = parseCsv('Timestamp,Name,Where should we send your code?\n1,Al,al@x.com\n2,Bo,bo@y.com');
  check("falls back to the column holding addresses", findEmailColumn(asked).column === 2);
  check("reports the fallback as guessed", findEmailColumn(asked).guessed === true);

  /* The trap this exists for. Taking the FIRST header mentioning email picks the
     yes/no column and reports almost every registration as invalid — a plausible
     small number with no error anywhere. */
  const decoy = parseCsv(
    "Want email updates?,Email Address\nyes,al@x.com\nno,bo@y.com\nyes,cy@z.com",
  );
  check("prefers the email-ish column that actually holds addresses", findEmailColumn(decoy).column === 1);

  /* Row wider than the header: the addresses can be in a cell the header never
     described, and scoring only header-width columns would miss them. */
  const wide = parseCsv("Timestamp,Name\n1,Al,al@x.com\n2,Bo,bo@y.com");
  check("scores columns past the end of the header", findEmailColumn(wide).column === 2);

  throws("refuses a file with a header and no rows", () => findEmailColumn(parseCsv("Name,Email\n")), "no data rows");
  throws(
    "refuses a file with no addresses anywhere",
    () => findEmailColumn(parseCsv("Name,Chain\nAl,Base\nBo,Sepolia")),
    "looks like email addresses",
  );
}

console.log("\n— the 32 people who typed their address into the wrong box —");
{
  /*
   * The regression this whole file exists for. Of 3,165 real registrations, 32
   * answered the form's "Username" question with their email address and the
   * "Email Address" question with something else. Username is asked first and sits
   * directly above it, so they answered it with the thing they were about to be
   * asked for. Every one of those rows carries a perfectly good address one column
   * over, and the promise made publicly was that every registrant receives the
   * code — so reporting them as invalid drops 1% of the list to a form-layout
   * confusion, silently, under a label blaming the data.
   *
   * The three things they actually put in the email box, all seen in the export.
   *
   * The clean rows at the top are not padding. Without them the Username column
   * holds more addresses than the email column does, and the column scorer quite
   * rightly concludes that Username *is* the email column — which is the correct
   * answer for that file and the wrong shape for this test. A real export is mostly
   * people who filled the form in properly.
   */
  const csv = [
    "Timestamp,Username,X Username,Email Address,Experience",
    "1,alice,@alice,alice@example.com,pro",
    "2,bob,@bob,bob@example.com,pro",
    "3,heidi@example.com,@heidi,yes,pro",
    "4,ivan@example.com,@ivan,ok,pro",
    "5,judy@example.com,@judy,0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955,pro",
    "6,karl@example.com,@karl,okay,pro",
  ].join("\n");
  const out = cleanList(csv);
  check("recovers all four", out.stats.recovered === 4, JSON.stringify(out.stats));
  check("loses nobody", out.stats.unusable === 0, JSON.stringify(out.stats));
  check("mails everyone who registered", out.recipients.length === 6, out.recipients.join(","));
  check(
    "the recovered addresses come from the Username column",
    out.recipients.slice(2).join(",") ===
      "heidi@example.com,ivan@example.com,judy@example.com,karl@example.com",
    out.recipients.join(","),
  );
  /* The header named a column and that column does hold addresses, so this is not a
     guess — the address simply was not in it for four rows. Reporting `guessed` here
     would send the operator looking for a parsing problem that does not exist. */
  check("does not call this a guessed column", out.emailColumnGuessed === false);
  check("still reports the column the header named", out.emailColumn === 3, String(out.emailColumn));
}

console.log("\n— recovery refuses to guess when the row is ambiguous —");
{
  /* Two different addresses in one row: there is no way to tell which is theirs, and
     mailing an access code to the wrong one is not recoverable. Counted, not
     guessed at. The clean first row is what makes the email column win the scoring,
     so that the anomaly is a row-level problem rather than a column-level one. */
  const two = cleanList(
    [
      "Timestamp,Name,Email Address,Referred by,Backup contact",
      "1,Al,al@x.com,,",
      "2,Bo,ok,ivan@example.com,judy@example.com",
    ].join("\n"),
  );
  check("does not pick one of two addresses", two.stats.recovered === 0, JSON.stringify(two.stats));
  check("counts the row as ambiguous", two.stats.ambiguous === 1, JSON.stringify(two.stats));
  check("ambiguous rows are also unusable", two.stats.unusable === 1, JSON.stringify(two.stats));
  check("only the clean row is mailed", two.recipients.join(",") === "al@x.com", two.recipients.join(","));

  /* The SAME address twice is not ambiguity, it is someone who answered the same
     thing twice — which is common when a form asks for contact details more than
     once, and commoner still when it asks them to confirm. Treating it as ambiguous
     would drop a person for being consistent. Note the second row's two cells differ
     in case, which is exactly how a confirmation field gets filled in. */
  const same = cleanList(
    [
      "Timestamp,Email Address,Confirm contact,Second confirmation",
      "1,al@x.com,al@x.com,al@x.com",
      "2,yes,bo@y.com,BO@Y.COM",
    ].join("\n"),
  );
  check("two cells holding the same address still recovers", same.stats.recovered === 1, JSON.stringify(same.stats));
  check("differing case counts as the same address", same.stats.ambiguous === 0, JSON.stringify(same.stats));
  check("both people are mailed", same.recipients.join(",") === "al@x.com,bo@y.com", same.recipients.join(","));

  /* A free-text answer that merely mentions an address is not the registrant's, and
     is very often a support address they were told to contact. */
  const mention = cleanList(
    [
      "Timestamp,Email Address,Anything else?",
      "1,al@x.com,nothing",
      "2,yes,write to support@vendor.io if stuck",
    ].join("\n"),
  );
  check("a mentioned address is not recovered", mention.stats.recovered === 0, JSON.stringify(mention.stats));
  check("that row is unusable", mention.stats.unusable === 1, JSON.stringify(mention.stats));
  check("the clean row is untouched", mention.recipients.join(",") === "al@x.com", mention.recipients.join(","));
}

console.log("\n— deduplication runs after recovery, not before —");
{
  /*
   * This ordering is not stylistic. In the real export one recovered address turned
   * out to duplicate a row already collected — deduplicating first would have let it
   * through as a second copy, and mailing one person their code twice is a
   * complaint, measured against the domain the app runs on.
   */
  const csv = [
    "Timestamp,Username,Email Address",
    "1,x,grace@kaleido-test.xyz",
    "2,grace@kaleido-test.xyz,yes",
  ].join("\n");
  const out = cleanList(csv);
  check("the recovered duplicate is recognised", out.stats.duplicate === 1, JSON.stringify(out.stats));
  check("it is still counted as recovered", out.stats.recovered === 1, JSON.stringify(out.stats));
  check("the person is mailed once", out.recipients.length === 1, out.recipients.join(","));
}

console.log("\n— the rest of the cleaning rules —");
{
  const csv = [
    "Timestamp,Name,Email Address,Chain",
    "1,Alice,  Alice@Example.COM  ,Base",
    "2,Dup,alice@example.com,Sepolia",
    "3,UpperDup,ALICE@EXAMPLE.COM,Base",
    "4,Role,info@company.com,BSC",
    "5,Plus,carol+tag@gmail.com,Base",
    "6,Broken,not-an-email,Sepolia",
    "7,Fine,grace@kaleido-test.xyz,Arc",
  ].join("\n");
  const out = cleanList(csv);
  check("counts data rows, not lines", out.stats.rows === 7, JSON.stringify(out.stats));
  check("lower-cases and trims", out.recipients[0] === "alice@example.com", out.recipients[0]);
  check("catches both duplicates", out.stats.duplicate === 2, JSON.stringify(out.stats));
  check("drops the role address", out.stats.role === 1, JSON.stringify(out.stats));
  check("keeps plus-addressing intact", out.recipients.includes("carol+tag@gmail.com"), out.recipients.join(","));
  check("the unreachable row is unusable", out.stats.unusable === 1, JSON.stringify(out.stats));
  check("mails three people", out.recipients.length === 3, out.recipients.join(","));

  /* Every row is accounted for exactly once. Without this it is possible for a rule
     to both drop a row and count it elsewhere, which reads as a clean run against a
     total that no longer adds up. */
  const { rows, unusable, role, duplicate } = out.stats;
  check(
    "the counts account for every row",
    out.recipients.length + unusable + role + duplicate === rows,
    `${out.recipients.length}+${unusable}+${role}+${duplicate} != ${rows}`,
  );
}

console.log("\n— order is stable, because the send resumes on it —");
{
  /*
   * The sender walks the list in order, writes each success to a state file, and
   * `--limit` sends a prefix. A different order between runs would re-mail some
   * people and skip others — the state file only protects against re-sending an
   * address it has already recorded, not against an order that shuffles.
   */
  const csv = "Timestamp,Email Address\n1,cy@z.com\n2,al@x.com\n3,bo@y.com";
  const once = cleanList(csv).recipients;
  const twice = cleanList(csv).recipients;
  check("first-seen order is kept, not sorted", once.join(",") === "cy@z.com,al@x.com,bo@y.com", once.join(","));
  check("the same input gives the same order", once.join(",") === twice.join(","), twice.join(","));
}

console.log("\n— the shape of the real export, reproduced —");
{
  /*
   * The export cannot be committed, so this rebuilds its proportions from the
   * measured breakdown: mostly clean gmail.com rows, a run of duplicates, a run
   * whose address is one column over, and the handful of typo'd-but-valid domains
   * that are deliberately left alone to bounce rather than being "corrected" into
   * someone else's mailbox.
   */
  const lines = ["Timestamp,Username,X Username,Email Address,Experience"];
  for (let i = 0; i < 100; i++) lines.push(`${i},user${i},@user${i},user${i}@gmail.com,pro`);
  for (let i = 0; i < 10; i++) lines.push(`d${i},user${i},@user${i},USER${i}@GMAIL.COM,pro`);
  for (let i = 0; i < 5; i++) lines.push(`r${i},recovered${i}@gmail.com,@r${i},yes,pro`);
  for (const typo of ["gmail.con", "gmail.copm", "ggmail.com"]) {
    lines.push(`t,typo,@typo,person@${typo},pro`);
  }
  const out = cleanList(lines.join("\n"));

  check("the clean rows all survive", out.stats.rows === 118, JSON.stringify(out.stats));
  check("the duplicate run is caught", out.stats.duplicate === 10, JSON.stringify(out.stats));
  check("the wrong-column run is recovered", out.stats.recovered === 5, JSON.stringify(out.stats));
  check("nobody is unusable", out.stats.unusable === 0, JSON.stringify(out.stats));
  check("the recipient count adds up", out.recipients.length === 108, String(out.recipients.length));
  /* Left alone on purpose. Correcting an address means mailing someone who did not
     enter it, and the near-misses of gmail.com include domains that genuinely
     exist — gmail.co is Colombia and mail.com is a real provider — so the rule that
     fixes the obvious typos also breaks the legitimate addresses. In the real export
     that is six addresses out of 3,077, or 0.2%, far under the 5% that stops a send. */
  check(
    "a typo'd but valid domain is kept, not corrected",
    out.recipients.filter((a) => a.endsWith("@gmail.con") || a.endsWith("@gmail.copm") || a.endsWith("@ggmail.com"))
      .length === 3,
    out.recipients.slice(-4).join(","),
  );
  /* 100 clean rows plus the 5 recovered ones, all of which genuinely were
     gmail.com. If a "helpful" correction were ever added, this count would rise to
     include the three typo'd domains and the check above would drop to zero. */
  check(
    "the gmail.com count is exactly the rows that had gmail.com",
    out.recipients.filter((a) => a.endsWith("@gmail.com")).length === 105,
    String(out.recipients.filter((a) => a.endsWith("@gmail.com")).length),
  );
}

console.log("\n— refusals —");
{
  throws("a header with no rows", () => cleanList("Name,Email Address"), "no data rows");
  throws("an empty file", () => cleanList(""), "no data rows");
  /* Distinct from the above, and worth a distinct message: the file has rows, they
     just contain nothing mailable. Silently returning an empty list here would look
     exactly like a successful run against a list of nobody. */
  throws(
    "a file with rows but no addresses at all",
    () => cleanList("Name,Chain\nAl,Base\nBo,Sepolia"),
    "looks like email addresses",
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
