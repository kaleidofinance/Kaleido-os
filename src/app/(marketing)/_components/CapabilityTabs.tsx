"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TracePlayer from "./TracePlayer";
import type { GroupTrace, ToolTrace } from "./traces";
import s from "./CapabilityTabs.module.css";

/**
 * The capability section — the whole inventory as cards, and the selected one
 * playing as a chat turn beside it.
 *
 * WHAT THE LEFT PANE SHOWS, because it is easy to mistake for a docs table. It
 * replays the chat turn the product would actually run: the sentence being typed,
 * Luca answering, and the plan arriving step by step. None of it is authored.
 * `traces.ts` runs each prompt through `parseCommand` and `buildIntents` — the
 * app's own local path — so on 21 of the 23 execute tools the line Luca says is
 * `built.build.summary`, the identical expression agent/page.tsx:271 passes to
 * `say()`, and the steps are labelled by `renderIntent`, the same renderer the
 * in-app plan panel uses. Change a step's title in definitions.ts and this section
 * changes with it; there is no second copy to forget. `TracePlayer` animates the
 * clock and nothing else, and capabilities.test.ts asserts that each typed plan is
 * step-for-step the plan that tool's own call builds.
 *
 * That is also the answer to the obvious question — why not just list parameter
 * names, which is what this panel did first. Because a signature answers "what
 * arguments does it take" and nobody asked that. What a visitor wants is what
 * happens after they ask for something, and the honest answer has a shape: two
 * transactions for a swap, one for a send, and a `removePosition` that is a
 * decrease *then* a collect. That shape is the product. A parameter list is its
 * header file — so the signature is still there, as the caption above the turn
 * rather than as the content.
 *
 * WHY CARDS BESIDE IT RATHER THAN A TAB STRIP AND A RAIL, which is what this was.
 * Two reasons, and the first is the one that mattered:
 *
 *   1. A strip plus a rail showed one group's tools at a time, so the size of the
 *      surface — 29 tools — was something a reader had to assemble by clicking
 *      through eight tabs. The count in the heading was the only evidence of it.
 *      All 29 on screen at once *is* the claim, and it needs no copy.
 *   2. It ends the height problem for good. Groups holding 1 to 8 tools cannot
 *      share a selector that resizes with them, which is what forced the 296px
 *      floor this panel used to carry and the empty box under `Send` that came
 *      with it. A static card grid does not resize at all.
 *
 * The trade the cards make is that they are 29 identical small things, which is
 * exactly what an earlier version of this section was rejected for. The difference
 * is what they are next to: on their own they were the content, and here they are
 * an index into one animated turn that carries all the detail.
 *
 * WHAT IS *NOT* IN HERE, and it was the first plan: a live product surface per
 * group. Recorded so it is not re-attempted from scratch —
 *
 *   1. Every product page is wallet-gated. `trade/swap`, `stake`, `stable/*`,
 *      `pool/*` and `portfolio` all call `useWalletV2`, and `PriceChart` is the
 *      only real product component that mounts wallet-free. It is already on
 *      this page, in the stack section.
 *   2. The public lending book is empty on real data — `/api/listings` and
 *      `/api/requests` both return `total: 0`. A live order book behind the
 *      borrow group would render an empty state, which is the same trap the
 *      four-tile stat strip fell into and was cut for.
 *
 * The traces are the third option and the better one: real output from the real
 * builders, computed on the server, structurally incapable of rendering empty.
 *
 * IT ROTATES BY ITSELF, THROUGH ALL 29, IN CARD ORDER. Without that this section
 * only ever showed one turn — `swap`, group 0 tool 0 — and the other 26 cards were
 * captions for an animation a visitor had to go looking for. Nothing on the page
 * asked them to click, so most never did, and the section's whole argument (this
 * is what the product does when you ask, across the whole surface) was sitting
 * behind an interaction that never happened. Now the selection walks the grid in
 * reading order and wraps, so each card lights up as its own turn plays and the
 * inventory reads as an index into a thing that is running rather than a menu.
 *
 * FOUR RULES IT FOLLOWS, all four of them the difference between a rotation and a
 * carousel nobody can escape:
 *
 *   1. **Any deliberate pick stops it, permanently.** Rotating away from a turn a
 *      visitor chose is the whole failure mode of auto-advancing UI, and one
 *      unwanted jump is enough to lose them. `onFocus` is what catches it rather
 *      than `onClick`, because it fires for the pointer *and* for a Tab arrival —
 *      and a tab stop that moves on a timer while someone is keyboarding through
 *      it is the same defect wearing different clothes.
 *   2. **Reduced motion means no rotation at all**, and it costs nothing to
 *      honour: the player only fires `onFinished` when a clock actually ran, so
 *      `prefers-reduced-motion` leaves this at the static finished transcript of
 *      group 0 tool 0 with all 29 cards still there to click.
 *   3. **Off-screen it stops advancing.** The player's own observer arms once and
 *      stays armed, which is right for one turn and wrong for an endless loop —
 *      unwatched, it would cycle 29 turns forever in a background tab. A finished
 *      turn parks in `pending` instead, and the next advance happens when the
 *      section is back on screen.
 *   4. **It never moves focus.** `move()` focuses because an arrow key should; a
 *      timer must not, or the page steals the caret every eight seconds.
 *
 * The one thing it does *not* have is a visible pause control. Every one of the 29
 * cards is one — clicking any of them stops the rotation for good — and reduced
 * motion switches it off outright, which is the escape hatch that matters. A
 * "Pause" chip in the player head is the alternative if this ever feels like it
 * needs an explicit affordance.
 */

