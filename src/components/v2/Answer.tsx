import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import s from "./Answer.module.css";

/**
 * The allow-list, GitHub's default minus images plus one checkbox attribute.
 *
 * `img` goes because a model can write any URL it likes, and an image tag is the
 * one element that *fetches* one without being clicked: rendering it would hand a
 * third-party server the reader's IP and a confirmation that they opened the
 * message. Nothing Kaleido replies with contains an image — the frames Luca uses
 * to show data are AgentCards, which are React and never come through here.
 *
 * `input` stays, on purpose: the default schema pins it to
 * `type="checkbox" disabled`, which is exactly what remark-gfm emits for a task
 * list and cannot be anything else. `checked` is added back because the default
 * omits it, which silently turns every completed item in a task list into an
 * unchecked one — a rendering that states the opposite of what was written.
 * Allowed only as `true`, and the box is disabled either way, so it reports state
 * and cannot carry any.
 *
 * The clause that matters most is one this file does not write — the default
 * schema's `protocols.href`, which allows http, https, mailto and three chat
 * protocols, and drops everything else. `[click me](javascript:…)` is a link
 * markdown can build out of plain text, with no HTML involved, so it survives
 * every other guard on this path.
 */
const SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== "img"),
  attributes: {
    ...defaultSchema.attributes,
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ["checked", true] as [string, boolean],
    ],
  },
};

/**
 * Luca's reply, rendered as markdown.
 *
 * It used to be `<div>{text}</div>` with `white-space: pre-wrap`, which meant
 * every backtick, asterisk and pipe the model wrote landed on screen as itself.
 * The visible bug was /api/chat's own suggestion — it offers
 * "`swap 500 USDC to KLD`" as a code span, and the card printed the backticks —
 * but the same held for every list, table and emphasis in a reasoning answer.
 * Markdown is the format the model is writing in whether or not we parse it; not
 * parsing it doesn't make the answer plain text, it makes it plain text with
 * punctuation errors.
 *
 * No `rehype-raw`, so raw HTML in a reply stays escaped rather than rendered —
 * that is the first line of defence and it is a default, not a setting. Sanitize
 * runs anyway: it covers what markdown can construct on its own (see SCHEMA), and
 * it keeps the guarantee if someone later adds raw-HTML support for a legitimate
 * reason and doesn't think about this file.
 */
export default function Answer({ text }: { text: string }) {
  return (
    <div className={s.md}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SCHEMA]]}
        components={{
          /* Explicit props rather than `{...props}`: the spread would carry
             react-markdown's own `node` onto the DOM element. `nofollow` because
             this destination came out of a model, and `noreferrer` so the page
             the user is reading isn't announced to it. */
          a({ href, title, children }) {
            return (
              <a
                href={href}
                title={title}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {children}
              </a>
            );
          },
          /* A table needs a scroll box around it, and markdown has no syntax for
             one — so it is supplied here. Without it a four-column table sets its
             own width and takes the whole card with it, which on a surface that is
             already at `max-width: 520px` means the transcript widens and the
             layout breaks around one reply. */
          table({ children }) {
            return (
              <div className={s.tableWrap}>
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
