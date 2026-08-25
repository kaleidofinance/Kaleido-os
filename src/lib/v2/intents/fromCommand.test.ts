// Adversarial checks on the command grammar. Run with plain node — no test
// runner in this repo, and no runtime imports here, same as accrual.test.ts.
//
// The bias under test is deliberate: this parser guards money, so every
// ambiguous case must fall through to "unknown" (escalate to a model) or
// "incomplete" (ask the user). Silently guessing an amount or a token is the
// one outcome that must never happen.
import { parseCommand, fillSlot, completeDraft } from "./fromCommand.ts";

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

console.log("\n— swap grammar is unaffected by the new verbs —");
check("swap still parses", p("swap 500 usdc to kld").status === "ok");
check("'sell' still routes to swap", p("sell 5 kld for usdc").status === "ok");

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

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
