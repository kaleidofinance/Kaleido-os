// Adversarial checks on the command grammar. Run with plain node — no test
// runner in this repo, and no runtime imports here, same as accrual.test.ts.
//
// The bias under test is deliberate: this parser guards money, so every
// ambiguous case must fall through to "unknown" (escalate to a model) or
// "incomplete" (ask the user). Silently guessing an amount or a token is the
// one outcome that must never happen.
import {
  parseCommand,
  parseFollowUp,
  fillSlot,
  completeDraft,
  draftFromCommand,
  clearSlot,
} from "./fromCommand.ts";

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

const TOKENS = [
  {
    address: "0xkld",
    name: "Kaleido",
    symbol: "KLD",
    decimals: 18,
    chainId: 11124,
  },
  {
    address: "0xusdc",
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    chainId: 11124,
    tags: ["stablecoin"],
  },
  {
    address: "0xweth",
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    chainId: 11124,
  },
  {
    address: "0xkfusd",
    name: "Kaleido USD",
    symbol: "kfUSD",
    decimals: 18,
    chainId: 11124,
    tags: ["stablecoin"],
  },
];

const p = (text) => parseCommand(text, TOKENS);

console.log("\n— swap, stated plainly —");
{
  const r = p("swap 500 USDC to KLD");
  check(
    "parses a full swap",
    r.status === "ok" && r.command.kind === "swap",
    r.status,
  );
  check(
    "keeps the amount exact",
    r.status === "ok" && r.command.amount === "500",
    r.status === "ok" ? r.command.amount : "",
  );
  check(
    "assigns sides correctly",
    r.status === "ok" &&
      r.command.tokenIn.symbol === "USDC" &&
      r.command.tokenOut.symbol === "KLD",
  );
}

console.log("\n— wording the user actually types —");
check("verb synonym: convert", p("convert 10 weth into kld").status === "ok");
check("verb synonym: trade", p("trade 1 kld for usdc").status === "ok");
check("case insensitive", p("SWAP 5 Usdc TO Kld").status === "ok");
check("separator 'for'", p("swap 5 usdc for kld").status === "ok");
check("positional, no separator", p("swap 5 usdc kld").status === "ok");
check("token by full name", p("swap 5 usd coin to kaleido").status === "ok");

console.log("\n— number formats —");
{
  const k = p("swap 1k usdc to kld");
  check(
    "1k expands to 1000",
    k.status === "ok" && k.command.amount === "1000",
    k.status === "ok" ? k.command.amount : "",
  );
  const comma = p("swap 1,500 usdc to kld");
  check(
    "strips thousands comma",
    comma.status === "ok" && comma.command.amount === "1500",
    comma.status === "ok" ? comma.command.amount : "",
  );
  const dec = p("swap 0.5 weth to kld");
  check(
    "keeps decimals",
    dec.status === "ok" && dec.command.amount === "0.5",
    dec.status === "ok" ? dec.command.amount : "",
  );
  const m = p("swap 2.5m usdc to kld");
  check(
    "2.5m expands, no exponent",
    m.status === "ok" && m.command.amount === "2500000",
    m.status === "ok" ? m.command.amount : "",
  );
}
{
  /*
   * The amounts a double cannot hold. 0.5 above passes either way — it is a
   * power of two — which is why the float round-trip in parseAmount survived
   * this section for as long as it did: `Number("0.1").toFixed(18)` is
   * "0.100000000000000006" and `Number("0.3").toFixed(18)` is
   * "0.299999999999999989". On an 18-decimal token that is a few wei off what
   * was typed and unreadable on the confirmation row; on a 6-decimal one the
   * builder refuses the send outright, quoting a number the user never entered.
   *
   * So every check here compares against the exact string. A tenth is the most
   * ordinary amount a person types, and it must survive the parser unchanged.
   */
  const tenth = p("swap 0.1 weth to kld");
  check(
    "a tenth is exactly a tenth",
    tenth.status === "ok" && tenth.command.amount === "0.1",
    tenth.status === "ok" ? tenth.command.amount : tenth.status,
  );
  const third = p("swap 0.3 weth to kld");
  check(
    "0.3 does not round down to 0.2999…",
    third.status === "ok" && third.command.amount === "0.3",
    third.status === "ok" ? third.command.amount : third.status,
  );
  const mixed = p("swap 1.1 weth to kld");
  check(
    "1.1 keeps both digits and nothing else",
    mixed.status === "ok" && mixed.command.amount === "1.1",
    mixed.status === "ok" ? mixed.command.amount : mixed.status,
  );
  /* The suffix shifts the point rather than multiplying, so a fraction smaller
     than the shift borrows from its own digits instead of from a float. */
  const small = p("swap 0.0001k usdc to kld");
  check(
    "0.0001k is 0.1, not 0.10000000000000000555",
    small.status === "ok" && small.command.amount === "0.1",
    small.status === "ok" ? small.command.amount : small.status,
  );
  const trailing = p("swap 1.50 usdc to kld");
  check(
    "a trailing zero is trimmed, not kept as precision",
    trailing.status === "ok" && trailing.command.amount === "1.5",
    trailing.status === "ok" ? trailing.command.amount : trailing.status,
  );
  /* Above 1e21 `toFixed` itself returns exponent notation, which parseUnits
     rejects — the hazard the old implementation's comment named and only
     partly avoided. With no float in the function there is nothing to format. */
  const huge = p("swap 1000000000000000000000 usdc to kld");
  check(
    "a 22-digit amount stays in full decimal form",
    huge.status === "ok" && huge.command.amount === "1000000000000000000000",
    huge.status === "ok" ? huge.command.amount : huge.status,
  );
  check(
    "zero written as a scaled fraction is still not an amount",
    p("swap 0.000k usdc to kld").status === "incomplete",
    p("swap 0.000k usdc to kld").status,
  );
}

console.log("\n— refuses to guess —");
check("zero is not an amount", p("swap 0 usdc to kld").status === "incomplete");
check(
  "negative is not an amount",
  p("swap -5 usdc to kld").status === "incomplete",
);
check(
  "same token both sides is rejected",
  p("swap 5 usdc to usdc").status === "unknown",
);
check(
  "unknown token does not resolve",
  p("swap 5 doge to kld").status === "incomplete",
);
check(
  "a question is not a command",
  p("what is my health factor?").status === "unknown",
);
check("bare chatter escalates", p("hey luca").status === "unknown");
check("empty input escalates", p("   ").status === "unknown");

console.log("\n— asks instead of escalating —");
{
  const r = p("swap 500 usdc");
  check(
    "missing output token asks",
    r.status === "incomplete" && r.missing === "tokenOut",
    r.status,
  );
  check(
    "keeps what it already knows",
    r.status === "incomplete" &&
      r.draft.tokenIn.symbol === "USDC" &&
      r.draft.amount === "500",
  );

  const filled = fillSlot(r.draft, r.missing, "kld", TOKENS);
  check(
    "a bare reply completes it",
    filled.status === "ok" && filled.command.kind === "swap",
    filled.status,
  );
  check(
    "completed swap is intact",
    filled.status === "ok" &&
      filled.command.amount === "500" &&
      filled.command.tokenOut.symbol === "KLD",
  );

  const noAmount = p("swap usdc to kld");
  check(
    "missing amount asks",
    noAmount.status === "incomplete" && noAmount.missing === "amount",
    noAmount.missing,
  );
  const amountFilled = fillSlot(
    noAmount.draft,
    noAmount.missing,
    "250",
    TOKENS,
  );
  check(
    "amount reply completes it",
    amountFilled.status === "ok" && amountFilled.command.amount === "250",
  );
}

console.log("\n— slot filling does not accept nonsense —");
{
  const r = p("swap 500 usdc");
  const bad = fillSlot(r.draft, r.missing, "banana", TOKENS);
  check(
    "junk keeps asking, never guesses",
    bad.status === "incomplete" && bad.missing === "tokenOut",
    bad.status,
  );
  const badAmount = fillSlot({ kind: "stake" }, "amount", "lots", TOKENS);
  check("non-numeric amount keeps asking", badAmount.status === "incomplete");
}

console.log("\n— stake and approve —");
{
  const st = p("stake 100");
  check(
    "stake with amount",
    st.status === "ok" &&
      st.command.kind === "stake" &&
      st.command.amount === "100",
    st.status,
  );
  check("stake without amount asks", p("stake").status === "incomplete");

  const ap = p("approve 500 usdc");
  check(
    "approve with both slots",
    ap.status === "ok" && ap.command.kind === "approve",
    ap.status,
  );
  check(
    "approve without amount asks",
    p("approve usdc").status === "incomplete",
  );
  check("approve without token asks", p("approve").status === "incomplete");
}

console.log("\n— help —");
check(
  "help is local",
  p("help").status === "ok" && p("help").command.kind === "help",
);
check("commands is local", p("commands").status === "ok");