/**
 * The tallest *ordinary* finished turn in the inventory, for `TracePlayer`'s
 * `floor`.
 *
 * A rotation that swaps the turn every few seconds resizes the card every few
 * seconds unless something holds it, so the player reserves room for a tall turn
 * as well as for whatever is playing. Ranked by step count first because a step is
 * a whole row — title, detail, tag — and then by rendered text, which is what
 * wraps to a second line.
 *
 * THE TWO MODEL-COMPOSED EXECUTE TURNS ARE EXCLUDED, and that is the whole reason
 * this is `tallest ordinary` rather than `tallest`. `provideLiquidity` (three
 * steps) and the delegation grant (one step) each carry an authored reply *and* a
 * tool-call block on top of their plan — see capabilities.ts — which makes them a
 * good ~200px taller than any of the 21 typed turns or the six reads. Reserving
 * *their* height for all 29 turns is what left an ordinary turn — a swap, a send —
 * sitting in ~200px of empty glass, with the card overshooting the catalog beside
 * it. So they are left out of the floor: the reserved height now tracks the
 * tallest ordinary turn, which lands within a hair of the catalog's own height,
 * and the two showpieces grow the card only when the rotation reaches them — where
 * the extra height is full of plan rather than empty. Identified as a model turn
 * that has a plan; a read is also `via: "model"` but has no steps, so `> 0` keeps
 * the six of them in the floor (they never win the step-count ranking regardless).
 *
 * A PROXY, AND SAFE BECAUSE IT IS ONLY A FLOOR. Real height also depends on where
 * each string wraps at the current width, which is not knowable here. If this
 * picks wrong — or a showpiece turn plays — the current turn's own sizer is still
 * in the grid cell, so the card grows on one transition instead of clipping.
 */
function tallest(groups: readonly GroupTrace[]): ToolTrace | undefined {
  const all = groups
    .flatMap((g) => g.tools)
    .filter((t) => !(t.via === "model" && t.steps.length > 0));
  const text = (t: ToolTrace) =>
    t.prompt.length +
    (t.say?.length ?? 0) +
    (t.refusal?.length ?? 0) +
    (t.returns?.length ?? 0) +
    t.steps.reduce(
      (n, st) => n + st.title.length + (st.detail?.length ?? 0),
      0,
    );
  return all.reduce<ToolTrace | undefined>((best, t) => {
    if (!best) return t;
    if (t.steps.length !== best.steps.length)
      return t.steps.length > best.steps.length ? t : best;
    return text(t) > text(best) ? t : best;
  }, undefined);
}

interface Props {
  /** Built by `getCapabilityTraces()` in the page, which is a server component. */
  groups: readonly GroupTrace[];
}

