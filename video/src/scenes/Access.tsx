import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

import { C, F } from "../theme";
import { Eyebrow, Headline, Panel, Rise, SceneFade, Stage, Sub } from "../ui";

/**
 * Scene 2 — the access card. Five seconds.
 *
 * This is the scene the post is actually about, so it shows the real screen a
 * participant meets: the gate from src/components/v2/BetaGate.tsx, six boxes and
 * an Unlock button, rebuilt here rather than screen-recorded so the timing can be
 * cut to the frame.
 *
 * The boxes fill with dots, never with characters. The code goes only to people
 * who fill the waitlist form, and a video is the single most copyable place to
 * leak it — a frame is a screenshot away and X keeps the still on the timeline.
 * Masked input is also what the product does, so this is accurate as well as safe.
 */

/** Frame at which each of the six boxes fills. */
const FILL_AT = [26, 38, 50, 62, 74, 86];
/** Frame the card unlocks — a beat after the last box, the way a check feels. */
const UNLOCK_AT = 104;

const Box: React.FC<{ index: number; unlocked: boolean }> = ({
  index,
  unlocked,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = FILL_AT[index];
  const filled = frame >= at;

  /* The box the caret is in, before it fills. Drives the brand-green ring, so the
     eye is led left to right instead of watching six boxes at once. */
  const active = !filled && frame >= (index === 0 ? 18 : FILL_AT[index - 1]);

  const pop = spring({
    frame: frame - at,
    fps,
    config: { damping: 200, mass: 0.35 },
    durationInFrames: 12,
  });

  return (
    <div
      style={{
        flex: "1 1 0",
        height: 84,
        borderRadius: 14,
        background: unlocked ? "rgba(0,179,131,0.12)" : C.well,
        border: `1px solid ${
          unlocked ? C.brand : active ? C.brand : C.lineBright
        }`,
        boxShadow: active ? `0 0 0 3px rgba(0,179,131,0.18)` : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: unlocked ? C.brand : C.t1,
          opacity: filled ? pop : 0,
          transform: `scale(${filled ? interpolate(pop, [0, 1], [0.4, 1]) : 0.4})`,
        }}
      />
    </div>
  );
};

export const Access: React.FC = () => {
  const frame = useCurrentFrame();
  const unlocked = frame >= UNLOCK_AT;

  /* The card lifts very slightly on unlock. Two pixels and a shadow — enough to
     register as the screen letting you through, not enough to look like a bounce. */
  const lift = interpolate(frame, [UNLOCK_AT, UNLOCK_AT + 14], [0, -8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFade>
      <Stage>
        <Rise>
          <Eyebrow>Private testnet</Eyebrow>
        </Rise>
        <Rise delay={6} style={{ marginTop: 18 }}>
          <Headline size={66}>Access is by code.</Headline>
        </Rise>

        <Rise delay={14} style={{ marginTop: 40 }}>
          <Panel
            style={{
              width: 640,
              padding: "36px 40px 40px",
              transform: `translateY(${lift}px)`,
            }}
          >
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 22,
                fontWeight: 535,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: unlocked ? C.brand : C.t3,
                textAlign: "left",
              }}
            >
              {unlocked ? "Unlocked" : "Enter your access code"}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              {FILL_AT.map((_, i) => (
                <Box key={i} index={i} unlocked={unlocked} />
              ))}
            </div>

            <div
              style={{
                marginTop: 26,
                height: 60,
                borderRadius: 14,
                background: unlocked ? C.brand : "rgba(255,255,255,0.08)",
                color: unlocked ? C.brandFg : C.t3,
                fontFamily: F.sans,
                fontSize: 24,
                fontWeight: 535,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {unlocked ? "Welcome in" : "Unlock"}
            </div>
          </Panel>
        </Rise>

        <Rise delay={112} style={{ marginTop: 34 }}>
          {/* States the mechanism rather than repeating the CTA — scene 6 does the
              asking, and the same sentence twice in thirty seconds is heard. */}
          <Sub>A code gets you in. The waitlist gets you a code.</Sub>
        </Rise>
      </Stage>
    </SceneFade>
  );
};
