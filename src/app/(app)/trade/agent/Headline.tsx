"use client";

import { useEffect, useState } from "react";

import s from "./agent.module.css";

/**
 * The agent header's name, which rotates through what Luca can actually do.
 *
 * "Talk to Luca Agent" is a true label and a weak one: it names the control and
 * says nothing about why you would use it. The rotation is the pitch — swapping,
 * lending, the money market — on the one line a reader's eye is already on before
 * they type anything. It is marketing copy, and it is only allowed to behave like
 * marketing copy while the card is empty.
 *
 * FOUR CONSTRAINTS SHAPE THIS, AND EACH ONE CUT SOMETHING SIMPLER
 *
 * 1. It stops once there is a thread. `rotate` goes false on the first message,
 *    and from then on the header is a fixed label. Copy that keeps advertising
 *    over your own conversation is noise sitting on top of the answer you are
 *    reading, and the header is 30px from the transcript.
 *
 * 2. Two phrase sets, picked by width, and NEVER during render. `.headName` has
 *    about 230px on a desktop header and about 139px on a phone once the mobile
 *    block reclaims the credits word — "Plan your money market with Luca" needs
 *    roughly 224px, so on a phone every long phrase would render as an ellipsis
 *    and the animation would be a rotating truncation. `NARROW` is the same offer
 *    in fewer words. The `matchMedia` read is in an effect because SSR has no
 *    viewport: both the server and the first client render emit `NAME`, so
 *    hydration matches whatever the window turns out to be, and the set arrives a
 *    frame later. The listener keeps it honest across a resize or an orientation
 *    change rather than sampling once on mount.
 *
 * 3. `prefers-reduced-motion: reduce` gets no rotation at all — not a rotation
 *    with the fade removed. The words changing under you IS the motion here; a
 *    crossfade is only how it is delivered. So the whole effect returns early and
 *    the header stays `NAME`, which is why this is a JS check and not just the
 *    media query guarding the transition in the stylesheet.
 *
 * 4. Opacity only. `.headName` earns its ellipsis from `white-space: nowrap` plus
 *    `overflow: hidden`, and a `translateY` on the phrase would need
 *    `display: inline-block` to take a transform — which gives the span its own
 *    box and takes the text out of the parent's inline flow, so the ellipsis stops
 *    working and long phrases overflow into the credit counter instead of
 *    truncating. A vertical slide is the obvious treatment and it is unavailable.
 *
 * The rotating text is `aria-hidden`, with `NAME` beside it in a visually hidden
 * span: a screen reader gets one stable label instead of a header that renames
 * itself every four seconds, and no assistive tech has to sit through the pitch.
 */
const NAME = "Talk to Luca Agent";

/* Ordered so the first swap is the biggest jump in specificity — label, then a
   verb — and `NAME` leads both sets because it is what SSR renders. Starting
   anywhere else would show one phrase for a frame and then jump. */
const WIDE = [
  NAME,
  "Trade with Luca",
  "Swap across chains with Luca",
  "Plan your money market with Luca",
  "Lend and borrow with Luca",
  "Mint kfUSD with Luca",
  "Stake KLD with Luca",
  "Ask Luca about your positions",
];

/* Every one of these is at most 20 characters, which is what ~139px of 14px
   medium holds. Same offers as WIDE, minus the qualifiers that made them long. */
const NARROW = [
  NAME,
  "Trade with Luca",
  "Swap with Luca",
  "Borrow with Luca",
  "Mint with Luca",
  "Stake with Luca",
  "Ask Luca anything",
];

/** How long a phrase stays up. Long enough to read twice without waiting on it. */
const HOLD_MS = 3800;
/** Matches `.headPhrase`'s transition — the swap happens while it is at zero. */
const FADE_MS = 320;

export default function Headline({ rotate }: { rotate: boolean }) {
  /* Null until an effect has both a viewport to measure and permission to move.
     It is the "are we rotating" flag as well as the data, so there is no second
     boolean that can disagree with it. */
  const [phrases, setPhrases] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (!rotate) {
      /* Back to the plain label, and reset — otherwise clearing a thread would
         resume mid-phrase at whatever was on screen when the first message went. */
      setPhrases(null);
      setI(0);
      setOut(false);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const narrow = window.matchMedia("(max-width: 720px)");
    const pick = () => setPhrases(narrow.matches ? NARROW : WIDE);
    pick();
    narrow.addEventListener("change", pick);
    return () => narrow.removeEventListener("change", pick);
  }, [rotate]);

  useEffect(() => {
    if (!phrases) return;
    /* Declared outside the interval so the cleanup can cancel a fade that is
       mid-flight — unmounting between the fade-out and the swap would otherwise
       leave a setState pointing at a torn-down component. */
    let fade: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      setOut(true);
      fade = setTimeout(() => {
        setI((n) => n + 1);
        setOut(false);
      }, FADE_MS);
    }, HOLD_MS);
    return () => {
      clearInterval(tick);
      if (fade) clearTimeout(fade);
    };
  }, [phrases]);

  if (!phrases) return <>{NAME}</>;

  return (
    <>
      {/* Modulo at read time, not in the setter: the two sets are different
          lengths, so a resize mid-rotation can leave the index past the end of
          the set that replaced it. */}
      <span
        className={`${s.headPhrase} ${out ? s.headPhraseOut : ""}`}
        aria-hidden="true"
      >
        {phrases[i % phrases.length]}
      </span>
      <span className={s.headNameSr}>{NAME}</span>
    </>
  );
}
