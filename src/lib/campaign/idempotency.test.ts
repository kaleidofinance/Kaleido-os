// Checks on the batch idempotency key. Run with plain node (tsx).
//
// This key decides what the email provider treats as "the same request I already
// accepted". It exists to make a retry after a lost response safe, and it broke a
// real send by making a retry after a COPY EDIT unsafe: the key named only the
// addresses, so re-running a chunk whose message had changed was rejected outright
// with "the request body was modified and doesn't match the original request" —
// every address in the chunk counted as failed, none recorded, and the 5% abort
// tripped on a message that was perfectly fine.
//
// So the two properties below are opposites and both are load-bearing. Same
// message and same recipients must produce the SAME key, or a timed-out request
// gets delivered twice. Any change to either must produce a DIFFERENT key, or a
// legitimate resend is refused. The rest of the checks are about the ways a hash
// over concatenated strings can quietly fail to notice a change.
import {
  KEY_MAX_LENGTH,
  idempotencyKey,
  messageFingerprint,
  recipientsFingerprint,
  type MessageParts,
} from "./idempotency.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/* Shaped like the real thing, including an access code in both parts, because one
   of the checks is that the code does not survive into the header. */
const CODE = "ZX7Q4M";
const message: MessageParts = {
  from: "Kaleido <official@kaleidofi.xyz>",
  replyTo: "official@kaleidofi.xyz",
  subject: "Your Kaleido testnet access code",
  text: `Here is your access code.\n\n    ${CODE}\n\nOpen https://app.kaleidofi.xyz/trade/agent and enter it once.\n`,
  html: `<p>${CODE}</p><p><a href="https://app.kaleidofi.xyz/trade/agent">Open the app</a></p>`,
};
const chunk = ["ada@gmail.com", "bo@gmail.com", "cy@proton.me"];

const edited = (over: Partial<MessageParts>): MessageParts => ({ ...message, ...over });

console.log("\nthe key is stable, so a retry dedupes");
{
  check(
    "same message and same chunk produce the same key",
    idempotencyKey(message, chunk) === idempotencyKey(message, chunk),
  );
  /* Same inputs rebuilt from scratch, not the same object — the digest must depend
     on the values, not on identity or iteration order of a shared reference. */
  check(
    "the key depends on values, not on object identity",
    idempotencyKey({ ...message }, [...chunk]) === idempotencyKey(message, chunk),
  );
}

console.log("\nthe key changes when the message changes, so an edited resend is not refused");
{
  /* The exact edit that produced the failure: the app link moved host and path. */
  const before = message;
  const after = edited({
    text: message.text.replace("app.kaleidofi.xyz/trade/agent", "kaleidofi.xyz/trade/agent"),
    html: message.html.split("app.kaleidofi.xyz/trade/agent").join("kaleidofi.xyz/trade/agent"),
  });
  check(
    "changing the app link changes the key",
    idempotencyKey(before, chunk) !== idempotencyKey(after, chunk),
    "this is the case that broke a real send",
  );

  /* Each field separately. A fingerprint that ignores any one of them would let a
     changed message reuse a spent key, which the provider rejects — so an omission
     here is not a cosmetic gap, it is the same outage. */
  for (const [field, value] of [
    ["from", "Kaleido <hello@kaleidofi.xyz>"],
    ["replyTo", "support@kaleidofi.xyz"],
    ["subject", "Your Kaleido testnet access code (resend)"],
    ["text", `${message.text}PS.\n`],
    ["html", `${message.html}<p>PS.</p>`],
  ] as Array<[keyof MessageParts, string]>) {
    check(
      `changing ${field} changes the fingerprint`,
      messageFingerprint(message) !== messageFingerprint(edited({ [field]: value })),
    );
  }

  /* A new access code is a new message, and the code appears only inside the body. */
  check(
    "changing the access code changes the key",
    idempotencyKey(message, chunk) !==
      idempotencyKey(
        edited({
          text: message.text.replace(CODE, "AAAA11"),
          html: message.html.replace(CODE, "AAAA11"),
        }),
        chunk,
      ),
  );

  /* The failure mode of joining fields with a separator that can occur in the
     content: an edit shifts a boundary and the concatenation is unchanged. With a
     one-character separator these two hash the same; length-prefixed they do not. */
  check(
    "a change that only moves a field boundary still changes the fingerprint",
    messageFingerprint(edited({ subject: "ab", text: "c" })) !==
      messageFingerprint(edited({ subject: "a", text: "bc" })),
    "fields must be delimited unambiguously",
  );
}

