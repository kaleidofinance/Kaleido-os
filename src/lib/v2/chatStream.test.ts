/*
 * Checks on the chat stream reader. Run with
 * `npx tsx src/lib/v2/chatStream.test.ts`.
 *
 * WHY THIS SUITE EXISTS. Every bug this file can have is invisible until the
 * reply is long enough to be interesting, and by then it is in front of a user.
 *
 * A network chunk is not a frame. `reader.read()` hands over whatever arrived,
 * which is regularly six frames at once, or half of one split mid-JSON, and the
 * naive parser — `JSON.parse` per chunk — works perfectly on every short test
 * reply and then drops a sentence out of the middle of a real one. There is no
 * type that catches it and no way to notice it by eye, because the text still
 * reads plausibly with a clause missing.
 *
 * The ordering half matters for the same reason. Text is batched so React renders
 * once per chunk rather than once per token; a batch that is not flushed before
 * the frame that ends its round appears above the thinking it came after, i.e.
 * the transcript shows the answer before the work.
 *
 * The chunk boundaries below are deliberately hostile — split inside a key, a
 * value, and one byte before the newline — because those are the splits a real
 * socket makes and none of them are choices the client controls.
 *
 * Everything runs inside main(): this repo has no `type: module`, so tsx compiles
 * a .ts suite as CJS and top-level await is a transform error, not a runtime one.
 */
import {
  readChatStream,
  condenseNote,
  MAX_THINKING_LINE,
} from "./chatStream.ts";

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

/* A body that delivers exactly these chunks, in this order — the point being
   that the reader never sees where a frame begins or ends. */
const streamOf = (chunks) => {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
};

/* Records what a caller would see, including how the text was batched: `texts`
   keeps one entry per onText call, so a suite can assert both the reassembled
   string and the number of renders it took. */
const collect = () => {
  const log = [];
  const texts = [];
  return {
    log,
    texts,
    get text() {
      return texts.join("");
    },
    handlers: {
      onText: (t) => {
        texts.push(t);
        log.push(`text:${t}`);
      },
      onRound: (note, reads) => {
        log.push(`round:${note ?? "-"}:${reads.map((r) => r.name).join(",")}`);
      },
      onDone: (response, context) => {
        log.push(`done:${response}`);
        log.push(`status:${context?.status ?? "-"}`);
      },
      onError: (response, context) => {
        log.push(`error:${response}:${context?.status ?? "-"}`);
      },
    },
  };
};

const frame = (obj) => `${JSON.stringify(obj)}\n`;

