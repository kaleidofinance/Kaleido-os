/**
 * Turning a form export into a list of people to mail.
 *
 * Extracted from `scripts/send_campaign.mts` so it can be tested, which it needs to
 * be: this is the code that decides who receives the testnet access code and who
 * silently does not. Every rule below either includes someone or drops them, and a
 * rule that drops the wrong people fails quietly — the run reports a smaller number
 * and nothing says the number is wrong.
 *
 * That is not hypothetical. The first version of this dropped 32 of 3,165
 * registrations as "invalid" because they had answered the form's *Username*
 * question with their email address and the *Email Address* question with "yes",
 * "ok", or a wallet address. Username is asked first and sits directly above, so
 * they answered it with the thing they were about to be asked for. The count landed
 * in a column labelled invalid, as though the data were at fault.
 *
 * Nothing here does network I/O or touches the filesystem, so the test is a string
 * in and a list out.
 */

/**
 * Deliberately not RFC 5322.
 *
 * That grammar accepts addresses no provider will deliver to, and the job here is
 * not to decide what is legal but to decide what will bounce: every address failing
 * this is a near-certain hard bounce, and hard bounces are what sending reputation
 * is scored on. Local parts keep `+` and `.` untouched, because plus-addressing is
 * how a large minority of a crypto mailing list signs up and stripping it would mail
 * a different mailbox than the one someone typed.
 */
const EMAIL_RE =
  /^[^\s@,;"'<>()[\]\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Shared inboxes, dropped.
 *
 * Several people read them, most of those people did not sign up, and they generate
 * complaints out of all proportion to their number. A complaint rate is measured
 * against the domain the app itself runs on, so this is cheap insurance.
 */
const ROLE_LOCALS = new Set([
  "admin",
  "administrator",
  "billing",
  "contact",
  "help",
  "info",
  "mail",
  "marketing",
  "noreply",
  "no-reply",
  "office",
  "postmaster",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

/** True when the whole cell is an address — not when it merely contains one. */
export function isDeliverable(cell: string): boolean {
  return EMAIL_RE.test(cell.trim().toLowerCase());
}

/** True for a local part that belongs to a shared inbox rather than a person. */
export function isRoleAddress(address: string): boolean {
  const at = address.indexOf("@");
  return at > 0 && ROLE_LOCALS.has(address.slice(0, at));
}

/**
 * Enough CSV to survive a Google Forms export.
 *
 * Quoted fields, commas inside them, doubled quotes as an escape, CRLF, and — the
 * one that actually matters — newlines inside a quoted free-text answer. A
 * line-splitting parser reads one such answer as several broken rows, which shifts
 * every column and silently mangles the addresses rather than failing.
 *
 * Rows where every cell is blank are dropped, because an export that ends with a
 * trailing newline otherwise yields a final empty row that counts as a registration.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  /* A file with no trailing newline still has a last row. */
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type ListStats = {
  /** Data rows, excluding the header and excluding wholly blank rows. */
  rows: number;
  /** Rows whose address was found in a column other than the email one. */
  recovered: number;
  /** Rows with no usable address anywhere. Includes `ambiguous`. */
  unusable: number;
  /** Rows offering two different addresses, so which one is theirs is unknowable. */
  ambiguous: number;
  /** Dropped as a shared inbox. */
  role: number;
  /** Dropped because the address was already collected. */
  duplicate: number;
};

export type CleanedList = {
  /** Deduplicated, lower-cased, in first-seen order. */
  recipients: string[];
  stats: ListStats;
  header: string[];
  emailColumn: number;
  /**
   * True when no header mentioned email and the column was inferred from content.
   * The caller should say so, since a wrong guess is the one failure that produces a
   * plausible-looking list of the wrong people.
   */
  emailColumnGuessed: boolean;
};

/** How many cells in a column are entirely an address. */
function addressCount(rows: string[][], column: number): number {
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    if (isDeliverable(rows[r][column] ?? "")) n++;
  }
  return n;
}

/**
 * Which column holds the addresses.
 *
 * Header first, but *scored*, not simply the first match. A form can easily carry
 * both "Email Address" and "Would you like email updates?", and taking the first
 * header that mentions email would then pick a column of yes/no answers and report
 * almost every registration as invalid. Whichever email-ish column actually holds
 * the most addresses is the one meant.
 *
 * With no email-ish header at all, every column is scored the same way — Forms names
 * the column after the question, so it is "Email Address" on one export and "Where
 * should we send your code?" on the next.
 *
 * Widths come from the widest row rather than the header, since a row may carry more
 * cells than the header does and the addresses could be in one of them.
 */
export function findEmailColumn(rows: string[][]): { column: number; guessed: boolean } {
  if (rows.length < 2) throw new Error("the list has a header but no data rows");

  const width = Math.max(...rows.map((r) => r.length));
  const header = rows[0];

  const named: number[] = [];
  for (let c = 0; c < width; c++) {
    const h = (header[c] ?? "").trim().toLowerCase();
    if (h.includes("email") || h.includes("e-mail")) named.push(c);
  }

  const best = (candidates: number[]) => {
    let column = -1;
    let score = 0;
    for (const c of candidates) {
      const n = addressCount(rows, c);
      if (n > score) {
        score = n;
        column = c;
      }
    }
    return { column, score };
  };

  const byName = best(named);
  if (byName.column >= 0) return { column: byName.column, guessed: false };

  const all = Array.from({ length: width }, (_, c) => c);
  const byContent = best(all);
  if (byContent.column >= 0) return { column: byContent.column, guessed: true };

  throw new Error("no column in the list looks like email addresses");
}

/**
 * Clean a form export into the people to mail.
 *
 * Order is load-bearing in two places.
 *
 * Recovery runs before deduplication, because a recovered address can duplicate one
 * already collected from another row — that happened once in the real export, and
 * deduplicating first would have let it through as a second copy.
 *
 * Output keeps first-seen order rather than sorting. The sender walks it in order and
 * writes progress to a state file, so a stable order is what makes `--limit` batches
 * resumable: a different order between runs would re-mail some people and skip others.
 */
export function cleanList(csvText: string): CleanedList {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("the list has a header but no data rows");

  const { column: emailColumn, guessed } = findEmailColumn(rows);

  const stats: ListStats = {
    rows: rows.length - 1,
    recovered: 0,
    unusable: 0,
    ambiguous: 0,
    role: 0,
    duplicate: 0,
  };
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    let address = (row[emailColumn] ?? "").trim().toLowerCase();

    /* The email box does not hold an address. Before giving up on the person, look
       at the rest of their row — only cells that are ENTIRELY an address, so a
       free-text answer that merely mentions one cannot be mistaken for theirs, and
       only when the row offers exactly one distinct address, because two different
       ones leave no way to tell which is theirs. Two cells holding the SAME address
       is not ambiguous, it is someone who answered twice. */
    if (!EMAIL_RE.test(address)) {
      const elsewhere = [
        ...new Set(
          row.map((cell) => cell.trim().toLowerCase()).filter((cell) => EMAIL_RE.test(cell)),
        ),
      ];
      if (elsewhere.length === 1) {
        address = elsewhere[0];
        stats.recovered++;
      } else {
        if (elsewhere.length > 1) stats.ambiguous++;
        stats.unusable++;
        continue;
      }
    }

    if (isRoleAddress(address)) {
      stats.role++;
      continue;
    }
    if (seen.has(address)) {
      stats.duplicate++;
      continue;
    }
    seen.add(address);
    recipients.push(address);
  }

  return { recipients, stats, header: rows[0], emailColumn, emailColumnGuessed: guessed };
}