console.log("\nthe key changes when the recipients change");
{
  check(
    "a different address changes the key",
    idempotencyKey(message, chunk) !==
      idempotencyKey(message, ["ada@gmail.com", "bo@gmail.com", "dee@gmail.com"]),
  );
  /* The old key was `${chunk[0]}-${chunk.length}`, which cannot see this: same
     first address, same count, one member swapped. That is reachable in practice —
     a partial per-address failure in an earlier run changes who is pending without
     changing either. */
  check(
    "same first address and same length but different membership changes the key",
    recipientsFingerprint(["ada@gmail.com", "bo@gmail.com", "cy@proton.me"]) !==
      recipientsFingerprint(["ada@gmail.com", "bo@gmail.com", "zed@proton.me"]),
  );
  check(
    "a shorter chunk changes the key",
    recipientsFingerprint(chunk) !== recipientsFingerprint(chunk.slice(0, 2)),
  );
  /* Order-sensitive on purpose: the request body is an array, so a reordered chunk
     is a different body and the provider would reject it under a shared key. */
  check(
    "reordering the chunk changes the key",
    recipientsFingerprint(chunk) !== recipientsFingerprint([...chunk].reverse()),
  );
  /* Adjacent addresses must not be able to run together into the same digest. */
  check(
    "two addresses do not merge into one",
    recipientsFingerprint(["ab@x.com", "c@x.com"]) !== recipientsFingerprint(["a@x.com", "bc@x.com"]),
  );
}

console.log("\nthe key is safe to put in a header");
{
  /* 254 characters is the longest address the form could hand us, and 100 of them
     is a full chunk. An address-bearing key breaks the provider's 256-character cap
     on exactly this input; a hashed one cannot. */
  const longest = `${"a".repeat(254 - "@example.com".length)}@example.com`;
  const fullChunk = Array.from({ length: 100 }, (_, i) => `${i}${longest}`.slice(0, 254));
  const key = idempotencyKey(message, [longest, ...fullChunk]);
  check(
    `a 101-address chunk of 254-character addresses stays under ${KEY_MAX_LENGTH} characters`,
    key.length <= KEY_MAX_LENGTH,
    `got ${key.length}`,
  );
  check("the key length does not depend on the input at all", key.length === idempotencyKey(message, ["a@b.co"]).length);
  check("the access code does not appear in the key", !key.includes(CODE));
  check("no recipient address appears in the key", !key.includes("@"));
  /* It travels as an HTTP header value, so anything outside the printable ASCII
     range would have to be encoded and could be mangled in transit. */
  check("the key is printable ASCII only", /^[\x21-\x7e]+$/.test(key), key);
  check("the key is identifiable as this campaign's", key.startsWith("kaleido-invite-"));
}

console.log("\nedge cases that must not throw");
{
  const empty: MessageParts = { from: "", replyTo: "", subject: "", text: "", html: "" };
  check("an empty message still fingerprints", messageFingerprint(empty).length === 12);
  check("an empty chunk still fingerprints", recipientsFingerprint([]).length === 12);
  /* An empty chunk is never sent — the caller returns before this — but an empty
     digest colliding with a single empty address would be a silent surprise. */
  check(
    "an empty chunk differs from a chunk holding one empty string",
    recipientsFingerprint([]) !== recipientsFingerprint([""]),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
