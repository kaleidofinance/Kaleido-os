/**
 * A read's identity, for deduplicating tool calls within one turn.
 *
 * Its own module rather than a helper inside agent.ts, because agent.ts imports
 * the `./index` barrel — the providers, the tool catalog, every read tool — and
 * pulling that in to compare two strings makes the function untestable in
 * isolation. This file imports nothing.
 *
 * Object keys are sorted because the key is compared, never displayed, and two
 * calls that differ only in the order the model happened to emit `address` and
 * `chainId` are the same question. `JSON.stringify`'s own array-replacer form
 * would sort the top level but then apply that same allowlist to every nested
 * object, dropping nested arguments and collapsing two different questions into
 * one key — hence walking the value by hand.
 *
 * Array order is kept, because position in an array carries meaning where key
 * order does not: a route USDC→KLD is not the route KLD→USDC.
 *
 * "No arguments" has three spellings — absent, `null`, and `{}` — and none of
 * them narrows the question, so all three key to the bare tool name. Without
 * that, a no-argument read like getChains asked for once with `{}` and once with
 * nothing at all would run twice and defeat the point.
 */

const isEmptyArgs = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 0);

const stableKey = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableKey).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`)
    .join(",")}}`;
};

export const readKey = (name: string, args: unknown) =>
  `${name}${isEmptyArgs(args) ? "" : stableKey(args)}`;
