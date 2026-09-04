"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ToolTrace } from "./traces";
import s from "./TracePlayer.module.css";

/**
 * Replays one capability as the chat turn it actually is.
 *
 * WHAT THIS IS. Not a video, not a screen recording, and not authored copy
 * dressed up as a transcript. Every string it types and every string Luca says
 * back was built on the server by the product's own code — see traces.ts, which
 * parses the sentence with `parseCommand` and plans it with `buildIntents`, so on
 * 21 of the 24 execute tools the reply is literally `built.build.summary`, the
 * same expression agent/page.tsx:271 hands to `say()`. What is animated is the
 * *clock*: the keystrokes, the wait, and the order things land in. The content is
 * fixed before this component mounts.
 *
 * WHY IT MIRRORS /trade/agent RATHER THAN INVENTING A CHAT UI. The section claims
 * "this is what the product does when you ask", and a visitor checks that by
 * opening the app. If the mock and the app disagree about what a turn looks like,
 * the mock is the one that gets believed first and disproved second. So the
 * labels ("You" / "Luca"), the ↻ spinner, the ■ that replaces ↑ while a turn is
 * in flight, the "Direct" tag and its tooltip, the placeholder, the 22px step
 * markers and the "Review and sign · N transactions" button are all lifted from
 * agent/page.tsx and agent.module.css. The four places this departs from the app
 * are commented at their sites, here and in the stylesheet.
 *
 * THE APP'S LINE UNDER THE PLAN IS NOT HERE, and it was dropped for what it argues
 * rather than for the space. The app prints "Each step is a separate signature.
 * Nothing runs until you approve it, and a failure stops the rest." under a plan,
 * which is right *inside* the product — someone about to sign is asking exactly
 * that. On the front door it argues the wrong thing: it frames Kaleido as an agent
 * that is safe because it cannot move money by itself, when the claim is the tech.
 * `#start`'s third step already says "Sign" and the architecture section carries
 * the mandate. It was also two lines of 13px fine print — about 39 rendered px
 * inside the `zoom`ed panel — which is the other thing fine print costs.
 *
 * NOTHING HERE IS INTERACTIVE, and that is a claim about the page as much as a
 * design choice. The composer is a `div` with a text node in it, the send button
 * is a `span`, and the plan CTA opens nothing; the whole composer is
 * `aria-hidden`, because a screen reader announcing a textbox that cannot be
 * typed into is worse than one that never mentions it. `(marketing)/layout.tsx`
 * keeps this route group away from the wallet stack entirely.
 *
 * THE THREE THINGS THAT WERE FIDDLY, so they do not get "simplified" back out:
 *
 *   1. The height is held by a hidden copy of the finished turn stacked in the
 *      same grid cell — see `.stage` in the stylesheet. A self-playing panel that
 *      grows four rows shoves the rest of the page down while someone is reading
 *      it. The optional `floor` prop stacks a second copy for the same reason at
 *      the next scale up: it holds the height steady across a *change of tool*,
 *      which is what a parent rotating through an inventory does on a timer.
 *   2. The first render is the *finished* turn and a layout effect rewinds it
 *      before the browser paints. The server and the first client render agree,
 *      so there is no hydration mismatch; a visitor with JS off or reduced motion
 *      on gets the whole transcript; and nobody sees a flash of the ending.
 *   3. Playback is armed by an IntersectionObserver, because this section is well
 *      below the fold. Started on mount it would be over before anyone scrolled
 *      to it, which is the same as not having built it.
 *
 * THIS COMPONENT PLAYS ONE TURN AND KNOWS ABOUT NO OTHERS. `onFinished` reports
 * that a turn is over; what plays next is the caller's business. That boundary is
 * why the rotation lives in CapabilityTabs, which owns the selection, and why
 * this file has no notion of an inventory, an order, or a next.
 */

interface Props {
  tool: ToolTrace;
  /**
   * Fired once, `LOOP_HOLD` after the turn reaches `done`, when a clock actually
   * ran. Absent under reduced motion and before the observer arms playback, which
   * is deliberate: a parent driving a rotation off this callback should get no
   * rotation at all for a visitor who asked for no motion, and should not start
   * one for a section still below the fold.
   *
   * Fires again after a Replay press. A visitor who asks to see a turn once more
   * is asking for that, not for the rotation to end — the parent stops rotating
   * when they pick a *different* turn, which is the choice that says "I want this
   * one".
   */
  onFinished?: () => void;
  /**
   * A second turn whose finished height the stage must also reserve. See the
   * `floor` sizer below — this exists so a parent that swaps `tool` on a timer
   * does not resize the card under a reader every few seconds.
   */
  floor?: ToolTrace;
}