async function main() {
  console.log("\n— a frame split across chunks —");
  {
    /* The whole reason this module exists. Cuts inside a key, inside a value,
       and one byte before the newline. */
    const whole = frame({ t: "text", d: "Your USDC sits on Base." });
    const c = collect();
    const terminal = await readChatStream(
      streamOf([
        whole.slice(0, 6),
        whole.slice(6, 13),
        whole.slice(13, whole.length - 1),
        whole.slice(whole.length - 1),
        frame({ t: "done", response: "Your USDC sits on Base." }),
      ]),
      c.handlers,
    );
    check(
      "the text survives the cuts",
      c.text === "Your USDC sits on Base.",
      c.text,
    );
    check(
      "a partial frame renders nothing on its own",
      c.texts.length === 1,
      String(c.texts.length),
    );
    check("done is terminal", terminal === true);
    check(
      "the reply is handed over whole",
      c.log.includes("done:Your USDC sits on Base."),
      c.log.join(" | "),
    );
  }

  console.log("\n— many frames in one chunk —");
  {
    const c = collect();
    await readChatStream(
      streamOf([
        frame({ t: "text", d: "a" }) +
          frame({ t: "text", d: "b" }) +
          frame({ t: "text", d: "c" }),
        frame({ t: "done", response: "abc" }),
      ]),
      c.handlers,
    );
    check("all three arrive", c.text === "abc", c.text);
    /* Batched: three frames in one chunk is one render, not three. */
    check(
      "one render for the chunk",
      c.texts.length === 1,
      JSON.stringify(c.texts),
    );
  }

  console.log("\n— text is flushed before the frame that ends its round —");
  {
    const c = collect();
    await readChatStream(
      streamOf([
        /* All in one chunk, so only an explicit flush can get the ordering
           right: batching to the end of the chunk would put the reads above the
           prose they followed. */
        frame({ t: "text", d: "Let me check. " }) +
          frame({
            t: "round",
            note: "Let me check.",
            reads: [{ name: "getPortfolio", args: {} }],
          }) +
          frame({ t: "text", d: "You hold 4,170 USDC." }) +
          frame({ t: "done", response: "You hold 4,170 USDC." }),
      ]),
      c.handlers,
    );
    check(
      "the order is prose, round, prose, reply",
      c.log.join(" | ") ===
        "text:Let me check.  | round:Let me check.:getPortfolio | text:You hold 4,170 USDC. | done:You hold 4,170 USDC. | status:-",
      c.log.join(" | "),
    );
  }

  console.log("\n— a round with no prose —");
  {
    /* The model can go straight to a tool call with nothing said first. `note`
       is absent rather than empty, and no text render should happen at all. */
    const c = collect();
    await readChatStream(
      streamOf([
        frame({
          t: "round",
          reads: [{ name: "getPrice", args: { asset: "KLD" } }],
        }),
        frame({ t: "done", response: "KLD is $0.03." }),
      ]),
      c.handlers,
    );
    check(
      "no empty text render",
      c.texts.length === 0,
      JSON.stringify(c.texts),
    );
    check(
      "the round still reports its reads",
      c.log[0] === "round:-:getPrice",
      c.log[0],
    );
  }

  console.log("\n— a body that ends without a terminal frame —");
  {
    /* A dropped connection. The caller has to be able to tell this from a
       finished turn, because the text it holds is a half-sentence and nothing
       will confirm it. */
    const c = collect();
    const terminal = await readChatStream(
      streamOf([frame({ t: "text", d: "Your position is" })]),
      c.handlers,
    );
    check("reported as not terminal", terminal === false);
    check(
      "the partial text is still delivered",
      c.text === "Your position is",
      c.text,
    );
  }

  console.log("\n— a last frame with no trailing newline —");
  {
    const c = collect();
    const terminal = await readChatStream(
      streamOf([JSON.stringify({ t: "done", response: "done" })]),
      c.handlers,
    );
    check(
      "parsed anyway",
      terminal === true && c.log.includes("done:done"),
      c.log.join(" | "),
    );
  }

  console.log("\n— junk on the wire —");
  {
    const c = collect();
    await readChatStream(
      streamOf([
        "not json at all\n",
        "\n",
        "   \n",
        frame({ t: "text", d: "still here" }),
        frame({ t: "nonsense", d: "ignored" }),
        /* `reads` of the wrong type must not reach a handler that maps over it. */
        frame({ t: "round", note: "x", reads: "getPortfolio" }),
        frame({ t: "done", response: "still here" }),
      ]),
      c.handlers,
    );
    check(
      "an unreadable line loses only itself",
      c.text === "still here",
      c.text,
    );
    check(
      "an unknown frame type is ignored",
      !c.log.some((l) => l.includes("ignored")),
      c.log.join(" | "),
    );
    check(
      "reads that is not an array becomes none",
      c.log.includes("round:x:"),
      c.log.join(" | "),
    );
    check(
      "the turn still completes",
      c.log.includes("done:still here"),
      c.log.join(" | "),
    );
  }

  console.log("\n— an error frame —");
  {
    const c = collect();
    const terminal = await readChatStream(
      streamOf([
        frame({ t: "text", d: "partial" }),
        frame({
          t: "error",
          response: "The model gateway refused that wording",
          context: { status: "provider_blocked" },
        }),
      ]),
      c.handlers,
    );
    check("terminal, like done", terminal === true);
    check(
      "the status comes through",
      c.log.some((l) => l.endsWith(":provider_blocked")),
      c.log.join(" | "),
    );
    /* The prose that arrived before the failure is still handed over — the user
       read it, and deciding what to do with it is the caller's business. */
    check("the partial prose is not swallowed", c.text === "partial", c.text);
  }

  console.log("\n— CRLF line endings —");
  {
    /* Not produced here, but a proxy can rewrite them, and a stray `\r` left on
       the end of a line would make `JSON.parse` fail on every single frame. */
    const c = collect();
    const terminal = await readChatStream(
      streamOf([
        `${JSON.stringify({ t: "text", d: "hi" })}\r\n${JSON.stringify({ t: "done", response: "hi" })}\r\n`,
      ]),
      c.handlers,
    );
    check(
      "survives \\r\\n",
      terminal === true && c.text === "hi",
      c.log.join(" | "),
    );
  }

  console.log("\n— a multi-byte character split down the middle —");
  {
    /* An em dash is three bytes in UTF-8 and Luca writes them constantly. Split
       between byte 1 and byte 2 it decodes to a replacement character unless the
       decoder is told the stream continues. */
    const bytes = new TextEncoder().encode(frame({ t: "text", d: "up—down" }));
    const cut = 20;
    const c = collect();
    await readChatStream(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.close();
        },
      }),
      c.handlers,
    );
    check("the dash is intact", c.text === "up—down", c.text);
    check("no replacement character", !c.text.includes("�"), c.text);
  }

  console.log("\n— condensing a round's prose into a line —");
  {
    check(
      "newlines collapse",
      condenseNote("Let me check\n\n  your balances.") ===
        "Let me check your balances.",
      condenseNote("Let me check\n\n  your balances."),
    );
    check(
      "short prose is untouched",
      condenseNote("Checking.") === "Checking.",
    );
    check("empty stays empty", condenseNote("   \n ") === "");

    const long = condenseNote("x".repeat(900));
    /* MAX_THINKING_LINE is what useChatHistory keeps per thinking line, and it
       drops rather than trims — so a line longer than this would look right
       until the page was reloaded, then vanish. Asserted against the constant,
       not the number, because that is the whole point of exporting it. */
    check(
      `capped at ${MAX_THINKING_LINE}`,
      long.length === MAX_THINKING_LINE,
      String(long.length),
    );
    check("the cap is marked", long.endsWith("…"), long.slice(-3));
    check(
      "a capped line still survives revival",
      long.length <= MAX_THINKING_LINE,
      String(long.length),
    );

    /* No dangling space before the ellipsis when the cut lands on one. */
    const onSpace = condenseNote(`${"y".repeat(158)} tail`, 160);
    check(
      "no space before the ellipsis",
      !onSpace.includes(" …"),
      JSON.stringify(onSpace.slice(-6)),
    );
  }

  console.log("\n— markdown does not reach the trace line —");
  {
    /* The line that prompted this: a real round's preamble, which reached the
       screen with its bullets and asterisks intact because the trace renders as
       text and the prose was written to be rendered as an answer. */
    const real = condenseNote(
      "On Sepolia (chain 11155111), the portfolio read comes back essentially" +
        " empty:\n- **Lending collateral:** $0\n- **Debt:** none",
    );
    check("no asterisks survive", !real.includes("*"), real);
    check("no bullet markers survive", !/(?:^|\s)-\s/.test(real), real);
    check(
      "the words are all still there",
      real.includes("Lending collateral: $0") && real.includes("Debt: none"),
      real,
    );

    const cases: [string, string, string][] = [
      ["strong", "**Debt:** none", "Debt: none"],
      ["emphasis", "that is *not* a balance", "that is not a balance"],
      ["inline code", "run `swap 500 USDC`", "run swap 500 USDC"],
      ["heading", "## Your position", "Your position"],
      ["blockquote", "> nothing came back", "nothing came back"],
      ["ordered list", "1. read it\n2. priced it", "read it priced it"],
      ["link keeps its label", "see [the docs](https://x.y/z)", "see the docs"],
      ["strikethrough", "~~$400~~ now $0", "$400 now $0"],
      ["underscore emphasis", "_roughly_ $0", "roughly $0"],
    ];
    for (const [name, input, want] of cases) {
      const got = condenseNote(input);
      check(`${name}: ${JSON.stringify(input)}`, got === want, got);
    }

    /* An identifier is not emphasis. This one is load-bearing: the system
       prompt states the user's limits, so a round's prose can quote one back. */
    check(
      "an underscored identifier is left alone",
      condenseNote("kept min_health_factor above 1.5") ===
        "kept min_health_factor above 1.5",
      condenseNote("kept min_health_factor above 1.5"),
    );

    /* A fenced block goes whole. Flattening it would put code in the middle of
       a sentence, and a trace line is not where anyone reads code. */
    check(
      "a fenced block is dropped, not flattened",
      condenseNote("I would run:\n```\nsome code\n```\nthen check.") ===
        "I would run: then check.",
      condenseNote("I would run:\n```\nsome code\n```\nthen check."),
    );

    /* The cap counts what is visible, so markdown cannot spend it. */
    const marked = condenseNote(`**${"z".repeat(900)}**`);
    check(
      "the cap counts visible characters",
      marked.length === MAX_THINKING_LINE,
      String(marked.length),
    );
    check(
      "and the syntax is gone first",
      !marked.startsWith("*"),
      marked.slice(0, 4),
    );
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
