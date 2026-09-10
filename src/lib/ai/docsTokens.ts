/**
 * The one tokenizer the docs index and the docs search share.
 *
 * Its own module with no imports, because it has to be imported from two
 * directions that would otherwise be circular: the generator builds the index
 * from it, and the search reads the index back through it. If those two ever
 * tokenized differently the index would be full of terms no query could
 * produce, and the search would look at a correct index and see nothing.
 *
 * Deliberately short stop list. A longer one is tempting and wrong here: drop
 * "fee", "rate" or "gas" as noise and the index goes blind on exactly the
 * questions it exists to answer.
 */
const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its of on or that the this to was what when where which who why will with you your"
    .split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%.]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
}