/*
 * The turn's phases, in order. Compared by index rather than by equality —
 * "has the transcript got this far" is what every branch below asks, and
 * `phase === "steps"` would hide the steps again the moment it reached done.
 */
const ORDER = ["typing", "thinking", "said", "steps", "done"] as const;
type Phase = (typeof ORDER)[number];

/**
 * The clock, in ms.
 *
 * A total rather than a per-character rate: the prompts run from 5 characters
 * ("repay") to 103 (the delegation grant), and a fixed rate makes one turn feel
 * instantaneous and the other feel stuck. Normalising the line to a fixed
 * duration keeps every tool's turn about the same length, with the bounds so
 * "repay" is not typed in slow motion.
 *
 * THINK_MODEL is longer than THINK_LOCAL on purpose, and it is the one timing
 * here carrying information rather than taste: a local turn is a synchronous
 * parse, a model turn is a round trip to a provider. The gap between the two
 * numbers is the section's argument, so it should be visible.
 */
const TYPE_TOTAL = 1400;
const TYPE_MIN = 13;
const TYPE_MAX = 34;
const SEND_HOLD = 320;
const THINK_LOCAL = 420;
const THINK_MODEL = 1500;
const SAY_HOLD = 460;
const STEP_MS = 520;
const END_HOLD = 320;

/**
 * How long the finished turn stays up before `onFinished` fires.
 *
 * The finished plan is the payoff of the whole animation, so it is the one beat
 * that must not be a transition — everything above it is the clock working
 * towards this frame. It is also the only beat sized for *reading* rather than
 * for feel: two step titles with a detail line each, at 13px inside a 0.75 zoom.
 * Cutting it makes the section flash rather than demonstrate.
 *
 * Only relevant when a parent passes `onFinished`. On its own the player just
 * stops on `done` and this number never gets read.
 */
const LOOP_HOLD = 2600;

const PLACEHOLDER = "Move my idle USDC to the best yield";

/** The plan button's label, verbatim from agent/page.tsx:580. */
const planLabel = (n: number) =>
  `Review and sign · ${n} transaction${n === 1 ? "" : "s"}`;

/** What the turn costs, as a sentence rather than a count to be inferred. */
function costOf(tool: ToolTrace): string {
  if (tool.returns !== undefined) return "Reads only — nothing to sign.";
  const n = tool.steps.length;
  return n === 1 ? "1 transaction to sign." : `${n} transactions to sign.`;
}

/**
 * The declared signature. Required arguments in the catalog's order, then the
 * properties it declares but does not require, marked `?` — capabilities.test.ts
 * asserts both halves against toolCatalog.ts, so this line is checkable.
 */
