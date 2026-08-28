/**
 * Brand values, copied from src/app/(app)/tokens.css rather than imported.
 *
 * Copied because this project is deliberately outside the Next app's module
 * graph and dependency tree (see README.md), so there is no import path from
 * here into `src/`. That makes these values a snapshot: if the app's dark theme
 * is retuned, this file is stale until someone re-copies it. The alternative —
 * a build step that parses tokens.css — is more machinery than a launch video
 * justifies, but the tradeoff is worth naming rather than discovering.
 *
 * Dark theme only. Every frame of this video is on black.
 */
export const C = {
  bg: "#000000",
  card: "#1d1c1a",
  line: "rgba(255, 255, 255, 0.075)",
  lineBright: "rgba(255, 255, 255, 0.16)",
  well: "rgba(255, 255, 255, 0.045)",
  t1: "#ffffff",
  t2: "#a8a49b",
  t3: "#6b6760",
  brand: "#00b383",
  brandFg: "#04170f",
  pos: "#4cc46a",
} as const;

export const F = {
  /** UI and body. The app's own face. */
  sans: "KaleidoSans, Inter, system-ui, sans-serif",
  /** The wordmark face, used for the logotype and nothing else. */
  display: "KaleidoDisplay, KaleidoSans, system-ui, sans-serif",
  /** Code, addresses, the access boxes, the agent's typed line. */
  mono: "KaleidoMono, ui-monospace, monospace",
} as const;

/**
 * The logical canvas.
 *
 * Every scene lays itself out inside a 1200x900 box, and `Stage` scales that box
 * to fit whichever frame is rendering. That is what lets one set of scenes serve
 * 16:9, 1:1 and 9:16 without three layouts: the box is centred and always fully
 * visible, and the background fills the rest. It also means nothing is ever
 * cropped between aspect ratios — a safe-area mistake that is invisible on a
 * desktop preview and fatal in a phone feed.
 */
export const STAGE = { w: 1200, h: 900 } as const;

export const FPS = 30;

/**
 * Scene boundaries, in frames, and the single source of the video's length.
 *
 * Kept as one ordered table because the durations have to sum to exactly the
 * composition length — 900 frames, 30 seconds. Deriving each scene's `from` by
 * hand is how a two-frame gap of black appears in the middle of a cut.
 */
export const SCENES = [
  { id: "wordmark", frames: 120 },
  { id: "access", frames: 150 },
  { id: "agent", frames: 210 },
  { id: "stack", frames: 120 },
  { id: "chains", frames: 120 },
  { id: "cta", frames: 180 },
] as const;

export const TOTAL = SCENES.reduce((n, s) => n + s.frames, 0);

/** Cumulative start frame of each scene, by id. */
export const startOf = (id: (typeof SCENES)[number]["id"]): number => {
  let n = 0;
  for (const s of SCENES) {
    if (s.id === id) return n;
    n += s.frames;
  }
  throw new Error(`unknown scene ${id}`);
};

export const framesOf = (id: (typeof SCENES)[number]["id"]): number =>
  SCENES.find((s) => s.id === id)!.frames;
