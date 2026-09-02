/**
 * Shared vocabulary for the private-testnet access gate.
 *
 * Four constants and one function, in their own module because they are read
 * from three places that cannot import each other: the route handler that
 * verifies a code on the server, the client component that collects one, and
 * the blocking inline script in the app layout that decides — before first
 * paint — whether the shell renders blurred. That script is a string, so it
 * interpolates these rather than importing them; keeping the values here is
 * what stops the storage key in the script from drifting from the one the
 * component writes.
 *
 * Nothing in this file may reach for `node:crypto` or the DOM. It is imported
 * by a route handler and by a client component, so it has to be usable in both.
 */

/**
 * Characters in an access code.
 *
 * Six, and it was asked for as a "6 digit code" — but the code actually issued is
 * alphanumeric, so this is a character count and not a digit count, and the input
 * accepts A–Z alongside 0–9. A numeric-only input would reject the real code;
 * do not narrow it back to digits on the strength of the phrasing.
 *
 * The code itself was quoted here as the illustration for that, and has been
 * removed. This repository is public, so a code in a comment is readable on GitHub
 * without even loading the app — which walks past the gate the code exists to be,
 * and it does so more cheaply than the bundle inlining that the route handler below
 * is careful to avoid. The value lives in `BETA_ACCESS_CODE` and nowhere else.
 */
export const CODE_LENGTH = 6;

/** localStorage key holding the unlocked flag. */
export const STORAGE_KEY = "kaleido-beta";

/** The only value that counts as unlocked, in storage and in the attribute. */
export const OPEN_VALUE = "open";

/**
 * Attribute set on `<html>` once unlocked.
 *
 * The visual state is driven off this rather than off React state, so that a
 * returning visitor never sees the app flash unblurred (or blurred) between
 * hydration and the first effect. `<html>` already carries
 * `suppressHydrationWarning` for the theme script, which is what makes writing
 * an attribute there before React boots safe.
 */
export const HTML_ATTR = "data-beta";

/**
 * Id on the wrapper holding the app. The gate marks it `inert` while locked, so
 * Tab cannot walk into the blurred page behind the card.
 */
export const SHELL_ID = "k-app-shell";

/**
 * Upper-cases and drops everything that is not A–Z or 0–9.
 *
 * Applied on both sides of the comparison, so a code typed with a space, a
 * dash, or in lower case still matches, and so does one pasted out of an email
 * client that added a trailing newline. Deliberately does NOT truncate to
 * `CODE_LENGTH`: the server needs to see the real length of a configured code
 * to tell the operator it is the wrong length, and silently slicing it would
 * turn that misconfiguration into "every code is wrong".
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
