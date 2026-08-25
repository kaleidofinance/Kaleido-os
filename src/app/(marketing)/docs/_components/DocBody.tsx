import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

import { resolveDocLink, slugify } from "../docs";
import s from "../docs.module.css";

/**
 * The allow-list. GitHub's default, minus nothing, plus one checkbox attribute.
 *
 * The reasoning differs from src/components/v2/Answer.tsx, which uses the same
 * pipeline against the same schema and drops `img`. It drops it because its text
 * came out of a language model, and an image tag is the one element that fetches a
 * URL without being clicked — so a model could hand a third-party server the
 * reader's IP. This content is markdown in our own repository, reviewed in pull
 * requests, so that threat is absent and an image in a document should render.
 *
 * (None of the four published files contains one today. `img` is allowed anyway,
 * because the alternative is that the first architecture diagram somebody adds
 * renders as nothing and the reason why is three files away.)
 *
 * `input` is kept for the same reason Answer keeps it: the default schema pins
 * every `input` to `type="checkbox" disabled`, which is exactly what remark-gfm
 * emits for a task list and cannot be anything else. `checked` is added back
 * because the default omits it, which silently turns every completed item in a
 * task list into an unchecked one — a rendering that states the opposite of what
 * was written.
 *
 * The clause that matters most is one this file does not write:
 * `defaultSchema.protocols.href`, which allows http, https and mailto and drops
 * everything else. `[click me](javascript:…)` is a link markdown can build out of
 * plain text with no HTML involved, so it survives every other guard on this path
 * — including `resolveDocLink`, which deliberately passes such a href through
 * untouched rather than laundering it into something that looks safe.
 *
 * There is no `rehype-raw`, so raw HTML in a document stays escaped rather than
 * being rendered. That is a default, not a setting, and it is the first line of
 * defence; sanitize runs anyway so the guarantee survives someone adding raw-HTML
 * support later for a legitimate reason without reading this comment.
 */
const SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ["checked", true] as [string, boolean],
    ],
  },
};

/** Flattens a heading's children back to text, so its slug can be matched. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * A document's body.
 *
 * ---------------------------------------------------------------------------
 * HEADING IDS COME FROM `components`, NOT FROM A REHYPE PLUGIN
 * ---------------------------------------------------------------------------
 * `rehype-slug` is the usual answer and it is the wrong one here, for a reason
 * that is purely about ordering: a rehype plugin runs in the same pass as
 * `rehype-sanitize`, and whether the `id` it adds survives depends on plugin
 * order and on `id` being in the allow-list. `components` runs afterwards, on the
 * React side, so an id set here cannot be stripped by anything.
 *
 * It also means the ids and the table of contents come from ONE source. The TOC is
 * built by `scanHeadings` from the markdown text before rendering; this component
 * re-derives each slug from the rendered heading with the same `slugify` and the
 * same occurrence counter. Two implementations of "what is this heading's anchor"
 * would drift, and the symptom would be a contents entry that scrolls nowhere.
 *
 * ---------------------------------------------------------------------------
 * THE OCCURRENCE COUNTER IS MUTABLE STATE IN A RENDER, WHICH IS FINE HERE
 * ---------------------------------------------------------------------------
 * `seen` is a plain Map closed over by the overrides, incremented as react-markdown
 * walks the tree. That is safe because this is a server component rendered once per
 * build with no hydration, no re-render and no concurrency — the walk happens
 * exactly once, in document order. It would be a bug in a client component, so the
 * `Map` is created inside the function rather than at module scope: a module-level
 * counter would accumulate across every page in the same build and give the second
 * document's first `## Overview` the id `overview-1`.
 */
export default function DocBody({
  markdown,
  file,
}: {
  markdown: string;
  file: string;
}) {
  const seen = new Map<string, number>();

  /** The same id `scanHeadings` computed for this heading. */
  const idFor = (children: ReactNode): string => {
    const base = slugify(textOf(children)) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };

  const heading = (Tag: "h2" | "h3" | "h4") =>
    function Heading({ children }: { children?: ReactNode }) {
      const id = idFor(children);
      return (
        <Tag id={id}>
          {children}
          {/* aria-hidden with a tabindex of -1 would hide it from everyone;
              labelled instead, so a screen reader announces what it links to
              rather than reading out "number sign". */}
          <a
            href={`#${id}`}
            className={s.hAnchor}
            aria-label={`Link to this section: ${textOf(children)}`}
          >
            #
          </a>
        </Tag>
      );
    };

  return (
    <div className={s.md}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SCHEMA]]}
        components={{
          h2: heading("h2"),
          h3: heading("h3"),
          h4: heading("h4"),

          /* Every link is rewritten. These files were written for GitHub's file
             browser and cross-reference each other with paths like
             `./guides/README.md`, every one of which 404s on a web page — see
             resolveDocLink.

             Internal links get no `target` and no `rel`: they stay in the tab and
             stay crawlable. That is the opposite of Answer.tsx, which forces
             `target="_blank" rel="noopener noreferrer nofollow"` onto every link
             because a model wrote it. `nofollow` on our own documentation would
             tell search engines not to follow the docs site's own navigation. */
          a({ href, title, children }) {
            const link = resolveDocLink(href ?? "", file);
            return (
              <a
                href={link.href}
                title={title}
                {...(link.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {children}
              </a>
            );
          },

          /* A fenced block, with its language as a label. react-markdown hands
             `pre` a single `code` child carrying `language-*` from the fence's
             info string, which is the only place that language is available —
             the `code` override cannot tell a fence from an inline span without
             it, and this wrapper needs it anyway. */
          pre({ children }) {
            const child = children as
              { props?: { className?: string } } | undefined;
            const lang = /language-([\w+-]+)/.exec(
              child?.props?.className ?? "",
            )?.[1];
            return (
              <div className={s.code}>
                {lang && <span className={s.codeLang}>{lang}</span>}
                <pre>{children}</pre>
              </div>
            );
          },

          /* Markdown has no syntax for a scroll box, so it is supplied here. The
             deployment map is almost entirely tables and one of them is four
             columns wide with a sentence in the last. */
          table({ children }) {
            return (
              <div className={s.tableWrap}>
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