function signature(tool: ToolTrace): string {
  const parts = [...tool.params, ...(tool.optional ?? []).map((p) => `${p}?`)];
  return `${tool.name}(${parts.join(", ")})`;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One turn at a given point in its playback.
 *
 * The live copy and the hidden copy that sets the height both render through
 * here, differing only in `phase`/`typed`/`shown`, so the two cannot drift apart
 * and reserve the wrong height.
 */
function Turn({
  tool,
  phase,
  typed,
  shown,
}: {
  tool: ToolTrace;
  phase: Phase;
  typed: number;
  shown: number;
}) {
  const at = (p: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(p);
  const sent = at("thinking");
  const busy = phase === "thinking";
  const composed = sent ? "" : tool.prompt.slice(0, typed);

  return (
    <>
      <div className={s.thread}>
        {sent && (
          <div className={`${s.turn} ${s.turnUser}`}>
            <span className={s.who}>You</span>
            <span className={s.said}>{tool.prompt}</span>
          </div>
        )}

        {/* The turn in flight, standing where its answer will appear — the same
            shape the app uses, down to the glyph. This beat is on the local path
            too: agent/page.tsx:302 calls setBusy(true) before it decides which
            path to take, so a direct turn really does show it, briefly. */}
        {busy && (
          <div className={s.turn}>
            <span className={`${s.who} ${s.whoAgent}`}>Luca</span>
            <div className={`${s.said} ${s.thinking}`}>
              <span className={s.spin} aria-hidden="true">
                ↻
              </span>
              Thinking…
            </div>
          </div>
        )}

        {at("said") && (
          <div className={s.turn}>
            <span className={`${s.who} ${s.whoAgent}`}>Luca</span>
            <div className={s.said}>
              {/* The tool call, on the two execute turns that need a model and on
                  every read. Absent on a direct turn because none was made — the
                  arguments are in the sentence above it, which is the point of
                  the typed path. */}
              {tool.via === "model" && (
                <div className={s.toolCall}>
                  <span className={s.toolCallLabel}>Tool call</span>
                  <code className={s.call}>{tool.call}</code>
                </div>
              )}

              {tool.say && <p className={s.line}>{tool.say}</p>}

              {at("steps") && tool.steps.length > 0 && (
                /* Ordered, and the order is load-bearing: an approve before the
                   call it authorises, a decrease before the collect that pays
                   out. A `ul` would drop the one thing the list encodes. */
                <ol className={s.steps}>
                  {tool.steps.slice(0, shown).map((step, i) => (
                    <li className={s.step} key={`${step.kind}-${i}`}>
                      <span className={s.marker} aria-hidden="true">
                        {i + 1}
                      </span>
                      <div className={s.stepBody}>
                        <div className={s.stepTitle}>{step.title}</div>
                        {step.detail && (
                          <div className={s.stepDetail}>{step.detail}</div>
                        )}
                      </div>
                      <code className={s.stepMeta}>{step.kind}</code>
                    </li>
                  ))}
                </ol>
              )}

              {/* A read's return, with no answer under it. What getPortfolio
                  comes back with depends on a wallet this route group does not
                  have, so the turn stops at the call — inventing a balance would
                  be the one dishonest thing in this section. */}
              {at("steps") && tool.returns && (
                <div className={s.returns}>
                  <span className={s.returnsLabel}>Comes back with</span>
                  <p className={s.returnsText}>{tool.returns}</p>
                </div>
              )}

              {tool.refusal && <p className={s.line}>{tool.refusal}</p>}

              {at("done") && tool.via === "local" && (
                <span
                  className={s.viaTag}
                  title="Handled on-device, no model call"
                >
                  Direct
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scenery: a div, a span, and no handler between them. It stays put while
          the transcript above it grows, which is what `flex: none` does on the
          real one. */}
      <div className={s.composer} aria-hidden="true">
        {at("done") && tool.steps.length > 0 && (
          <div className={s.ctaPlan}>{planLabel(tool.steps.length)}</div>
        )}

        <div className={s.sendRow}>
          <span className={s.inp}>
            {composed === "" ? (
              <span className={s.ph}>{PLACEHOLDER}</span>
            ) : (
              composed
            )}
            {!sent && <span className={s.caret} />}
          </span>
          <span
            className={`${s.send} ${!busy && composed === "" ? s.sendOff : ""}`}
          >
            {busy ? "■" : "↑"}
          </span>
        </div>
      </div>
    </>
  );
}

export default function TracePlayer({ tool, onFinished, floor }: Props) {
  /* The finished turn is the initial state, so the server render and the first
     client render are identical markup. See note 2 in the docblock. */
  const [play, setPlay] = useState<{
    phase: Phase;
    typed: number;
    shown: number;
  }>({ phase: "done", typed: tool.prompt.length, shown: tool.steps.length });

  const [armed, setArmed] = useState(false);
  /* Whether a clock will ever run. False during SSR and on the first client
     render either way, which is what keeps the replay control from being the
     thing that causes a hydration mismatch. */
  const [animates, setAnimates] = useState(false);
  const [runId, setRunId] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);

  /* Through a ref, and this is not a style preference. The clock effect below is
     keyed on `[armed, animates, tool, runId]`; adding `onFinished` to that list
     would restart the turn from zero every time the parent re-rendered with a
     fresh closure — and a parent driving a rotation off this callback re-renders
     on every advance, so the turn would never reach its end and the rotation
     would deadlock on its own first step. */
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  /* Before paint, and before the observer has had a chance to fire: rewind to an
     empty composer so the ending is never briefly on screen. A plain effect here
     runs *after* the first paint, which is exactly the flash this avoids. */
  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      setAnimates(false);
      setPlay({
        phase: "done",
        typed: tool.prompt.length,
        shown: tool.steps.length,
      });
      return;
    }
    setAnimates(true);
    setPlay({ phase: "typing", typed: 0, shown: 0 });
  }, [tool, runId]);

  /* Armed once, on the way in, and it stays armed — so switching tools after that
     replays immediately instead of waiting for another crossing. The observer's
     first callback reports the current state, so a visitor who lands with this
     section already on screen starts straight away. */
  useEffect(() => {
    if (armed) return;
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(host);
    return () => io.disconnect();
  }, [armed]);

  useEffect(() => {
    if (!armed || !animates) return;
    let cancelled = false;
    let timer: number | undefined;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    void (async () => {
      const chars = tool.prompt.length;
      const rate = Math.min(
        TYPE_MAX,
        Math.max(TYPE_MIN, TYPE_TOTAL / Math.max(1, chars)),
      );
      for (let i = 1; i <= chars; i++) {
        await wait(rate);
        if (cancelled) return;
        setPlay((p) => ({ ...p, typed: i }));
      }
      await wait(SEND_HOLD);
      if (cancelled) return;
      setPlay((p) => ({ ...p, phase: "thinking" }));

      await wait(tool.via === "local" ? THINK_LOCAL : THINK_MODEL);
      if (cancelled) return;
      setPlay((p) => ({ ...p, phase: "said" }));

      await wait(SAY_HOLD);
      if (cancelled) return;
      setPlay((p) => ({ ...p, phase: "steps" }));

      for (let i = 1; i <= tool.steps.length; i++) {
        await wait(STEP_MS);
        if (cancelled) return;
        setPlay((p) => ({ ...p, shown: i }));
      }

      await wait(END_HOLD);
      if (cancelled) return;
      setPlay((p) => ({ ...p, phase: "done" }));

      /* The hand-off, after the finished turn has had time to be read. Inside
         the same cancellable clock as everything above it, so unmounting or
         switching tools mid-hold cannot fire it late against a stale turn. */
      await wait(LOOP_HOLD);
      if (cancelled) return;
      finishedRef.current?.();
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [armed, animates, tool, runId]);

  /* The height, from a copy of the ending. Memoised because the live copy
     re-renders on every keystroke and this one has no reason to. */
  const sizer = useMemo(
    () => (
      <Turn
        tool={tool}
        phase="done"
        typed={tool.prompt.length}
        shown={tool.steps.length}
      />
    ),
    [tool],
  );

  /* A second ending, for a turn that is not the one playing.
     `.live` and every `.sizer` share `grid-area: 1 / 1`, so the stage resolves to
     the tallest of them — which turns "reserve room for this turn" into "reserve
     room for both" with no measurement and no min-height to keep in step.

     WHAT IT IS FOR. Note 1 above holds the height steady *within* a turn. A parent
     that swaps `tool` on a timer breaks it *across* turns instead: plans run 1 to 2
     steps and a read has a "Comes back with" block where the plan would be, so the
     card would grow and shrink by roughly a step row every few seconds under
     someone reading the section — involuntarily, which is the difference from a
     click. The floor is the tallest turn in the set the parent rotates through, so
     the card is that height from the first frame and never moves.

     It is a floor and not a cap: the current turn's own sizer is still in the
     cell, so if the parent's pick is not actually the tallest, the worst case is
     the card grows on one transition. Nothing can clip. */
  const floorSizer = useMemo(
    () =>
      floor && floor !== tool ? (
        <Turn
          tool={floor}
          phase="done"
          typed={floor.prompt.length}
          shown={floor.steps.length}
        />
      ) : null,
    [floor, tool],
  );

  return (
    <div className={s.host} ref={hostRef}>
      <div className={s.head}>
        {/* `code` because it is one: this is the tool's declared signature, not
            prose about it. */}
        <code className={s.sig}>{signature(tool)}</code>
        <span className={s.cost}>{costOf(tool)}</span>
        {animates && (
          <button
            type="button"
            className={s.replay}
            onClick={() => setRunId((n) => n + 1)}
          >
            <span aria-hidden="true">↻ </span>
            Replay
          </button>
        )}
      </div>

      <div className={s.stage}>
        <div className={s.live}>
          <Turn
            tool={tool}
            phase={play.phase}
            typed={play.typed}
            shown={play.shown}
          />
        </div>
        {/* Geometry only — see `.sizer`. */}
        <div className={s.sizer} aria-hidden="true">
          {sizer}
        </div>
        {floorSizer && (
          <div className={s.sizer} aria-hidden="true">
            {floorSizer}
          </div>
        )}
      </div>
    </div>
  );
}