console.log("\n— receive —");
{
  // Matched as a leading phrase, not scanned for anywhere in the string. Both
  // halves of that are load-bearing and both are checked below.
  for (const phrase of [
    "receive",
    "deposit address",
    "my address",
    "wallet address",
    "qr code",
  ]) {
    const r = p(phrase);
    check(
      `"${phrase}" opens receive`,
      r.status === "ok" && r.command.kind === "receive",
      r.status,
    );
  }
  check(
    "trailing '?' still resolves",
    p("my wallet address?").status === "ok" &&
      p("my wallet address?").command.kind === "receive",
  );

  // The collision that made "receive" the command word instead of "deposit":
  // `deposit` is the lending verb and stays one. Only the *address* phrasing
  // is claimed, and it is claimed ahead of verb detection so it wins there.
  const collateral = p("deposit 500 usdc");
  check(
    "'deposit 500 usdc' is still lending collateral, not receive",
    collateral.status === "ok" && collateral.command.kind === "deposit",
    collateral.status,
  );

  // "receive" is ordinary trading English. A `words.some(...)` scan — which is
  // how the zero-slot verbs match — would eat every one of these.
  for (const question of [
    "how much kld will i receive",
    "what token do i receive",
    "received 500 usdc from alice",
    "will i receive fees on this position",
  ]) {
    const r = p(question);
    check(
      `"${question}" is not a receive command`,
      r.status !== "ok" || r.command.kind !== "receive",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }
}

console.log("\n— send: the one slot with no forgiving failure mode —");
{
  /*
   * A mixed-case address, and it must come back out character for character.
   *
   * EIP-55 encodes the checksum in the capitalisation of the hex digits, and
   * `ethers.getAddress()` verifies it only for mixed-case input — an
   * all-lowercase address is accepted with nothing left to check. So the parser
   * lowercases the word array to find the address and reads the value from the
   * raw text, and this constant is what proves it: compare `to` against the
   * exact string, never a lowercased one, or the assertion stops meaning
   * anything the moment a `.toLowerCase()` creeps in.
   */
  const TO = "0x5A3c9F1e8b7d64A209Fe3B18c7d05E4A6f2B91D3";

  const r = p(`send 50 usdc to ${TO}`);
  check(
    "parses a full send",
    r.status === "ok" && r.command.kind === "send",
    r.status,
  );
  check(
    "amount and token bind correctly",
    r.status === "ok" &&
      r.command.amount === "50" &&
      r.command.token.symbol === "USDC",
    r.status === "ok" ? `${r.command.amount}/${r.command.token.symbol}` : "",
  );
  check(
    "the recipient's case survives the parser",
    r.status === "ok" && r.command.to === TO,
    r.status === "ok" ? r.command.to : r.status,
  );

  check("verb synonym: transfer", p(`transfer 5 kld to ${TO}`).status === "ok");

  // Some tools emit `0X`. The prefix is checksum-neutral — EIP-55 hashes the 40
  // digits alone — so it is folded, and only it.
  const upperPrefix = p(`send 50 usdc to 0X${TO.slice(2)}`);
  check(
    "an uppercase 0X prefix is normalised, the digits are not",
    upperPrefix.status === "ok" && upperPrefix.command.to === TO,
    upperPrefix.status === "ok" ? upperPrefix.command.to : upperPrefix.status,
  );

  // normalise() keeps `.` and `,` because amounts need them, so punctuation
  // stays glued to the address and has to be stripped off the value.
  const trailing = p(`send 50 usdc to ${TO}.`);
  check(
    "trailing punctuation is not part of the address",
    trailing.status === "ok" && trailing.command.to === TO,
    trailing.status === "ok" ? trailing.command.to : trailing.status,
  );

  // The truncation trap. A 41-digit run must match nothing rather than resolve
  // to its first 40 digits, which would be a different address than the one
  // typed — and one the user would have no reason to doubt.
  const tooLong = p(`send 50 usdc to ${TO}f`);
  check(
    "an over-long hex run is not truncated to an address",
    tooLong.status === "incomplete" && tooLong.missing === "recipient",
    tooLong.status === "ok" ? tooLong.command.to : tooLong.status,
  );
  const tooShort = p(`send 50 usdc to ${TO.slice(0, -1)}`);
  check(
    "a 39-digit address is not an address",
    tooShort.status === "incomplete" && tooShort.missing === "recipient",
    tooShort.status,
  );
}

console.log("\n— send asks for one slot at a time, address last —");
{
  const TO = "0x5A3c9F1e8b7d64A209Fe3B18c7d05E4A6f2B91D3";

  const noTo = p("send 50 usdc");
  check(
    "missing recipient asks",
    noTo.status === "incomplete" && noTo.missing === "recipient",
    noTo.missing,
  );
  const answered = fillSlot(noTo.draft, noTo.missing, TO, TOKENS);
  check(
    "an address reply completes it",
    answered.status === "ok" && answered.command.kind === "send",
    answered.status,
  );
  check(
    "the reply's case survives fillSlot",
    answered.status === "ok" && answered.command.to === TO,
    answered.status === "ok" ? answered.command.to : answered.status,
  );
  const junk = fillSlot(noTo.draft, noTo.missing, "my other wallet", TOKENS);
  check(
    "a described recipient keeps asking, never guesses",
    junk.status === "incomplete" && junk.missing === "recipient",
    junk.status,
  );
  const twoInReply = fillSlot(
    noTo.draft,
    noTo.missing,
    `${TO} and 0x1111111111111111111111111111111111111111`,
    TOKENS,
  );
  check(
    "two addresses in a reply keeps asking",
    twoInReply.status === "incomplete" && twoInReply.missing === "recipient",
    twoInReply.status,
  );

  // Token first, then amount, then the address — so the question that carries
  // the least forgiving answer is the one asked with the amount already stated.
  const noAmount = p(`send usdc to ${TO}`);
  check(
    "missing amount asks for the amount",
    noAmount.status === "incomplete" && noAmount.missing === "amount",
    noAmount.missing,
  );
  const noToken = p(`send 50 to ${TO}`);
  check(
    "missing token asks for the token",
    noToken.status === "incomplete" && noToken.missing === "token",
    noToken.missing,
  );

  // Two destinations is a contradiction, not an under-specified command: there
  // is no slot to ask for, so it starts over rather than picking one.
  const two = p(
    `send 50 usdc to ${TO} and 0x1111111111111111111111111111111111111111`,
  );
  check(
    "two recipients escalates rather than choosing",
    two.status === "unknown",
    two.status,
  );
}

console.log("\n— send does not collide with receive, or with repayment —");
{
  const TO = "0x5A3c9F1e8b7d64A209Fe3B18c7d05E4A6f2B91D3";

  // Both directions of the collision. RECEIVE_PHRASES claims the *address*
  // phrasings ahead of verb detection, and a send names an address too.
  const outgoing = p(`send 50 usdc to ${TO}`);
  check(
    "a send is not read as a receive",
    outgoing.status === "ok" && outgoing.command.kind === "send",
    outgoing.status === "ok" ? outgoing.command.kind : outgoing.status,
  );
  check(
    "'my wallet address' is still receive",
    p("my wallet address").status === "ok" &&
      p("my wallet address").command.kind === "receive",
  );
  // A leading phrase, not a scan — so "address" inside a send sentence does not
  // turn the send into a request for the user's own address.
  const mixed = p("send my address to alice");
  check(
    "'send my address to alice' is not a receive command",
    mixed.status !== "ok" || mixed.command.kind !== "receive",
    mixed.status === "ok" ? mixed.command.kind : mixed.status,
  );

  /* "pay" is deliberately NOT a send synonym, though it is the obvious third
     one. "pay back my loan" and "pay off my loan" are repayments, and this
     parser's own rule is that a near miss on a money verb escalates to the
     model rather than resolving to the closest guess. A send is said with
     "send" or "transfer". */
  const payLoan = p("pay back my loan");
  check(
    "'pay back my loan' is not a send",
    payLoan.status !== "ok" || payLoan.command.kind !== "send",
    payLoan.status === "ok" ? payLoan.command.kind : payLoan.status,
  );
  const payTo = p(`pay 50 usdc to ${TO}`);
  check(
    "'pay' does not resolve as a send verb at all",
    payTo.status !== "ok" || payTo.command.kind !== "send",
    payTo.status === "ok" ? payTo.command.kind : payTo.status,
  );
}

console.log("\n— borrow and lend: three numbers, three roles —");
{
  const b = p("borrow 500 usdc at 8% for 30 days");
  check(
    "parses a full borrow",
    b.status === "ok" && b.command.kind === "borrow",
    b.status,
  );
  check(
    "amount is not the rate",
    b.status === "ok" && b.command.amount === "500",
    b.status === "ok" ? b.command.amount : "",
  );
  check(
    "rate read correctly",
    b.status === "ok" && b.command.interestPct === 8,
    b.status === "ok" ? String(b.command.interestPct) : "",
  );
  check(
    "term read correctly",
    b.status === "ok" && b.command.days === 30,
    b.status === "ok" ? String(b.command.days) : "",
  );

  const l = p("lend 1000 usdc at 10% for 2 months");
  check(
    "months convert to days",
    l.status === "ok" && l.command.days === 60,
    l.status === "ok" ? String(l.command.days) : "",
  );
  check(
    "lend keeps its amount",
    l.status === "ok" && l.command.amount === "1000",
  );

  const weeks = p("borrow 5 weth at 4% for 3 weeks");
  check(
    "weeks convert to days",
    weeks.status === "ok" && weeks.command.days === 21,
    weeks.status === "ok" ? String(weeks.command.days) : "",
  );

  const bare = p("borrow 500 usdc at 8 for 30 days");
  check(
    "rate without a percent sign",
    bare.status === "ok" && bare.command.interestPct === 8,
    bare.status,
  );

  // The ordering trap: without role-first extraction the amount would bind to
  // whichever number came first.
  const rateFirst = p("borrow at 8% 500 usdc for 30 days");
  check(
    "rate before amount still binds right",
    rateFirst.status === "ok" &&
      rateFirst.command.amount === "500" &&
      rateFirst.command.interestPct === 8,
    rateFirst.status,
  );
}

console.log("\n— borrow asks for what's missing, one slot at a time —");
{
  const noRate = p("borrow 500 usdc for 30 days");
  check(
    "missing rate asks",
    noRate.status === "incomplete" && noRate.missing === "rate",
    noRate.missing,
  );
  const withRate = fillSlot(noRate.draft, noRate.missing, "8", TOKENS);
  check(
    "bare number answers the rate",
    withRate.status === "ok" && withRate.command.interestPct === 8,
    withRate.status,
  );

  const noTerm = p("borrow 500 usdc at 8%");
  check(
    "missing term asks",
    noTerm.status === "incomplete" && noTerm.missing === "days",
    noTerm.missing,
  );
  const withTerm = fillSlot(noTerm.draft, noTerm.missing, "45", TOKENS);
  check(
    "bare number answers the term",
    withTerm.status === "ok" && withTerm.command.days === 45,
    withTerm.status,
  );
  const withUnit = fillSlot(noTerm.draft, noTerm.missing, "2 weeks", TOKENS);
  check(
    "unit answer also works",
    withUnit.status === "ok" && withUnit.command.days === 14,
    withUnit.status,
  );

  check(
    "bare borrow asks for token first",
    p("borrow").status === "incomplete",
  );
}

console.log("\n— collateral —");
{
  const d = p("deposit 500 usdc");
  check(
    "deposit parses",
    d.status === "ok" &&
      d.command.kind === "deposit" &&
      d.command.amount === "500",
    d.status,
  );
  const w = p("withdraw 200 usdc");
  check(
    "withdraw parses",
    w.status === "ok" && w.command.kind === "withdraw",
    w.status,
  );
  check("deposit without token asks", p("deposit 500").status === "incomplete");
}

console.log("\n— repay —");
{
  const bare = p("repay");
  check(
    "bare repay is valid",
    bare.status === "ok" && bare.command.kind === "repay",
    bare.status,
  );
  check(
    "bare repay names no loan",
    bare.status === "ok" && bare.command.loanId === undefined,
  );
  const byId = p("repay 3");
  check(
    "repay with an id",
    byId.status === "ok" && byId.command.loanId === 3,
    byId.status === "ok" ? String(byId.command.loanId) : "",
  );
}

console.log("\n— marketplace references —");
{
  const c = p("cancel listing 3");
  check(
    "cancel a listing",
    c.status === "ok" &&
      c.command.kind === "cancel" &&
      c.command.target === "listing" &&
      c.command.id === 3,
    c.status,
  );
  const cr = p("cancel request 7");
  check(
    "cancel a request",
    cr.status === "ok" &&
      cr.command.target === "request" &&
      cr.command.id === 7,
    cr.status,
  );
  check("hash-prefixed ids read", p("cancel listing #12").status === "ok");

  // Cancelling the wrong side of the book is unrecoverable, so a bare id must
  // not be assumed to mean either one.
  const bare = p("cancel 3");
  check(
    "bare cancel refuses to assume a side",
    bare.status === "incomplete" && bare.missing === "ref",
    bare.status,
  );
  const answered = fillSlot(bare.draft, "ref", "listing 3", TOKENS);
  check(
    "naming the side completes it",
    answered.status === "ok" &&
      answered.command.kind === "cancel" &&
      answered.command.target === "listing",
    answered.status,
  );
  const stillBare = fillSlot(bare.draft, "ref", "3", TOKENS);
  check(
    "a bare id alone still refuses",
    stillBare.status === "incomplete",
    stillBare.status,
  );

  const noId = p("cancel listing");
  check(
    "side without an id asks",
    noId.status === "incomplete" && noId.missing === "ref",
    noId.status,
  );
  const idGiven = fillSlot(noId.draft, "ref", "9", TOKENS);
  check(
    "bare id lands once the side is known",
    idGiven.status === "ok" && idGiven.command.id === 9,
    idGiven.status,
  );
}

console.log("\n— a reference changes what a verb means —");
{
  // "borrow ... at X% for N days" posts a new request; "borrow ... from
  // listing N" draws against an existing one. The noun decides.
  const post = p("borrow 500 usdc at 8% for 30 days");
  check(
    "no reference means post a request",
    post.status === "ok" && post.command.kind === "borrow",
    post.status,
  );

  const draw = p("borrow 500 from listing 3");
  check(
    "a reference means draw from it",
    draw.status === "ok" && draw.command.kind === "takeListing",
    draw.status,
  );
  check(
    "listing id is not the amount",
    draw.status === "ok" &&
      draw.command.amount === "500" &&
      draw.command.listingId === 3,
    draw.status === "ok"
      ? `${draw.command.amount}/${draw.command.listingId}`
      : "",
  );

  const take = p("take 250 from listing 8");
  check(
    "'take' also draws",
    take.status === "ok" &&
      take.command.kind === "takeListing" &&
      take.command.amount === "250",
    take.status,
  );

  const fill = p("fill request 4");
  check(
    "'fill' funds a request",
    fill.status === "ok" &&
      fill.command.kind === "fillRequest" &&
      fill.command.requestId === 4,
    fill.status,
  );
  const lendTo = p("lend to request 11");
  check(
    "'lend to request N' funds it",
    lendTo.status === "ok" &&
      lendTo.command.kind === "fillRequest" &&
      lendTo.command.requestId === 11,
    lendTo.status,
  );

  const noAmount = p("take from listing 5");
  check(
    "drawing without an amount asks",
    noAmount.status === "incomplete" && noAmount.missing === "amount",
    noAmount.status,
  );
}

console.log("\n— stablecoin: mint, redeem —");
{
  const m = p("mint 500 usdc");
  check(
    "mint parses",
    m.status === "ok" &&
      m.command.kind === "mint" &&
      m.command.amount === "500" &&
      m.command.token.symbol === "USDC",
    m.status,
  );
  check("mint without token asks", p("mint 500").status === "incomplete");
  const r = p("redeem 500 kfusd");
  check(
    "redeem parses",
    r.status === "ok" &&
      r.command.kind === "redeem" &&
      r.command.token.symbol === "kfUSD",
    r.status,
  );
}

console.log("\n— stablecoin: lock, unlock (amount only, no ambiguity) —");
{
  const lock = p("lock 500");
  check(
    "lock parses with amount only",
    lock.status === "ok" &&
      lock.command.kind === "lock" &&
      lock.command.amount === "500",
    lock.status,
  );
  check("lock without amount asks", p("lock").status === "incomplete");
  const unlock = p("unlock 200");
  check(
    "unlock parses",
    unlock.status === "ok" &&
      unlock.command.kind === "unlock" &&
      unlock.command.amount === "200",
    unlock.status,
  );

  // The real hazard this was built to avoid: "deposit"/"withdraw" already mean
  // lending collateral, and kfUSD is a valid lending currency too. "lock"/
  // "unlock" must never collide with that path.
  const depositKfusd = p("deposit 500 kfusd");
  check(
    "deposit still means lending collateral, not the vault",
    depositKfusd.status === "ok" && depositKfusd.command.kind === "deposit",
    depositKfusd.status,
  );
}

console.log("\n— stablecoin: complete withdrawal, claim, compound —");
{
  const cw = p("complete withdrawal to usdc");
  check(
    "complete withdrawal parses",
    cw.status === "ok" &&
      cw.command.kind === "completeWithdrawal" &&
      cw.command.token.symbol === "USDC",
    cw.status,
  );
  /* The parser reports the token the user named even though only kfUSD can be
     paid out — buildIntents refuses the rest with an explanation. Re-asking
     here would only collect a second wrong answer. */
  const noToken = p("complete withdrawal");
  check(
    "complete without a token defaults to kfUSD rather than asking",
    noToken.status === "ok" &&
      noToken.command.kind === "completeWithdrawal" &&
      noToken.command.token.symbol === "kfUSD",
    noToken.status,
  );

  const claim = p("claim yield");
  check(
    "claim yield is zero-slot",
    claim.status === "ok" && claim.command.kind === "claimYield",
    claim.status,
  );
  const compound = p("compound yield");
  check(
    "compound yield is zero-slot",
    compound.status === "ok" && compound.command.kind === "compoundYield",
    compound.status,
  );

  // Zero-slot verbs must not swallow words that happen to contain them, or a
  // sentence that only mentions "claim" in passing would misfire.
  const bare = p("claim");
  check(
    "bare 'claim' still resolves (no slot to miss)",
    bare.status === "ok" && bare.command.kind === "claimYield",
  );

  // "claim" is also the plain word for points, staking rewards, an airdrop —
  // none of them the kfUSD yield claim. A claim that names one escalates rather
  // than planning a yield claim from a sentence about a different product.
  for (const sentence of [
    "claim my points",
    "claim my rewards",
    "claim my staking rewards",
    "claim my airdrop",
    "claim my referral rewards",
    "claim my season points",
  ]) {
    const r = p(sentence);
    check(
      `"${sentence}" is not a kfUSD yield claim`,
      r.status === "unknown",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }
  // And the yield claim itself is untouched: unqualified, or naming "yield".
  check(
    "'claim my yield' is still the kfUSD claim",
    (() => {
      const r = p("claim my yield");
      return r.status === "ok" && r.command.kind === "claimYield";
    })(),
  );
}

console.log("\n— the testnet faucet —");
{
  /* Two ways to name the asset, and the order between them is the point. The
     word right after "faucet" wins outright, because the faucet's own list is
     the authority on what it stocks and it may hold assets this registry has
     never carried — USDC is missing from two of the five chains' registries,
     which is the whole reason FaucetAssetRef exists. Only when that finds
     nothing does the rest of the sentence get read, and then only for words the
     registry resolves or the three batch words. */
  const adjacent = p("faucet usdc");
  check(
    "the word after 'faucet' is the asset",
    adjacent.status === "ok" &&
      adjacent.command.kind === "claimTestTokens" &&
      adjacent.command.symbol === "usdc",
    JSON.stringify(adjacent),
  );

  const unlisted = p("faucet zzz");
  check(
    "an asset the registry has never heard of still reaches the planner",
    unlisted.status === "ok" &&
      unlisted.command.kind === "claimTestTokens" &&
      unlisted.command.symbol === "zzz",
    JSON.stringify(unlisted),
  );

  /* The phrasing people actually type. This used to arrive with no asset named
     and come back as "the faucet lists USDC, USDT — say which one you want",
     which is the one refusal in this grammar that reads as the agent not being
     able to read its own input. */
  const natural = p("claim USDC from the faucet");
  check(
    "a ticker named anywhere in the sentence is found",
    natural.status === "ok" &&
      natural.command.kind === "claimTestTokens" &&
      natural.command.symbol === "USDC",
    JSON.stringify(natural),
  );

  const batch = p("claim everything from the faucet");
  check(
    "'everything' is carried through for the planner's batch branch",
    batch.status === "ok" &&
      batch.command.kind === "claimTestTokens" &&
      batch.command.symbol === "everything",
    JSON.stringify(batch),
  );

  // A registry match beats a batch word, so this claims USDC and not the lot.
  const both = p("claim all my USDC from the faucet");
  check(
    "a named asset outranks 'all' in the same sentence",
    both.status === "ok" &&
      both.command.kind === "claimTestTokens" &&
      both.command.symbol === "USDC",
    JSON.stringify(both),
  );

  /* Naming nothing must stay naming nothing. The fallback is allowed to find a
     ticker or a batch word and nothing else — no stopword list, no positional
     guess — so these two still reach the planner empty and get asked. */
  const nothing = p("claim from the faucet");
  check(
    "a sentence with no asset in it still names none",
    nothing.status === "ok" &&
      nothing.command.kind === "claimTestTokens" &&
      nothing.command.symbol === undefined,
    JSON.stringify(nothing),
  );
  const filler = p("faucet please");
  check(
    "a filler after 'faucet' is not read as a ticker",
    filler.status === "ok" &&
      filler.command.kind === "claimTestTokens" &&
      filler.command.symbol === undefined,
    JSON.stringify(filler),
  );

  /* The reason the faucet is checked ahead of the zero-slot verbs: every
     sentence above contains "claim", and ZERO_SLOT_VERBS scans the whole
     sentence, so without that ordering each one would have planned a kfUSD
     yield claim — the wrong product, from a sentence naming this one. */
  check(
    "'claim … faucet' is never hijacked by claimYield",
    [natural, batch, both, nothing].every(
      (r) => r.status === "ok" && r.command.kind === "claimTestTokens",
    ),
  );
  // And the reverse: a claim that says nothing about a faucet is untouched.
  const yieldClaim = p("claim");
  check(
    "a bare claim is still the kfUSD one",
    yieldClaim.status === "ok" && yieldClaim.command.kind === "claimYield",
    JSON.stringify(yieldClaim),
  );
}

console.log("\n— pool: collect fees, remove position —");
{
  const collect = p("collect fees position 42");
  check(
    "collect parses",
    collect.status === "ok" &&
      collect.command.kind === "collectFees" &&
      collect.command.positionId === 42,
    collect.status,
  );
  const remove = p("remove liquidity position 7");
  check(
    "remove parses",
    remove.status === "ok" &&
      remove.command.kind === "removePosition" &&
      remove.command.positionId === 7,
    remove.status,
  );
  const bareRemove = p("remove position 7");
  check(
    "shorter phrasing also works",
    bareRemove.status === "ok" && bareRemove.command.kind === "removePosition",
  );

  check(
    "collect without a position id asks",
    p("collect fees").status === "incomplete",
  );
  const filled = fillSlot(
    { kind: "collectFees" },
    "ref",
    "position 42",
    TOKENS,
  );
  check(
    "answering with 'position 42' completes it",
    filled.status === "ok" &&
      filled.command.kind === "collectFees" &&
      filled.command.positionId === 42,
    filled.status,
  );

  // The exact collision that mattered here: "remove" and "cancel" both act on
  // an id, but on different books. A listing/request id must never resolve as
  // a position, and vice versa.
  const wrongNoun = p("remove listing 3");
  check(
    "'remove' with a listing noun is not a position command",
    wrongNoun.status !== "ok" || wrongNoun.command.kind !== "removePosition",
  );
  const cancelPosition = p("cancel position 42");
  check(
    "'cancel position N' is not a valid cancel (positions are removed, not cancelled)",
    cancelPosition.status === "incomplete" && cancelPosition.missing === "ref",
    cancelPosition.status,
  );
  // Same collision, reached the second way: answering a pending cancel's
  // "which one?" with "position 42" instead of typing it up front.
  const pendingCancel = p("cancel");
  const answeredWithPosition = fillSlot(
    pendingCancel.status === "incomplete"
      ? pendingCancel.draft
      : { kind: "cancel" },
    "ref",
    "position 42",
    TOKENS,
  );
  check(
    "filling a pending cancel with 'position 42' still refuses",
    answeredWithPosition.status === "incomplete" &&
      answeredWithPosition.missing === "ref",
    answeredWithPosition.status,
  );
}

console.log("\n— remove a share, not always all of it —");
{
  /* The bug this section pins: "remove 50%" used to parse the 50 (as if it were
     an interest rate) and then drop it, so a half-remove signed away the whole
     position. A share is now carried, or the sentence escalates — it is never
     silently rounded up to all. */
  const half = p("remove 50% of position 7");
  check(
    "a percentage is carried, not dropped",
    half.status === "ok" &&
      half.command.kind === "removePosition" &&
      half.command.percent === 50 &&
      half.command.positionId === 7,
    half.status === "ok" ? String(half.command.percent) : half.status,
  );
  const worded = p("remove 25 percent of position 7");
  check(
    "'N percent' reads the same as 'N%'",
    worded.status === "ok" && worded.command.percent === 25,
    worded.status === "ok" ? String(worded.command.percent) : worded.status,
  );
  const bare = p("remove position 7");
  check(
    "a bare remove still means all of it (no percent carried)",
    bare.status === "ok" &&
      bare.command.kind === "removePosition" &&
      bare.command.percent === undefined,
    bare.status === "ok" ? String(bare.command.percent) : bare.status,
  );
  const hundred = p("remove 100% of position 7");
  check(
    "'100%' is all of it, carried as no percent",
    hundred.status === "ok" && hundred.command.percent === undefined,
    hundred.status === "ok" ? String(hundred.command.percent) : hundred.status,
  );

  /* A share asked for as a WORD is a real signal but not a number this grammar
     will invent — it escalates rather than guessing 50 for "half", and never
     falls back to all. */
  check(
    "'remove half' escalates rather than removing everything",
    p("remove half of position 7").status === "unknown",
    p("remove half of position 7").status,
  );
  check(
    "a nonsense share escalates rather than rounding to all",
    p("remove 0% of position 7").status === "unknown",
    p("remove 0% of position 7").status,
  );
  check(
    "'150%' is not a share, so it just means all of it",
    (() => {
      const r = p("remove 150% of position 7");
      return r.status === "ok" && r.command.percent === undefined;
    })(),
  );

  /* A partial share with no position id can't be held through the "which
     position?" prompt — the answer would drop the share and remove all — so it
     goes to the model, which can find the position and honour the share. */
  check(
    "a partial share with no position id escalates, never prompts",
    p("remove 50% of my KLD/USDC position").status === "unknown",
    p("remove 50% of my KLD/USDC position").status,
  );
  check(
    "a bare remove with no id still just asks which position",
    (() => {
      const r = p("remove my KLD/USDC position");
      return r.status === "incomplete" && r.missing === "ref";
    })(),
  );

  /* collectFees has no partial form — you collect the fees owed, all of them —
     so the share machinery must not touch it. */
  const collect = p("collect fees from position 3");
  check(
    "collectFees is unaffected and carries no percent",
    collect.status === "ok" &&
      collect.command.kind === "collectFees" &&
      collect.command.percent === undefined,
    collect.status,
  );
}

// The one command that is a destination rather than a transaction. The tests
// that matter are the refusals: this branch runs ahead of the verb table, so a
// sentence it takes wrongly is a sentence the correct verb never sees.
console.log("\n— add liquidity: a handoff, not a plan —");
{
  const named = p("add liquidity to KLD/USDC");
  check(
    "'add liquidity to KLD/USDC' opens the form",
    named.status === "ok" && named.command.kind === "openLiquidity",
    named.status,
  );
  check(
    "the pair travels in the order it was named",
    named.status === "ok" &&
      named.command.kind === "openLiquidity" &&
      named.command.token0?.symbol === "KLD" &&
      named.command.token1?.symbol === "USDC",
  );
  check(
    "and no tier unless one was said",
    named.status === "ok" &&
      named.command.kind === "openLiquidity" &&
      named.command.fee === undefined,
  );

  // Every field optional, so the barest form of the request still resolves —
  // this is the case that would otherwise cost a round trip to the model to
  // answer with "which pair?".
  const bare = p("add liquidity");
  check(
    "bare 'add liquidity' is complete, not incomplete",
    bare.status === "ok" && bare.command.kind === "openLiquidity",
    bare.status,
  );
  check(
    "and carries no pair it was not given",
    bare.status === "ok" &&
      bare.command.kind === "openLiquidity" &&
      bare.command.token0 === undefined &&
      bare.command.token1 === undefined,
  );

  for (const sentence of [
    "provide liquidity to KLD/USDC",
    "lp into KLD/USDC",
    "open a KLD/USDC pool",
    "create a new pool for KLD and USDC",
    "seed a KLD/USDC pool",
    "put KLD and USDC into a pool",
  ]) {
    const r = p(sentence);
    check(
      `"${sentence}" opens the form`,
      r.status === "ok" && r.command.kind === "openLiquidity",
      r.status,
    );
  }

  // A tier only in percent. The bare 3000 that names the same tier in the tool
  // catalog is a number, and a number in this sentence is an amount.
  const tiered = p("create a new 0.3% KLD/USDC pool");
  check(
    "'0.3%' becomes fee 3000",
    tiered.status === "ok" &&
      tiered.command.kind === "openLiquidity" &&
      tiered.command.fee === 3000,
    tiered.status === "ok" && tiered.command.kind === "openLiquidity"
      ? String(tiered.command.fee)
      : tiered.status,
  );
  const padded = p("add liquidity to KLD/USDC at 0.30%");
  check(
    "'0.30%' is the same tier, not a miss",
    padded.status === "ok" &&
      padded.command.kind === "openLiquidity" &&
      padded.command.fee === 3000,
  );
  const wide = p("open a 1% KLD/USDC pool");
  check(
    "'1%' becomes fee 10000",
    wide.status === "ok" &&
      wide.command.kind === "openLiquidity" &&
      wide.command.fee === 10_000,
  );
  const odd = p("open a 0.7% KLD/USDC pool");
  check(
    "an untraded tier is ignored rather than refused",
    odd.status === "ok" &&
      odd.command.kind === "openLiquidity" &&
      odd.command.fee === undefined,
    odd.status,
  );

  // The four vetoes, each the sentence it exists for.
  const priced = p("add 1 WETH and 2000 USDC to the WETH/USDC pool");
  check(
    "a priced sentence is the model's, not the form's",
    priced.status !== "ok" || priced.command.kind !== "openLiquidity",
    priced.status === "ok" ? priced.command.kind : priced.status,
  );
  const onePrice = p("add 500 USDC of liquidity to KLD/USDC");
  check(
    "one amount is enough to veto — the form has nowhere to put it",
    onePrice.status !== "ok" || onePrice.command.kind !== "openLiquidity",
    onePrice.status === "ok" ? onePrice.command.kind : onePrice.status,
  );
  const onPosition = p("add liquidity to position 42");
  check(
    "a position reference means increase, not open",
    onPosition.status !== "ok" || onPosition.command.kind !== "openLiquidity",
    onPosition.status === "ok" ? onPosition.command.kind : onPosition.status,
  );
  // The noun vetoes with or without a number, and that costs a real sentence:
  // "start an LP position in KLD/USDC" is a new-position request this refuses.
  // Kept deliberately. detectRef binds "position" whether or not an id follows,
  // so an unnumbered one is a sentence about a position nobody has named — and
  // the rule at the top of this file is that ambiguity escalates rather than
  // guesses. The model answers it; the other reading opens a blank deposit form
  // over a position the user already owns.
  const unnumbered = p("start an LP position in KLD/USDC");
  check(
    "an unnumbered position reference vetoes too, by design",
    unnumbered.status !== "ok" || unnumbered.command.kind !== "openLiquidity",
    unnumbered.status === "ok" ? unnumbered.command.kind : unnumbered.status,
  );
  const lending = p("deposit USDC as collateral in the lending pool");
  check(
    "the lending pool is a different pool",
    lending.status !== "ok" || lending.command.kind !== "openLiquidity",
    lending.status === "ok" ? lending.command.kind : lending.status,
  );
  for (const sentence of [
    "remove liquidity position 7",
    "withdraw from the KLD/USDC pool",
    "collect fees on my LP",
    "close my KLD/USDC pool position",
  ]) {
    const r = p(sentence);
    check(
      `"${sentence}" is never a deposit form`,
      r.status !== "ok" || r.command.kind !== "openLiquidity",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }

  // The noun alone must not be enough, or every question about pools becomes a
  // navigation. These stay with the model and with PORTFOLIO_VETO respectively.
  for (const sentence of [
    "what is a liquidity pool",
    "how much liquidity do I have",
    "swap 100 KLD in the KLD/USDC pool",
    "which pools have the best fees",
  ]) {
    const r = p(sentence);
    check(
      `"${sentence}" needs more than a liquidity noun`,
      r.status !== "ok" || r.command.kind !== "openLiquidity",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }
}

console.log("\n— swap grammar is unaffected by the new verbs —");
check("swap still parses", p("swap 500 usdc to kld").status === "ok");
check("'sell' still routes to swap", p("sell 5 kld for usdc").status === "ok");

/*
 * "buy" is the one verb in the swap list that reverses the sentence: `swap A for
 * B` spends A, `buy A with B` spends B. Getting it wrong is not a near miss, it
 * is the opposite trade — so every phrasing that reaches parseSwap under `buy`
 * is pinned here, including the ones that must refuse to guess.
 */
console.log("\n— buy: the same verb table, the opposite direction —");
{
  const withUsdc = p("buy KLD with 500 USDC");
  check(
    "'with' spends the token on its right",
    withUsdc.status === "ok" &&
      withUsdc.command.tokenIn.symbol === "USDC" &&
      withUsdc.command.tokenOut.symbol === "KLD",
    withUsdc.status === "ok"
      ? `${withUsdc.command.tokenIn.symbol}->${withUsdc.command.tokenOut.symbol}`
      : withUsdc.status,
  );
  check(
    "and keeps the amount on the spent side",
    withUsdc.status === "ok" && withUsdc.command.amount === "500",
    withUsdc.status === "ok" ? withUsdc.command.amount : "",
  );

  const forUsdc = p("buy kld for 500 usdc");
  check(
    "'for' after buy means the same as 'with', not what it means after swap",
    forUsdc.status === "ok" &&
      forUsdc.command.tokenIn.symbol === "USDC" &&
      forUsdc.command.tokenOut.symbol === "KLD",
    forUsdc.status === "ok"
      ? `${forUsdc.command.tokenIn.symbol}->${forUsdc.command.tokenOut.symbol}`
      : forUsdc.status,
  );
  check(
    "while 'for' after swap still spends the token on its left",
    (() => {
      const r = p("swap 100 usdc for kld");
      return (
        r.status === "ok" &&
        r.command.tokenIn.symbol === "USDC" &&
        r.command.tokenOut.symbol === "KLD"
      );
    })(),
  );

  const of = p("buy 500 usdc of kld");
  check(
    "'of' reads forwards again: spend the 500 USDC",
    of.status === "ok" &&
      of.command.tokenIn.symbol === "USDC" &&
      of.command.tokenOut.symbol === "KLD" &&
      of.command.amount === "500",
    of.status === "ok"
      ? `${of.command.amount} ${of.command.tokenIn.symbol}->${of.command.tokenOut.symbol}`
      : of.status,
  );
  check(
    "'purchase' is the same verb",
    p("purchase kld with 5 weth").status === "ok",
  );
}

console.log("\n— buy asks rather than picking a side —");
{
  const bare = p("buy KLD");
  check(
    "one token named is not a trade yet",
    bare.status === "incomplete" && bare.missing === "tokenIn",
    `${bare.status} ${bare.status === "incomplete" ? bare.missing : ""}`,
  );
  check(
    "and it is held as the token to receive, not the one to spend",
    bare.status === "incomplete" && bare.draft.tokenOut?.symbol === "KLD",
  );

  /* There is no exact-output swap: the intent prices by input. "buy 100 KLD"
     therefore cannot be honoured as written, and silently spending 100 of
     whatever token is named next would be the wrong trade at the right size. */
  const exactOut = p("buy 100 KLD");
  check(
    "an output amount is refused, not repurposed",
    exactOut.status === "incomplete" && exactOut.missing === "tokenIn",
    `${exactOut.status} ${exactOut.status === "incomplete" ? exactOut.missing : ""}`,
  );
  check(
    "the dropped amount is not left in the draft",
    exactOut.status === "incomplete" && exactOut.draft.amount === undefined,
    exactOut.status === "incomplete" ? String(exactOut.draft.amount) : "",
  );
  check(
    "and the prompt says the 100 was dropped and why",
    exactOut.status === "incomplete" &&
      exactOut.prompt.includes("100 KLD") &&
      /what you spend/.test(exactOut.prompt),
    exactOut.status === "incomplete" ? exactOut.prompt : "",
  );

  /* No positional fallback under buy: "buy KLD USDC" and "swap KLD USDC" would
     otherwise mean opposite things while looking equally parseable. */
  const positional = p("buy kld usdc");
  check(
    "two tokens with no separator is not guessed at",
    positional.status === "incomplete" && positional.missing === "tokenIn",
    `${positional.status} ${positional.status === "incomplete" ? positional.missing : ""}`,
  );
}

/*
 * A portfolio read. The safety property here is placement rather than the phrase
 * list — the check runs only where detectVerb found nothing, so any sentence that
 * states an action has already been claimed. These cases assert both halves: the
 * reads resolve, and the actions are not stolen.
 */
console.log("\n— portfolio: a question about holdings, not a transaction —");
{
  for (const text of [
    "what are my balances",
    "show my portfolio",
    "show my positions",
    "what do i have",
    "how much do i have",
    "my holdings",
    "portfolio",
    "balances",
  ]) {
    const r = p(text);
    check(
      `"${text}" is answered locally`,
      r.status === "ok" && r.command.kind === "portfolio",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }
}

console.log("\n— and it never takes a sentence that states an action —");
{
  check(
    "'sell my balance of KLD' is still a swap",
    (() => {
      const r = p("sell my balance of 5 kld for usdc");
      return r.status === "ok" && r.command.kind === "swap";
    })(),
  );
  check(
    "'send my balance to …' is still a send",
    (() => {
      const r = p("send 5 kld to 0x1111111111111111111111111111111111111111");
      return r.status === "ok" && r.command.kind === "send";
    })(),
  );
  /* provideLiquidity is tool-only and has no verb, so "add liquidity" reaches the
     portfolio check with nothing else to claim it. It has to fall through to the
     model rather than be answered with a balance sheet. */
  check(
    "'add liquidity to my position' falls through to the model",
    p("add liquidity to my position").status === "unknown",
    p("add liquidity to my position").status,
  );
  check(
    "'how much liquidity do i have' does too",
    p("how much liquidity do i have").status === "unknown",
    p("how much liquidity do i have").status,
  );
  check(
    "'my pool' is not a portfolio read",
    p("my pools").status === "unknown",
  );
}

/*
 * "fund" belongs to fillRequest and also to ordinary English. The guard has to
 * decline the second reading without losing the first, so both halves are pinned:
 * a fill still parses, and a sentence about the user's own wallet gets out of the
 * way instead of asking which request to fill.
 */
console.log("\n— 'fund' declines the sentences that are not about a row —");
{
  check(
    "'fund my wallet' is left for the FAQ",
    p("fund my wallet").status === "unknown",
    p("fund my wallet").status,
  );
  check("'fund me' too", p("fund me").status === "unknown");
  check(
    "and naming a token does not make it a fill",
    p("fund my wallet with usdc").status === "unknown",
    p("fund my wallet with usdc").status,
  );

  const req = p("fund request 7");
  check(
    "a referenced request still fills",
    req.status === "ok" && req.command.kind === "fillRequest",
    req.status === "ok" ? req.command.kind : req.status,
  );
  check(
    "and the id survives",
    req.status === "ok" && req.command.requestId === 7,
  );
  const possessive = p("fund my request 7");
  check(
    "a row named possessively is still a row",
    possessive.status === "ok" && possessive.command.kind === "fillRequest",
    possessive.status,
  );
  const noRef = p("fund 500 usdc");
  check(
    "a fill missing its row is still worth asking about",
    noRef.status === "incomplete" && noRef.missing === "ref",
    `${noRef.status} ${noRef.status === "incomplete" ? noRef.missing : ""}`,
  );
  check(
    "'fill' is untouched",
    (() => {
      const r = p("fill request 3");
      return r.status === "ok" && r.command.kind === "fillRequest";
    })(),
  );
}

console.log("\n— completeDraft —");
{
  const done = completeDraft({
    kind: "swap",
    amount: "5",
    tokenIn: TOKENS[1],
    tokenOut: TOKENS[0],
  });
  check("promotes a full draft", done.status === "ok");
  const half = completeDraft({ kind: "swap", amount: "5", tokenIn: TOKENS[1] });
  check(
    "holds an unfinished draft",
    half.status === "incomplete" && half.missing === "tokenOut",
  );
}

// The resume path: a command the planner refused, taken back to a draft so the
// follow-up answer is read locally instead of escalating to a model.
//
// The round trip is the property worth testing, and it is testable exactly
// because both halves are here: `completeDraft(draftFromCommand(c))` must give
// back `c`. If it ever doesn't, a refusal that offered to fix one value would
// quietly rebuild a *different* command from the rest — the failure mode with no
// error attached to it.
console.log("\n— draftFromCommand —");
{
  const SENTENCES = [
    "swap 500 USDC to KLD",
    "stake 100",
    "send 50 USDC to 0x1111111111111111111111111111111111111111",
    "bridge 0.05 WETH to Base Sepolia",
    "borrow 500 USDC at 8% for 30 days",
    "lend 1000 USDC at 10% for 60 days",
    "deposit 500 USDC",
    "withdraw 200 USDC",
    "approve 100 USDC",
    "mint 500 USDC",
    "redeem 500 kfUSD",
    "lock 500",
    "unlock 200",
    "repay",
    "cancel listing 3",
    "cancel request 7",
    "take listing 3 for 100",
    "fund request 7",
    "collect fees position 42",
    "remove liquidity position 42",
    "complete withdrawal to USDC",
  ];

  for (const sentence of SENTENCES) {
    const parsed = p(sentence);
    if (parsed.status !== "ok") {
      check(`"${sentence}" parses`, false, parsed.status);
      continue;
    }
    const draft = draftFromCommand(parsed.command);
    if (!draft) {
      check(`"${sentence}" round-trips`, false, "no draft");
      continue;
    }
    const back = completeDraft(draft);
    check(
      `"${sentence}" round-trips through a draft`,
      back.status === "ok" &&
        JSON.stringify(back.command) === JSON.stringify(parsed.command),
      back.status === "ok"
        ? JSON.stringify(back.command)
        : `${back.status} ${back.status === "incomplete" ? back.missing : ""}`,
    );
  }

  // The slotless kinds. Null, not an empty draft: there is nothing about "what
  // do you hold" that a follow-up answer could complete. `openLiquidity` is the
  // one that gets there differently — it has fields, all optional, and the form
  // it opens collects the rest, so asking here would be asking twice.
  for (const kind of [
    "help",
    "receive",
    "portfolio",
    "claimYield",
    "compoundYield",
    "openLiquidity",
  ]) {
    check(`${kind} has no draft`, draftFromCommand({ kind }) === null);
  }
}

console.log("\n— clearSlot —");
{
  const parsed = p("lend 1000 USDC at 10% for 60 days");
  const draft = draftFromCommand(parsed.command);
  const cleared = clearSlot(draft, "token");

  const asked = completeDraft(cleared);
  check(
    "clearing the token makes the draft ask for one",
    asked.status === "incomplete" && asked.missing === "token",
    `${asked.status} ${asked.status === "incomplete" ? asked.missing : ""}`,
  );
  // The whole reason to resume rather than restart: being told USDT is not
  // accepted must not also cost the amount, the rate and the term.
  check("the amount survives", cleared.amount === "1000");
  check("the rate survives", cleared.interestPct === 10);
  check("the term survives", cleared.days === 60);

  const answered = fillSlot(cleared, "token", "use USDC", TOKENS);
  check(
    "and a bare 'use USDC' completes it",
    answered.status === "ok" &&
      answered.command.kind === "lend" &&
      answered.command.token.symbol === "USDC" &&
      answered.command.amount === "1000" &&
      answered.command.interestPct === 10 &&
      answered.command.days === 60,
    answered.status,
  );

  // A ref is two fields, so clearing it has to drop both — leaving refTarget
  // behind would let a bare "3" resolve against the side the refusal objected to.
  const takeDraft = draftFromCommand(p("cancel listing 3").command);
  const noRef = clearSlot(takeDraft, "ref");
  check(
    "clearing a ref drops the side as well as the id",
    noRef.refTarget === undefined && noRef.refId === undefined,
  );
}

console.log("\n— degen and whale slang read as the trade a person meant —");
{
  /* Tester feedback: Luca should read the language every user types — newbie to
     degen to whale — not only the textbook verb. These synonyms resolve to swap,
     with the two directions "buy"/"sell" already carry, and the same refusal to
     guess when a phrasing is ambiguous: a synonym that inverted a trade in
     silence would be worse than no synonym at all. */

  const dump = p("dump 1000 KLD for USDC");
  check(
    "'dump' spends the token you name",
    dump.status === "ok" &&
      dump.command.kind === "swap" &&
      dump.command.tokenIn.symbol === "KLD" &&
      dump.command.tokenOut.symbol === "USDC" &&
      dump.command.amount === "1000",
    JSON.stringify(dump),
  );

  const unload = p("unload 500 KLD to USDC");
  check(
    "'unload' reads the same as sell",
    unload.status === "ok" &&
      unload.command.kind === "swap" &&
      unload.command.tokenIn.symbol === "KLD" &&
      unload.command.tokenOut.symbol === "USDC",
    JSON.stringify(unload),
  );

  const ape = p("ape KLD with 500 USDC");
  check(
    "'ape … with' receives the token you name",
    ape.status === "ok" &&
      ape.command.kind === "swap" &&
      ape.command.tokenIn.symbol === "USDC" &&
      ape.command.tokenOut.symbol === "KLD" &&
      ape.command.amount === "500",
    JSON.stringify(ape),
  );

  const grab = p("grab KLD with 1k USDC");
  check(
    "'grab' inverts like buy, and 1k is a whale's thousand",
    grab.status === "ok" &&
      grab.command.kind === "swap" &&
      grab.command.tokenIn.symbol === "USDC" &&
      grab.command.tokenOut.symbol === "KLD" &&
      grab.command.amount === "1000",
    JSON.stringify(grab),
  );

  const cop = p("cop KLD");
  check(
    "'cop KLD' alone asks which token to spend, never guesses one",
    cop.status === "incomplete" && cop.missing === "tokenIn",
    JSON.stringify(cop),
  );

  /* A buy synonym in a plain forward frame — an explicit spend token and amount
     before "into", a receive token after — is a forward swap, not a buy. Both
     readings of "ape 500 USDC into KLD" mean spend the 500 USDC for KLD, so
     asking which token to spend (the old behaviour) dropped what the sentence
     had already said. See FORWARD_SEPARATORS. */
  const forwardApe = p("ape 500 USDC into KLD");
  check(
    "'ape … into' with a spend token+amount is a forward swap",
    forwardApe.status === "ok" &&
      forwardApe.command.kind === "swap" &&
      forwardApe.command.tokenIn.symbol === "USDC" &&
      forwardApe.command.tokenOut.symbol === "KLD" &&
      forwardApe.command.amount === "500",
    JSON.stringify(forwardApe),
  );

  const noAmount = p("dump my KLD for USDC");
  check(
    "slang with no amount asks for the amount, locally",
    noAmount.status === "incomplete" && noAmount.missing === "amount",
    JSON.stringify(noAmount),
  );

  const flip = p("flip 100 USDC to KLD");
  check(
    "'flip' reads forward like swap — spends the first token named",
    flip.status === "ok" &&
      flip.command.kind === "swap" &&
      flip.command.tokenIn.symbol === "USDC" &&
      flip.command.tokenOut.symbol === "KLD" &&
      flip.command.amount === "100",
    JSON.stringify(flip),
  );

  const yeet = p("yeet 500 USDC into KLD");
  check(
    "'yeet … into' reads forward too, not as a buy",
    yeet.status === "ok" &&
      yeet.command.kind === "swap" &&
      yeet.command.tokenIn.symbol === "USDC" &&
      yeet.command.tokenOut.symbol === "KLD" &&
      yeet.command.amount === "500",
    JSON.stringify(yeet),
  );
}

console.log("\n— unstake parses like stake: one amount, the step decided later —");
{
  const full = p("unstake 100 KLD");
  check(
    "'unstake 100 KLD' is a complete unstake command",
    full.status === "ok" &&
      full.command.kind === "unstake" &&
      full.command.amount === "100",
    JSON.stringify(full),
  );
  const bare = p("unstake");
  check(
    "a bare 'unstake' asks for the amount rather than escalating",
    bare.status === "incomplete" && bare.missing === "amount",
    JSON.stringify(bare),
  );
  const noNumber = p("unstake my kld");
  check(
    "'unstake my kld' names the token but not the amount, so it asks",
    noNumber.status === "incomplete" && noNumber.missing === "amount",
    JSON.stringify(noNumber),
  );
  /* Whole-word matching is the whole safety of this verb: "unstake" must never
     be read as the `stake` verb wearing a prefix, or "unstake 100 KLD" would
     stake 100 more. */
  check(
    "'unstake' is never mistaken for 'stake'",
    full.status === "ok" && full.command.kind !== "stake",
    full.status === "ok" ? full.command.kind : full.status,
  );
}


/* ------------------------------------------------------------------------- *
 * Follow-ups: one thought across two messages
 *
 * "swap 10 USDC to USDT" then "now the same to USDe". Until parseFollowUp this
 * cost a reasoning request for a sentence the grammar had every part of. What
 * the cases below actually protect is the opposite of coverage: a follow-up
 * that reads the sentence WRONG builds a trade the user did not ask for, and
 * they are reviewing a plan that looks reasonable.
 * ------------------------------------------------------------------------- */
{
  console.log("\n— a follow-up continues the last plan —");
  const seeded = parseCommand("swap 10 USDC to KLD", TOKENS);
  const last = seeded.status === "ok" ? seeded.command : null;
  check("the seed parses", last !== null, seeded.status);

  const follow = (text) => parseFollowUp(text, TOKENS, last);
  const swapOf = (r) =>
    r.status === "ok" && r.command.kind === "swap"
      ? `${r.command.amount} ${r.command.tokenIn.symbol}->${r.command.tokenOut.symbol}`
      : r.status;

  check(
    "'now the same to WETH' keeps the amount and the input, changes the output",
    swapOf(follow("now the same to WETH")) === "10 USDC->WETH",
    swapOf(follow("now the same to WETH")),
  );
  check(
    "'and 50 to kfUSD' changes both the amount and the output",
    swapOf(follow("and 50 to kfUSD")) === "50 USDC->kfUSD",
    swapOf(follow("and 50 to kfUSD")),
  );
  check(
    "'make it 50' changes only the amount",
    swapOf(follow("make it 50")) === "50 USDC->KLD",
    swapOf(follow("make it 50")),
  );
  /* Direction is read, never assumed — the same trap `buy` set. A lone token is
     the OUTPUT, because that is what "now to X" means; "from X" says otherwise
     and must be honoured, or the follow-up inverts the trade. */
  check(
    "a lone token is the output, not the input",
    swapOf(follow("WETH instead")) === "10 USDC->WETH",
    swapOf(follow("WETH instead")),
  );
  check(
    "'from' names the input",
    swapOf(follow("same but from WETH")) === "10 WETH->KLD",
    swapOf(follow("same but from WETH")),
  );

  /* THE CASE THAT MADE THIS FUNCTION DANGEROUS BEFORE IT WAS GUARDED. USDR is
     on no chain here (the fixture has KLD, USDC, WETH, kfUSD), so nothing was substituted while
     "same" still counted as naming something — and the carry-over rebuilt the
     USDT swap. The user names one destination and is handed a plan for another. */
  check(
    "an unresolvable destination is refused, not silently ignored",
    follow("now the same to USDR").status === "unknown",
    swapOf(follow("now the same to USDR")),
  );
  check(
    "and so is a bare unknown symbol after a preposition",
    follow("to NOTATOKEN").status === "unknown",
    swapOf(follow("to NOTATOKEN")),
  );

  /* A sentence with its own verb belongs to the grammar. Reading it as a
     modified swap would keep the previous verb and change the action. */
  for (const fresh of ["now stake it", "swap 5 USDC to WETH", "lend 100 USDC at 8%"]) {
    check(
      `'${fresh}' is a fresh command, not a follow-up`,
      follow(fresh).status === "unknown",
      follow(fresh).status,
    );
  }
  /* Naming nothing must not repeat the last transaction. */
  for (const empty of ["ok", "thanks", "sure", "what about fees"]) {
    check(
      `'${empty}' names nothing and is refused`,
      follow(empty).status === "unknown",
      follow(empty).status,
    );
  }
  /* The MODEL_ONLY refusals hold here too, or a follow-up becomes the way a
     recurring buy gets built after all. */
  check(
    "'same to WETH every week' still reaches the model",
    follow("same to WETH every week").status === "unknown",
    follow("same to WETH every week").status,
  );
}

console.log("\n— resting orders: sell-framed limit + cancel-all —");
{
  const limit = p("limit sell 500 KLD at 0.05 USDC");
  check(
    "limit sell parses to a placeOrder",
    limit.status === "ok" && limit.command.kind === "placeOrder",
    limit.status === "ok" ? limit.command.kind : limit.status,
  );
  if (limit.status === "ok" && limit.command.kind === "placeOrder") {
    const c = limit.command;
    check("sells the named input", c.tokenIn.symbol === "KLD", c.tokenIn.symbol);
    check("receives the other token", c.tokenOut.symbol === "USDC", c.tokenOut.symbol);
    check("amount is the input", c.amount === "500", c.amount);
    check("price as typed", c.price === "0.05", c.price);
    check("basis output-per-input", c.basis === "outPerIn", c.basis);
    check("one fill, no cadence", c.fills === 1 && c.everyDays === 0, c.fills + "/" + c.everyDays);
  }
  const alt = p("sell 500 KLD for USDC at 0.05");
  check("sell..for..at reads the same", alt.status === "ok" && alt.command.kind === "placeOrder", alt.status);
  const spot = p("sell 500 KLD for USDC");
  check("no price is a spot swap", spot.status === "ok" && spot.command.kind === "swap", spot.status);
  const buy = p("buy 100 KLD at 0.02 USDC");
  check("buy-framed is not a local order", buy.status !== "ok" || buy.command.kind !== "placeOrder", buy.status);
  check("recurring reaches the model", p("sell 50 KLD every week at 0.05 USDC").status === "unknown", "");
  for (const q of ["cancel all my orders", "cancel every order", "cancel all orders"]) {
    const r = p(q);
    check(q + " cancels every order", r.status === "ok" && r.command.kind === "cancelOrders", r.status);
  }
  const ref = p("cancel listing 3");
  check("cancel listing 3 is a ref-cancel", ref.status === "ok" && ref.command.kind === "cancel", "");
}

console.log("\n— a move is not a portfolio read; a yield deposit is not collateral —");
{
  /* Tester: "move 30% of my portfolio to the best yield" came back as a balance
     card. "move"/"put" are not grammar verbs, so the read swallowed an action. */
  for (const q of [
    "move 30% of my portfolio to the best yield",
    "put 30% of my portfolio into staking",
    "rebalance my portfolio",
    "move my portfolio to lending",
  ]) {
    check(q + " is not a portfolio read", p(q).status !== "ok" || p(q).command.kind !== "portfolio", p(q).status);
  }
  /* A plain balance question still reads. */
  for (const q of ["what is in my portfolio", "my balance", "how much do i have", "do i have any KLD"]) {
    const r = p(q);
    check(q + " still reads the portfolio", r.status === "ok" && r.command.kind === "portfolio", r.status);
  }
  /* Tester: "deposit USDC on yield" built a lending collateral deposit - the
     wrong product. It now declines so the FAQ explains the yield options. */
  for (const q of ["deposit 500 usdc on yield", "deposit usdc for yield", "deposit 500 usdc to earn yield"]) {
    check(q + " does not build a collateral deposit", p(q).status === "unknown", p(q).status);
  }
  /* A real collateral deposit is untouched. */
  const dep = p("deposit 500 USDC");
  check("plain deposit still builds collateral", dep.status === "ok" && dep.command.kind === "deposit", dep.status);
  const depc = p("deposit 500 USDC as collateral");
  check("deposit as collateral still builds", depc.status === "ok" && depc.command.kind === "deposit", depc.status);
}

console.log("\n— funding a borrower is filling their request —");
{
  /* Tester funded a borrow request with "fund borrower 7" and was asked which
     request. Filling a request IS funding its borrower, so the person-word now
     resolves the same reference as the mechanism-word. */
  for (const q of ["fund borrower 7", "fill borrower 3", "fund borrower 5"]) {
    const r = p(q);
    check(q + " funds the request", r.status === "ok" && r.command.kind === "fillRequest", r.status);
  }
  /* The mechanism-word still works, and the borrow VERB is untouched - "borrow"
     is not "borrower". */
  check("fund request 7 still works", p("fund request 7").status === "ok" && p("fund request 7").command.kind === "fillRequest");
  check("the borrow verb is not shadowed", p("borrow 500 USDC at 8% for 30 days").status === "ok" && p("borrow 500 USDC at 8% for 30 days").command.kind === "borrow");
}

console.log("\n— a misspelled symbol is named back, not asked around —");
{
  /* A tester typed a symbol wrong and got "Which token do you want to spend?",
     which is the parser asking a question it already knows the answer to. Worse,
     the word it could not read was dropped from the sentence, and the token it
     COULD read slid into the empty side: "swap 100 usdcc to KLD" was one answer
     away from spending the KLD. Both halves are fixed here. */
  const r = p("swap 100 usdcc to KLD");
  check("a near miss asks by name", r.status === "incomplete" && r.prompt.includes("did you mean USDC"), r.status + " " + (r.prompt || ""));
  check("it asks about the side the typo was on", r.status === "incomplete" && r.missing === "tokenIn", r.missing);
  check("the token that was spelled right keeps its side", r.status === "incomplete" && r.draft.tokenOut?.symbol === "KLD" && !r.draft.tokenIn, JSON.stringify(r.draft));
  check("the amount survives the question", r.status === "incomplete" && r.draft.amount === "100", r.draft?.amount);

  /* And "yes" finishes it, locally. This is the whole saving: the sentence and
     its confirmation both stay inside the grammar. */
  const y = fillSlot(r.draft, r.missing, "yes", TOKENS);
  check("yes completes the swap", y.status === "ok" && y.command.kind === "swap", y.status);
  check("yes spends the suggested token", y.status === "ok" && y.command.tokenIn.symbol === "USDC", y.status === "ok" ? y.command.tokenIn.symbol : y.status);
  check("yes does not invert the trade", y.status === "ok" && y.command.tokenOut.symbol === "KLD" && y.command.amount === "100");
}

console.log("\n— the shapes a symbol comes out in —");
{
  /* A transposition is one mistake, not two. Plain Levenshtein scores "udsc"
     the same as a word sharing half its letters; this is why the distance has
     the extra move. */
  const t = p("swap 100 udsc to KLD");
  check("a transposition is a near miss", t.status === "incomplete" && t.prompt.includes("did you mean USDC"), t.prompt || t.status);

  /* A symbol broken by a space is the same mistake as one broken by a letter. */
  const w = p("swap 100 kf usd to KLD");
  check("a symbol split by a space is found", w.status === "incomplete" && w.prompt.includes("did you mean kfUSD"), w.prompt || w.status);

  /* Not every miss is a typo. "eth" is simply what WETH is called, and no
     distance could pick it out — WETH and ETH are equally far. A list can. */
  const a = p("swap 100 eth to KLD");
  check("a shorthand resolves by name", a.status === "incomplete" && a.prompt.includes("did you mean WETH"), a.prompt || a.status);
  const ay = fillSlot(a.draft, a.missing, "yeah", TOKENS);
  check("the shorthand confirms too", ay.status === "ok" && ay.command.tokenIn.symbol === "WETH", ay.status);

  /* The reply can be a near miss as well — a word typed wrong once is often
     typed wrong twice, and the second one deserves the same named question. */
  const again = fillSlot({ kind: "swap", amount: "100", tokenOut: TOKENS[0] }, "tokenIn", "usdcc", TOKENS);
  check("a mistyped answer is named back", again.status === "incomplete" && again.prompt.includes("did you mean USDC"), again.prompt || again.status);
}

console.log("\n— what must never become a token —");
{
  /* A tie is not a near miss. USDC, USDT and USDe sit one edit from each other,
     so a word one edit from all three has identified nothing, and picking one
     is a coin flip with someone's money on it. */
  const STABLES = [
    { address: "0xa", name: "USD Coin", symbol: "USDC", decimals: 6, chainId: 11124 },
    { address: "0xb", name: "Tether USD", symbol: "USDT", decimals: 6, chainId: 11124 },
    { address: "0xc", name: "Ethena USDe", symbol: "USDe", decimals: 18, chainId: 11124 },
  ];
  const tie = parseCommand("deposit 100 usd", STABLES);
  check("a three-way tie asks the plain question", tie.status === "incomplete" && tie.missing === "token" && !tie.prompt.includes("did you mean"), tie.prompt || tie.status);
  check("a tie leaves no guess on the draft", tie.status === "incomplete" && !tie.draft.suggest);

  /* A word the grammar already knows is never a misspelled symbol, however
     close it lands. "rate" carries an interest rate and is two edits from DAI;
     "sold", "old" and "cold" are all two from POL. */
  const plain = p("deposit 100");
  check("a sentence with no candidate asks plainly", plain.status === "incomplete" && plain.missing === "token" && !plain.prompt.includes("did you mean"), plain.prompt || plain.status);
  const junk = p("deposit 100 zzzzzz");
  check("a word close to nothing asks plainly", junk.status === "incomplete" && !junk.prompt.includes("did you mean"), junk.prompt || junk.status);

  /* Correctly spelled sentences are untouched: the scan only runs on drafts
     that were already going to end in a question. */
  const ok1 = p("swap 500 USDC to KLD");
  check("an exact swap still builds", ok1.status === "ok" && ok1.command.tokenIn.symbol === "USDC" && ok1.command.tokenOut.symbol === "KLD", ok1.status);
  const ok2 = p("lend 1000 USDC at 8% for 30 days");
  check("an exact lend still builds", ok2.status === "ok" && ok2.command.kind === "lend", ok2.status);

  /* A chain name is not a token. The bridge scan stops at the separator, so a
     destination can never be read back as a symbol to spend. */
  const b = p("bridge 100 usdcc to Base Sepolia");
  check("a bridge names the typo", b.status === "incomplete" && b.prompt.includes("did you mean USDC"), b.prompt || b.status);
  check("and keeps the destination", b.status === "incomplete" && (b.draft.toChain || "").toLowerCase() === "base sepolia", b.draft?.toChain);

  /* An explicit source: "from X" is captured as fromChain, kept out of the token
     and destination, and left unresolved for buildIntents. */
  const src = p("bridge 50 USDC from BNB Chain to Arc");
  check(
    "a from-chain bridge builds",
    src.status === "ok" && src.command.kind === "bridge",
    src.status,
  );
  check(
    "the source is captured",
    src.status === "ok" && src.command.kind === "bridge" && src.command.fromChain === "bnb chain",
    src.status === "ok" && src.command.kind === "bridge" ? src.command.fromChain : src.status,
  );
  check(
    "the destination is still the 'to' chain",
    src.status === "ok" && src.command.kind === "bridge" && src.command.toChain === "arc",
    src.status === "ok" && src.command.kind === "bridge" ? src.command.toChain : src.status,
  );
  check(
    "the asset is not read out of the source phrase",
    src.status === "ok" && src.command.kind === "bridge" && src.command.token.symbol === "USDC",
    src.status,
  );

  /* No "from" means no source — every existing bridge is unchanged. */
  const noSrc = p("bridge 0.05 USDC to Base Sepolia");
  check(
    "a plain bridge has no source",
    noSrc.status === "ok" && noSrc.command.kind === "bridge" && noSrc.command.fromChain === undefined,
    noSrc.status,
  );
}

console.log("\n— a guess is only ever offered —");
{
  const r = p("lend 500 usdcc at 8% for 30 days");
  check("the rest of the sentence survives", r.status === "incomplete" && r.draft.amount === "500" && r.draft.interestPct === 8 && r.draft.days === 30, JSON.stringify(r.draft));

  /* "no" withdraws the guess rather than repeating it — and once withdrawn,
     "yes" means nothing again. */
  const no = fillSlot(r.draft, r.missing, "no", TOKENS);
  check("no falls back to the plain question", no.status === "incomplete" && !no.prompt.includes("did you mean"), no.prompt || no.status);
  const after = fillSlot(no.draft, no.missing, "yes", TOKENS);
  check("yes means nothing once the guess is gone", after.status === "incomplete" && after.missing === "token", after.status);

  /* Naming a different token beats the guess, obviously. */
  const other = fillSlot(r.draft, r.missing, "KLD", TOKENS);
  check("naming another token overrides the guess", other.status === "ok" && other.command.token.symbol === "KLD", other.status);

  /* A guess never survives onto a question it was not offered for: being asked
     "How much?" must not be answerable with "yes". */
  const amountAsk = completeDraft({ kind: "swap", tokenIn: TOKENS[1], tokenOut: TOKENS[0], suggest: { token: TOKENS[1], typed: "usdcc" } });
  check("an amount question drops the guess", amountAsk.status === "incomplete" && amountAsk.missing === "amount" && !amountAsk.draft.suggest, amountAsk.prompt || amountAsk.status);

  /* A planner refusal re-asks a slot on an old draft. Whatever was guessed a
     turn ago must not be what the next "yes" agrees to. */
  const cleared = clearSlot({ kind: "swap", amount: "100", tokenIn: TOKENS[1], tokenOut: TOKENS[0], suggest: { token: TOKENS[2], typed: "eth" } }, "tokenIn");
  check("clearing a slot clears the guess", !cleared.suggest);
}

console.log("swap resolves relative amounts; other verbs escalate");
{
  // The reported bug: these returned "How much?". Swap now carries the exact
  // share for the planner (build.ts) to resolve against the balance.
  const expect = [
    { text: "swap half of my USDC to KLD", num: 1, den: 2 },
    { text: "swap 50% of my USDC balance to KLD", num: 50, den: 100 },
    { text: "swap all my USDC to KLD", num: 1, den: 1 },
    { text: "swap most of my USDC to KLD", num: 1, den: 1 },
  ];
  for (const { text, num, den } of expect) {
    const r = p(text);
    const ok =
      r.status === "ok" &&
      r.command.kind === "swap" &&
      !r.command.amount &&
      !!r.command.relative &&
      r.command.relative.num === num &&
      r.command.relative.den === den;
    check(`"${text}" carries a ${num}/${den} share`, ok, r.status);
  }
}
{
  // Siblings: any amount verb whose amount can be relative.
  const cases = [
    "send half my WETH to 0x1111111111111111111111111111111111111111",
    "stake all my KLD",
    "deposit 50% of my USDC",
    "withdraw half my collateral",
    "borrow half of my USDC", // rate verb, but "half" is still a share
  ];
  for (const text of cases) {
    const r = p(text);
    check(`"${text}" escalates`, r.status === "unknown", r.status);
  }
}
{
  // Controls: absolute amounts still parse, and a rate is NOT a relative amount.
  const swap = p("swap 5 USDC to KLD");
  check(
    "an absolute swap still parses",
    swap.status === "ok" && swap.command.kind === "swap" && swap.command.amount === "5",
    swap.status,
  );
  const noAmount = p("swap USDC to KLD");
  check(
    "a swap with no amount and no share still asks 'how much?'",
    noAmount.status === "incomplete" && noAmount.missing === "amount",
    noAmount.status,
  );
  const borrow = p("borrow 500 USDC at 8% for 30 days");
  check(
    "borrow at 8% reads the % as a rate, not a share",
    borrow.status === "ok" && borrow.command.kind === "borrow" && borrow.command.amount === "500",
    borrow.status,
  );
}
{
  // Replying "half" to "How much?" escalates rather than re-asking.
  const draft = { kind: "swap", tokenIn: TOKENS[1], tokenOut: TOKENS[0] };
  const r = fillSlot(draft, "amount", "half", TOKENS);
  check("replying 'half' to 'how much?' escalates", r.status === "unknown", r.status);
}

/* ---------------------------------------------------------------------------
 * A REPEAT OF THE LAST PLAN, NAMED WITH ITS OWN VERB.
 *
 * "swap 1 usdc to eurc", signed, then "do same swap once again" — and Luca
 * asked "which token do you want to spend?". The grammar read the verb, found
 * no token and opened a Draft; the follow-up reader never saw the sentence,
 * and would have refused it anyway under rule 1 (it has a verb). The exception
 * admits a verb that AGREES with the carried command inside a repeat cue, and
 * the page now offers an incomplete parse to the follow-up reader before it
 * asks. What these cases protect: a repeat must be the SAME trade (or the same
 * trade with the stated change); a different verb, an acknowledgement, and a
 * token-for-itself must all still refuse — a wrong repeat is a wrong trade.
 * ------------------------------------------------------------------------- */
{
  console.log("\n— 'do the same swap once again' repeats the last plan —");
  const seeded = parseCommand("swap 10 USDC to KLD", TOKENS);
  const last = seeded.status === "ok" ? seeded.command : null;
  check("the seed parses", last !== null, seeded.status);
  const follow = (text) => parseFollowUp(text, TOKENS, last);
  const swapOf = (r) =>
    r.status === "ok" && r.command.kind === "swap"
      ? `${r.command.amount} ${r.command.tokenIn.symbol}->${r.command.tokenOut.symbol}`
      : r.status;

  /* The grammar alone still opens a Draft asking for the token — that is the
     exact sentence the page now hands to the follow-up reader instead. */
  const alone = p("do same swap once again");
  check(
    "on its own the grammar asks for the token (the bug's shape)",
    alone.status === "incomplete" && alone.missing === "tokenIn",
    alone.status === "incomplete" ? alone.missing : alone.status,
  );

  for (const text of [
    "do same swap once again",
    "do the same swap again",
    "same swap again",
    "swap again",
    "repeat that swap",
    "swap once more",
    "again",
    "do it again",
    "once more",
    "one more time",
    "the same",
    "repeat",
    "redo that",
    "same as before",
  ]) {
    check(
      `'${text}' rebuilds the identical swap`,
      swapOf(follow(text)) === "10 USDC->KLD",
      swapOf(follow(text)),
    );
  }

  /* A repeat that changes something changes only that. */
  check(
    "'same swap but 5' keeps the pair, changes the amount",
    swapOf(follow("same swap but 5")) === "5 USDC->KLD",
    swapOf(follow("same swap but 5")),
  );
  check(
    "'swap again to WETH' keeps the amount and input, changes the output",
    swapOf(follow("swap again to WETH")) === "10 USDC->WETH",
    swapOf(follow("swap again to WETH")),
  );
  check(
    "'do the same swap again from WETH' changes only the input",
    swapOf(follow("do the same swap again from WETH")) === "10 WETH->KLD",
    swapOf(follow("do the same swap again from WETH")),
  );

  /* Rule 1 still holds for a DIFFERENT verb, however the sentence is cued. */
  for (const text of ["stake again", "same bridge again", "now stake it", "repeat the send"]) {
    check(
      `'${text}' after a swap is not a repeat of the swap`,
      follow(text).status === "unknown",
      follow(text).status,
    );
  }
  /* Rule 3 still holds: an acknowledgement repeats nothing. */
  for (const text of ["ok", "thanks", "do it", "yes", "sure"]) {
    check(
      `'${text}' does not rebuild the swap`,
      follow(text).status === "unknown",
      follow(text).status,
    );
  }
  /* And a repeat that would trade a token for itself is refused, not built. */
  check(
    "'sell 2 usdc again' (USDC for USDC) is refused",
    follow("sell 2 usdc again").status === "unknown",
    follow("sell 2 usdc again").status,
  );
}

/* ---------------------------------------------------------------------------
 * THE QUESTION NAMES THE REAL PROBLEM.
 *
 * Read from the agent_questions log (2026-09-13..17): 130 complete commands
 * were asked "which token?" — "swap 100 USDC to EURC" on Sepolia, "swap 500
 * USDC to KLD" on Ethereum — because the token named was not on the connected
 * chain and the grammar dropped it silently; 28 more came with no wallet at
 * all; "0.0001ETH" and "500kfusd" lost both amount and token; a pasted
 * "/trade/agent" became a swap; "swap 50 usdc to sepolia" asked for a token
 * where a chain was named; and "1,0" would have read as 10. Each case below is
 * one of those, with the answer the grammar now gives instead.
 * ------------------------------------------------------------------------- */
{
  console.log("\n— the question names the real problem —");
  const CTX = {
    chainName: "Sepolia",
    elsewhere: (s) => (s.toLowerCase() === "eurc" ? ["Arc"] : s.toLowerCase() === "cirbtc" ? ["Arc", "Base"] : []),
    isChain: (p) => ["base", "sepolia", "arc", "base sepolia", "arc sepolia"].includes(p),
  };
  const pc = (text, ctx = CTX, tokens = TOKENS) => parseCommand(text, tokens, ctx);
  const promptOf = (r) => (r.status === "incomplete" ? r.prompt : r.status);

  /* A token known on another chain: named, located, never "did you mean". */
  const abroad = pc("swap 100 usdc to eurc");
  check(
    "a token from another chain is asked about by name and place",
    abroad.status === "incomplete" && abroad.missing === "tokenOut" && abroad.prompt.includes("EURC isn't on Sepolia") && abroad.prompt.includes("it's on Arc"),
    promptOf(abroad),
  );
  check(
    "and not as a near miss of USDC (two edits away)",
    abroad.status === "incomplete" && !abroad.prompt.includes("did you mean"),
    promptOf(abroad),
  );
  check(
    "the side that resolved is kept",
    abroad.status === "incomplete" && abroad.draft.tokenIn?.symbol === "USDC" && abroad.draft.amount === "100",
    abroad.status === "incomplete" ? `${abroad.draft.tokenIn?.symbol} ${abroad.draft.amount}` : abroad.status,
  );
  const spent = pc("swap 100 eurc to usdc");
  check(
    "the same on the spent side",
    spent.status === "incomplete" && spent.missing === "tokenIn" && spent.prompt.includes("EURC isn't on Sepolia"),
    promptOf(spent),
  );
  const two = pc("swap 10 usdc to cirbtc");
  check(
    "several chains are listed",
    two.status === "incomplete" && two.prompt.includes("it's on Arc and Base"),
    promptOf(two),
  );
  /* Unknown everywhere: quoted back, with what IS here. */
  const nowhere = pc("swap 100 usdc to zzzq");
  check(
    "a token known nowhere is named as unknown here, with options",
    nowhere.status === "incomplete" && nowhere.missing === "tokenOut" && nowhere.prompt.includes("I don't know a token called ZZZQ on Sepolia") && nowhere.prompt.includes("USDC"),
    promptOf(nowhere),
  );
  /* Without context the old answers stand — the marketing planner passes none. */
  const plain = p("swap 100 usdc to eurc");
  check(
    "with no context the token is still named as unknown, with no chain",
    plain.status === "incomplete" && plain.prompt.includes("I don't know a token called EURC") && !plain.prompt.includes(" on "),
    promptOf(plain),
  );
  check("a complete command is untouched", pc("swap 100 usdc to kld").status === "ok", pc("swap 100 usdc to kld").status);
  check("the near-miss answer is untouched", promptOf(pc("swap 100 usdcc to kld")).includes("did you mean USDC"), promptOf(pc("swap 100 usdcc to kld")));

  /* A slot reply naming a token from elsewhere gets the same answer, and a
     reply that is a whole command is not an answer at all. */
  const seeded = p("swap 100 usdc to kld");
  const draft = seeded.status === "ok" ? draftFromCommand(seeded.command) : null;
  const replied = fillSlot({ ...draft, tokenOut: undefined }, "tokenOut", "eurc", TOKENS, CTX);
  check(
    "a reply naming a token from another chain says where it is",
    replied.status === "incomplete" && replied.missing === "tokenOut" && replied.prompt.includes("EURC isn't on Sepolia"),
    promptOf(replied),
  );
  const whole = fillSlot({ kind: "swap" }, "tokenIn", "swap 100 usdc to kld", TOKENS, CTX);
  check("a reply with its own verb is a fresh command, not an answer", whole.status === "unknown", whole.status);

  /* No wallet, no vocabulary: the question is the wallet, not the token. */
  const nowallet = pc("swap 100 usdc to kld", {}, []);
  check(
    "no wallet asks for the wallet",
    nowallet.status === "incomplete" && nowallet.prompt.includes("Connect a wallet first"),
    promptOf(nowallet),
  );
  const nochain = pc("send 5 usdc to 0x74A9E2cC8E97DC56D4a337454AD4F62BFa1D63d7", { chainName: "Foo" }, []);
  check(
    "an unsupported chain is named",
    nochain.status === "incomplete" && nochain.prompt.includes("tokens for Foo"),
    promptOf(nochain),
  );

  /* Glued amounts. */
  const lock = p("lock 500kfusd");
  check("'lock 500kfusd' reads the amount", lock.status === "ok" && lock.command.kind === "lock" && lock.command.amount === "500", lock.status === "ok" ? `${lock.command.kind} ${lock.command.amount}` : lock.status);
  const glued = p("swap 100usdc to kld");
  check("'swap 100usdc to kld' reads amount and token", glued.status === "ok" && glued.command.kind === "swap" && glued.command.amount === "100" && glued.command.tokenIn.symbol === "USDC", glued.status);
  const dec = p("swap 0.5weth to usdc");
  check("'0.5weth' too", dec.status === "ok" && dec.command.kind === "swap" && dec.command.amount === "0.5" && dec.command.tokenIn.symbol === "WETH", dec.status);
  const k = p("swap 10k usdc to kld");
  check("'10k' keeps its multiplier", k.status === "ok" && k.command.kind === "swap" && k.command.amount === "10000", k.status === "ok" ? k.command.amount : k.status);

  /* Links are not sentences. */
  check("a pasted link with /trade in it is not a swap", p("check https://app.kaleidofi.xyz/trade/agent please").status === "unknown", p("check https://app.kaleidofi.xyz/trade/agent please").status);
  check("a bare domain path is not a swap either", p("lu coba kasih saran app.kaleidofi.xyz/trade/agent").status === "unknown", p("lu coba kasih saran app.kaleidofi.xyz/trade/agent").status);
  check("nor a bare path", p("see /trade/agent").status === "unknown", p("see /trade/agent").status);
  check("control: the verb itself still works", p("trade 100 usdc to kld").status === "ok", p("trade 100 usdc to kld").status);

  /* A chain where a token should be is a bridge. */
  const br = pc("swap 50 usdc to sepolia");
  check(
    "'swap 50 usdc to sepolia' is read as a bridge",
    br.status === "ok" && br.command.kind === "bridge" && br.command.amount === "50" && br.command.token.symbol === "USDC" && br.command.toChain === "sepolia",
    br.status === "ok" ? `${br.command.kind} ${br.command.toChain}` : br.status,
  );
  const br2 = pc("swap 100 usdc to arc sepolia");
  check("a two-word chain too", br2.status === "ok" && br2.command.kind === "bridge" && br2.command.toChain === "arc sepolia", br2.status === "ok" ? br2.command.toChain : br2.status);
  check("without a chain oracle it stays a swap question", p("swap 50 usdc to sepolia").status === "incomplete", p("swap 50 usdc to sepolia").status);

  /* Commas. */
  const th = p("swap 1,000 usdc to kld");
  check("'1,000' is a thousand", th.status === "ok" && th.command.kind === "swap" && th.command.amount === "1000", th.status === "ok" ? th.command.amount : th.status);
  const thd = p("swap 1,000.50 usdc to kld");
  check("'1,000.50' keeps its cents", thd.status === "ok" && thd.command.kind === "swap" && thd.command.amount === "1000.5", thd.status === "ok" ? thd.command.amount : thd.status);
  const eu = p("lend 1,0 usdc at 8% for 30 days");
  check("'1,0' is not read as 10 — the amount is asked for", eu.status === "incomplete" && eu.missing === "amount", eu.status === "incomplete" ? eu.missing : eu.status);
  const eu2 = p("swap 12,5 usdc to kld");
  check("'12,5' likewise", eu2.status === "incomplete" && eu2.missing === "amount", eu2.status === "incomplete" ? eu2.missing : eu2.status);
}

/* ---------------------------------------------------------------------------
 * A POSSESSIVE READ WITH A WORD IN THE MIDDLE.
 *
 * From the log: "whats my wallet balance?" (repeatedly), "Tell me all my
 * lending positions", "Whats my cumulative balance across all assests" — all
 * sent to the model, because the phrase list matched "my balance" as an exact
 * substring and a qualifier between the two words broke it. Now a bounded gap
 * is allowed, behind the same action and liquidity vetoes.
 * ------------------------------------------------------------------------- */
{
  console.log("\n— a possessive read with a qualifier in the middle —");
  for (const text of [
    "whats my wallet balance?",
    "tell me all my lending positions",
    "whats my cumulative balance across all assets",
    "my total holdings",
    "show my stablecoin balance",
    "what is my usdc balance",
    "how big is my portfolio",
  ]) {
    const r = p(text);
    check(
      `'${text}' is read as a portfolio question`,
      r.status === "ok" && r.command.kind === "portfolio",
      r.status === "ok" ? r.command.kind : r.status,
    );
  }
  /* The vetoes still hold: an action on the portfolio is not a read of it, and
     a pool question is not a balance sheet. */
  check(
    "'move my idle balance to best yield' is not a read (action veto)",
    p("move my idle balance to best yield").status === "unknown",
    p("move my idle balance to best yield").status,
  );
  check(
    "'how much liquidity is in my pool' is not a read (liquidity veto)",
    p("how much liquidity is in my pool").status !== "ok" ||
      p("how much liquidity is in my pool").command.kind !== "portfolio",
    p("how much liquidity is in my pool").status,
  );
  /* And a stated action that happens to name a balance still belongs to its
     verb — the read runs last. */
  check(
    "'sell my balance of 5 kld for usdc' is still a swap",
    (() => { const r = p("sell my balance of 5 kld for usdc"); return r.status === "ok" && r.command.kind === "swap"; })(),
    p("sell my balance of 5 kld for usdc").status,
  );
  check("'my balance' still works", p("my balance").status === "ok" && p("my balance").command.kind === "portfolio", p("my balance").status);

  /* Capability questions reach help, not the model. */
  for (const text of ["what commands can i use", "what can luca do", "what commands are there"]) {
    const r = p(text);
    check(`'${text}' is answered as help`, r.status === "ok" && r.command.kind === "help", r.status === "ok" ? r.command.kind : r.status);
  }
}

/* ---------------------------------------------------------------------------
 * WRONG ANSWERS THE GRAMMAR GAVE, from driving it as a trader would.
 *
 * Each below returned something misleading before: a vault withdrawal that
 * dropped the chain, a send that asked for an address when a chain was named,
 * a balance sheet in answer to "diversify", a dropped amount on "ape 50 usdc
 * into argus", and a "which token?" command in answer to "how do i bridge".
 * ------------------------------------------------------------------------- */
{
  console.log("\n— cross-chain phrasings that led with the wrong verb —");
  const CHAINCTX = { isChain: (pp) => ["base", "arc", "ethereum", "sepolia", "base sepolia", "arc sepolia"].includes(pp) };
  const pc = (t) => parseCommand(t, TOKENS, CHAINCTX);
  const bridgeOf = (r) =>
    r.status === "ok" && r.command.kind === "bridge"
      ? `${r.command.amount} ${r.command.token?.symbol} -> ${r.command.toChain}`
      : r.status === "ok" ? r.command.kind : r.status;

  check(
    "'withdraw 100 usdc to base' is a bridge, not a vault withdrawal",
    bridgeOf(pc("withdraw 100 usdc to base")) === "100 USDC -> base",
    bridgeOf(pc("withdraw 100 usdc to base")),
  );
  check(
    "'send 100 usdc to base' is a bridge, not a send-to-address",
    bridgeOf(pc("send 100 usdc to base")) === "100 USDC -> base",
    bridgeOf(pc("send 100 usdc to base")),
  );
  /* But the ordinary meanings survive when no chain is named. */
  check(
    "'withdraw 100 usdc' is still a plain withdrawal",
    (() => { const r = pc("withdraw 100 usdc"); return r.status === "ok" && r.command.kind === "withdraw"; })(),
    pc("withdraw 100 usdc").status,
  );
  check(
    "'send 5 usdc to 0x…' is still a send to that address",
    (() => { const r = pc("send 5 usdc to 0x74A9E2cC8E97DC56D4a337454AD4F62BFa1D63d7"); return r.status === "ok" && r.command.kind === "send"; })(),
    pc("send 5 usdc to 0x74A9E2cC8E97DC56D4a337454AD4F62BFa1D63d7").status,
  );
  /* With no chain oracle (the marketing planner), nothing changes. */
  check(
    "'send 100 usdc to base' without a chain oracle stays a send question",
    p("send 100 usdc to base").status !== "ok" || p("send 100 usdc to base").command.kind === "send",
    p("send 100 usdc to base").status,
  );

  console.log("\n— a buy-word in a forward frame is a forward swap —");
  const swapOf = (r) =>
    r.status === "ok" && r.command.kind === "swap"
      ? `${r.command.amount} ${r.command.tokenIn.symbol}->${r.command.tokenOut.symbol}`
      : r.status;
  check(
    "'ape 50 usdc into kld' spends the 50 usdc",
    swapOf(p("ape 50 usdc into kld")) === "50 USDC->KLD",
    swapOf(p("ape 50 usdc into kld")),
  );
  check(
    "'grab 100 usdc to weth' too",
    swapOf(p("grab 100 usdc to weth")) === "100 USDC->WETH",
    swapOf(p("grab 100 usdc to weth")),
  );
  /* The buy readings that must NOT change. */
  check(
    "'buy kld with 100 usdc' still spends the usdc",
    swapOf(p("buy kld with 100 usdc")) === "100 USDC->KLD",
    swapOf(p("buy kld with 100 usdc")),
  );
  check(
    "'buy 100 kld' still drops the amount and asks what to spend",
    (() => { const r = p("buy 100 kld"); return r.status === "incomplete" && r.missing === "tokenIn"; })(),
    p("buy 100 kld").status,
  );

  console.log("\n— diversify is an action, not a balance read —");
  check(
    "'diversify my holdings' is not answered as a portfolio read",
    p("diversify my holdings").status !== "ok" || p("diversify my holdings").command.kind !== "portfolio",
    p("diversify my holdings").status,
  );
  check("'my holdings' alone is still a portfolio read", p("my holdings").status === "ok" && p("my holdings").command.kind === "portfolio", p("my holdings").status);

  console.log("\n— a how-to question is not a command —");
  for (const t of ["how do i bridge", "how to stake", "how does lending work", "how do i swap", "how can i borrow"]) {
    check(`'${t}' does not open a command draft`, p(t).status === "unknown", p(t).status + (p(t).status === "incomplete" ? ":" + p(t).missing : ""));
  }
  /* But the reads that begin with "how" are untouched. */
  check("'how much do i have' is still a portfolio read", p("how much do i have").status === "ok" && p("how much do i have").command.kind === "portfolio", p("how much do i have").status);
  check("'how do points work' still falls through to the FAQ (unknown here)", p("how do points work").status === "unknown", p("how do points work").status);
}

/* ---------------------------------------------------------------------------
 * TWO PHRASINGS THAT WERE PAYING THE MODEL FOR SOMETHING LOCAL.
 *
 * "move 100 usdc to base" (a bridge worded with a verb the table doesn't carry)
 * and "how much usdc do i have" (a balance question with the asset in the
 * middle) both escalated. Neither needs reasoning.
 * ------------------------------------------------------------------------- */
{
  console.log("\n— move/transfer to a chain is a bridge —");
  const CHAINCTX = { isChain: (pp) => ["base", "arc", "ethereum", "sepolia", "base sepolia"].includes(pp) };
  const pc = (t) => parseCommand(t, TOKENS, CHAINCTX);
  const bridgeOf = (r) =>
    r.status === "ok" && r.command.kind === "bridge"
      ? `${r.command.amount} ${r.command.token?.symbol} -> ${r.command.toChain}${r.command.fromChain ? " (from " + r.command.fromChain + ")" : ""}`
      : r.status === "ok" ? r.command.kind : r.status;

  check("'move 100 usdc to base' is a bridge", bridgeOf(pc("move 100 usdc to base")) === "100 USDC -> base", bridgeOf(pc("move 100 usdc to base")));
  check("'transfer 50 kld to arc' is a bridge", bridgeOf(pc("transfer 50 kld to arc")) === "50 KLD -> arc", bridgeOf(pc("transfer 50 kld to arc")));
  check("'move 100 usdc from arc to base' keeps the source", bridgeOf(pc("move 100 usdc from arc to base")) === "100 USDC -> base (from arc)", bridgeOf(pc("move 100 usdc from arc to base")));
  /* Without a chain it is NOT a bridge — a strategy for the model. */
  check("'move my usdc to the best yield' is not a bridge", pc("move my usdc to the best yield").status !== "ok" || pc("move my usdc to the best yield").command.kind !== "bridge", pc("move my usdc to the best yield").status);
  /* And with no chain oracle at all (marketing planner) it stays as it was. */
  check("'move 100 usdc to base' without an oracle is not a bridge", p("move 100 usdc to base").status !== "ok" || p("move 100 usdc to base").command.kind !== "bridge", p("move 100 usdc to base").status);

  console.log("\n— how much <token> do i have is a portfolio read —");
  for (const t of ["how much usdc do i have", "how much eth do i own", "how much kld have i got", "how much do i hold"]) {
    check(`'${t}' is a portfolio read`, p(t).status === "ok" && p(t).command.kind === "portfolio", p(t).status === "ok" ? p(t).command.kind : p(t).status);
  }
  /* "how much" of an ACTION is still its verb, and a how-to is still a question. */
  check("'how much usdc should i swap' is not a portfolio read", p("how much usdc should i swap").status !== "ok" || p("how much usdc should i swap").command.kind !== "portfolio", p("how much usdc should i swap").status);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
