import React from "react";
import {
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

import { C, F, STAGE } from "./theme";

/**
 * Scales the 1200x900 logical canvas to fit whatever frame is rendering, and
 * centres it.
 *
 * `Math.min` of the two ratios rather than a stretch or a crop: the box always
 * fits entirely, so a 16:9 render, a 1:1 render and a 9:16 render show the same
 * composition at different sizes with the background filling the remainder.
 * Cropping instead would be the cheaper trick and would cut the edges off the
 * chip rows in the square cut, which is exactly the class of mistake that only
 * shows up once the video is already posted.
 */
export const Stage: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { width, height } = useVideoConfig();
  const scale = Math.min(width / STAGE.w, height / STAGE.h);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: STAGE.w,
          height: STAGE.h,
          transform: `scale(${scale})`,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * The background, on every frame: black, one brand-green glow, and a faint grid.
 *
 * The glow drifts across the 30 seconds rather than sitting still. Nothing about
 * it is decorative in the "add motion" sense — a completely static background
 * over six cuts reads as a slideshow, and a slow luminance drift is what makes
 * the cuts feel like one piece of film. It is sized off the frame rather than the
 * stage so it fills a vertical crop too.
 */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const gx = interpolate(t, [0, 1], [35, 65]);
  const gy = interpolate(t, [0, 1], [30, 60]);

  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: C.bg }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(${width * 0.7}px ${height * 0.7}px at ${gx}% ${gy}%, rgba(0,179,131,0.20), rgba(0,179,131,0.05) 45%, transparent 70%)`,
        }}
      />
      {/* 64px grid at 3.5% white. Present to give the black some structure and
          to make the scale of the frame legible; any stronger and it competes
          with the type. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      {/* Vignette, so the corners fall away and the centre carries the eye. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 120% at 50% 50%, transparent 45%, rgba(0,0,0,0.75) 100%)`,
        }}
      />
    </>
  );
};

/**
 * The Kaleido mark.
 *
 * newklogo2.png is 500x500 with its own opaque dark backdrop baked in, so drawn
 * whole on black it reads as a grey tile rather than a logo. The app solves this
 * in src/components/v2/Nav.module.css by zooming 240% into the centred glyph
 * inside a brand-filled circle, and this is the same treatment — the mark in the
 * video is then literally the mark in the product, not an approximation of it.
 *
 * An <Img> inside an overflow-hidden circle rather than a CSS background-image:
 * Remotion only waits on <Img> tags, and a background would let the first frames
 * of a scene render with no logo at all.
 */
export const Mark: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      flex: "none",
      borderRadius: "50%",
      background: C.brand,
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Img
      src={staticFile("newklogo2.png")}
      style={{ width: size * 2.4, height: size * 2.4, flex: "none" }}
    />
  </div>
);

/**
 * Fade-and-rise entrance, the one transition this video uses.
 *
 * A single entrance reused everywhere is a deliberate choice over a different
 * flourish per scene: six different transitions in thirty seconds is what makes
 * a launch video look assembled from a template. `spring` rather than a linear
 * interpolate because the settle is what reads as considered.
 *
 * `delay` is in frames from the start of the enclosing Sequence.
 */
export const Rise: React.FC<{
  delay?: number;
  y?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, y = 26, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 0.6 },
    durationInFrames: 22,
  });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * y}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Holds a scene's own opacity so cuts cross-fade instead of snapping.
 *
 * Every scene wraps itself in this. The fade is 8 frames in and 8 out — under a
 * third of a second, enough to remove the hard edge without turning the cut into
 * a dissolve. `durationInFrames` comes from the enclosing Sequence, so a scene
 * whose length changes does not need this touched.
 */
export const SceneFade: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(
    frame,
    [0, 8, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>{children}</div>
  );
};

/** Small upper-case brand-green label that opens most scenes. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div
    style={{
      fontFamily: F.sans,
      fontSize: 22,
      fontWeight: 535,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: C.brand,
    }}
  >
    {children}
  </div>
);

/** The one headline size, so the six scenes share a typographic spine. */
export const Headline: React.FC<{
  children: React.ReactNode;
  size?: number;
}> = ({ children, size = 76 }) => (
  <div
    style={{
      fontFamily: F.sans,
      fontSize: size,
      fontWeight: 535,
      lineHeight: 1.08,
      letterSpacing: "-0.02em",
      color: C.t1,
      maxWidth: 1040,
    }}
  >
    {children}
  </div>
);

export const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: F.sans,
      fontSize: 30,
      fontWeight: 485,
      lineHeight: 1.45,
      color: C.t2,
      maxWidth: 860,
    }}
  >
    {children}
  </div>
);

/** A glass panel, matching the app's --k-glass treatment. */
export const Panel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.045)",
      border: `1px solid ${C.line}`,
      borderRadius: 24,
      boxShadow:
        "inset 0 1px 0 rgba(250,249,245,0.10), 0 24px 60px rgba(0,0,0,0.55)",
      backdropFilter: "blur(20px) saturate(140%)",
      ...style,
    }}
  >
    {children}
  </div>
);

/** The brand tick, drawn rather than an icon font, so it can be animated. */
export const Tick: React.FC<{ progress: number; size?: number }> = ({
  progress,
  size = 26,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none" }}>
    <circle
      cx="12"
      cy="12"
      r="11"
      fill="none"
      stroke={C.brand}
      strokeWidth="2"
      opacity={progress}
    />
    <path
      d="M7 12.5l3.2 3.2L17 9"
      fill="none"
      stroke={C.brand}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Dash offset draws the stroke on rather than fading it in — the mark
         reads as a check being made, which is the whole point of a plan step
         confirming. 14 is the path length, rounded up. */
      strokeDasharray={14}
      strokeDashoffset={14 * (1 - progress)}
    />
  </svg>
);

/**
 * Reveals a string one character at a time.
 *
 * The caret keeps blinking while the line types and stays after it finishes,
 * because the composer in the product has a caret in it — a typed line with no
 * caret reads as a caption about the product rather than a shot of it.
 */
export const Typed: React.FC<{
  text: string;
  start: number;
  cps?: number;
  style?: React.CSSProperties;
}> = ({ text, start, cps = 26, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = Math.max(
    0,
    Math.min(text.length, Math.floor(((frame - start) / fps) * cps)),
  );
  const caretOn = Math.floor(frame / 15) % 2 === 0;
  return (
    <span style={style}>
      {text.slice(0, shown)}
      <span
        style={{
          opacity: frame < start ? 0 : caretOn ? 1 : 0,
          color: C.brand,
        }}
      >
        ▌
      </span>
    </span>
  );
};