export default function CapabilityTabs({ groups }: Props) {
  /*
   * One state object rather than two, so picking a card sets the group and the tool
   * in the same update. Held separately they drift for one render — group 5 with
   * tool index 7 — and index 7 of a two-tool group is undefined.
   */
  const [sel, setSel] = useState({ g: 0, t: 0 });
  const group = groups[sel.g];
  const tool = group.tools[sel.t] ?? group.tools[0];

  /* Set the first time a visitor picks a turn themselves, and never cleared.
     A ref rather than state because nothing renders differently for it — reading
     it inside a callback is the whole use — and because it must take effect for
     the `pending` handler in the same tick as the click that sets it. */
  const picked = useRef(false);

  /* Whether the section is on screen *now*, which is a different question from
     the player's `armed` ("has it ever been"). Rule 3 above. */
  const [onScreen, setOnScreen] = useState(false);
  /* A turn has finished and the next one is owed. Held rather than acted on
     immediately so an advance that lands while the section is scrolled away waits
     instead of being dropped or run blind. */
  const [pending, setPending] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  const floor = useMemo(() => tallest(groups), [groups]);

  useEffect(() => {
    const host = colsRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((e) => e.isIntersecting)),
      /* Lower than the player's 0.25: this decides whether to keep a running
         animation running, and stalling it while a third of the section is still
         visible would read as the page having frozen. */
      { threshold: 0.05 },
    );
    io.observe(host);
    return () => io.disconnect();
  }, []);

  /* The advance. In reading order across the whole grid — next tool in this
     group, else the first tool of the next group, else back to the top — so the
     rotation traces exactly the path a visitor's eye takes down the cards. */
  useEffect(() => {
    if (!pending) return;
    /* Picked while the last turn was still playing: drop the owed advance rather
       than leaving it armed, so nothing is waiting behind a flag that will never
       be read again. */
    if (picked.current) {
      setPending(false);
      return;
    }
    if (!onScreen) return;
    setPending(false);
    setSel((cur) => {
      const g = groups[cur.g];
      if (cur.t + 1 < g.tools.length) return { g: cur.g, t: cur.t + 1 };
      return { g: (cur.g + 1) % groups.length, t: 0 };
    });
  }, [pending, onScreen, groups]);

  /* Both entry points for a deliberate pick, so neither can set the selection
     without also ending the rotation. */
  const pick = (g: number, t: number) => {
    picked.current = true;
    setSel({ g, t });
  };

  /*
   * Arrow keys move within one group's grid, which is what its `role="tablist"`
   * promises. Both axes step by one rather than Up/Down moving by row: the row
   * length is whatever `auto-fill` resolved to at the current width, so a
   * by-row jump would have to read layout to know its own stride. Linear in
   * reading order is predictable at every width, and 8 is the longest group.
   */
  const move = (
    e: React.KeyboardEvent,
    gi: number,
    ti: number,
    count: number,
  ) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const to = (ti + step + count) % count;
    pick(gi, to);
    document.getElementById(`cap-card-${gi}-${to}`)?.focus();
  };

  return (
    <div className={s.wrap}>
      <div className={s.cols} ref={colsRef}>
        <div className={s.playerCol}>
          <div className={s.playerCard}>
            <div className={s.playerHead}>
              <div>
                <h3 className={s.playerTitle}>{group.title}</h3>
                <p className={s.playerNote}>{group.note}</p>
              </div>
              <Link href={group.href} className={s.open}>
                Open
                <span aria-hidden="true"> →</span>
              </Link>
            </div>

            {/* No `key`, deliberately. `TracePlayer` restarts on a new `tool`
                reference, and remounting it instead would reset the
                IntersectionObserver that arms playback — so the first click after
                scrolling here would rewind and then wait to be armed again. */}
            <div
              id="cap-trace"
              role="tabpanel"
              aria-labelledby={`cap-card-${sel.g}-${sel.t}`}
            >
              <TracePlayer
                tool={tool}
                floor={floor}
                /* Records that a turn is over; the effect above decides what
                   plays next. Setting a flag rather than advancing here is what
                   lets the rotation stall off-screen and resume on the way
                   back, and keeps the "what comes next" rule in one place. */
                onFinished={() => setPending(true)}
              />
            </div>
          </div>
        </div>

        <div className={s.cardsCol}>
          {groups.map((g, gi) => (
            <div key={g.title} className={s.group}>
              {/*
               * One tablist per group rather than one for all 29, because the
               * groups are the only structure in the inventory and a single flat
               * tablist would announce "1 of 29" with no mention of which part of
               * the product a tool belongs to. The heading is the label, so it is
               * `aria-labelledby` rather than a duplicated `aria-label` string.
               */}
              <h3 className={s.groupHead} id={`cap-group-${gi}`}>
                {g.tab}
                <span className={s.groupCount}>{g.tools.length}</span>
              </h3>

              <div
                className={s.cardGrid}
                role="tablist"
                aria-labelledby={`cap-group-${gi}`}
              >
                {g.tools.map((t, ti) => {
                  const on = gi === sel.g && ti === sel.t;
                  /* A read signs nothing, so it has no steps — `traces.ts` gives
                     it the catalog's own sentence instead of a plan. */
                  const isRead = t.returns !== undefined;
                  return (
                    <button
                      key={t.name}
                      type="button"
                      role="tab"
                      id={`cap-card-${gi}-${ti}`}
                      aria-selected={on}
                      aria-controls="cap-trace"
                      /*
                       * Arrow keys move within a tablist, so only one card per
                       * group is a tab stop — 29 of them each taking a Tab press
                       * is the thing this role exists to avoid. In the group
                       * holding the selection that card is the selected one;
                       * elsewhere it is the first, because a tablist whose every
                       * tab is -1 cannot be reached by keyboard at all.
                       */
                      tabIndex={
                        gi === sel.g ? (on ? 0 : -1) : ti === 0 ? 0 : -1
                      }
                      className={`${s.card} ${on ? s.cardOn : ""}`}
                      onClick={() => pick(gi, ti)}
                      /* The rotation's stop signal, and `onFocus` rather than
                         `onClick` on purpose: a click focuses too, so this
                         catches the pointer as well — and it additionally
                         catches a Tab arrival, which `onClick` would miss and
                         which is the case where a tab stop moving on a timer
                         does the most damage. It cannot fire from the rotation
                         itself, because that never focuses anything. */
                      onFocus={() => {
                        picked.current = true;
                      }}
                      onKeyDown={(e) => move(e, gi, ti, g.tools.length)}
                    >
                      <span className={s.cardName}>{t.name}</span>
                      {/* "tx" rather than the CTA's "transaction(s)": the plan
                          button inside the player spells it out, and a card is
                          too small to say the same word twice as loudly. */}
                      <span className={isRead ? s.cardRead : s.cardCost}>
                        {isRead ? "read" : `${t.steps.length} tx`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
