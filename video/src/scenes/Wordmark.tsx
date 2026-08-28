import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

import { C, F } from "../theme";
import { Mark, Rise, SceneFade, Stage } from "../ui";

/**
 * Scene 1 — the wordmark. Four seconds.
 *
 * Opens on the mark alone because a launch post's first frame is what shows in
 * the timeline before anyone presses play: it has to be the logo, legible at
 * thumbnail size, and not a sentence nobody can read yet.
 *
 * The hairline under the lockup draws outward from the centre. That is the one
 * piece of motion here — the mark itself only scales in — because two things
 * moving in the first second is already busy.
 */
export const Wordmark: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.8 },
    durationInFrames: 30,
  });

  /* Starts at 0.94 rather than 0: a logo that grows from nothing is a template
     animation, whereas a small settle reads as the frame arriving. */
  const scale = interpolate(pop, [0, 1], [0.94, 1]);
  const rule = interpolate(frame, [22, 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFade>
      <Stage>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            transform: `scale(${scale})`,
            opacity: pop,
          }}
        >
          <Mark size={116} />
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontFamily: F.display,
                fontSize: 84,
                color: C.t1,
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              KALEIDO
            </div>
            <div
              style={{
                fontFamily: F.sans,
                fontSize: 28,
                fontWeight: 485,
                letterSpacing: "0.34em",
                textTransform: "uppercase",
                color: C.brand,
                marginTop: 12,
              }}
            >
              DeFi Operating System
            </div>
          </div>
        </div>

        <div
          style={{
            width: 620 * rule,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${C.brand}, transparent)`,
            marginTop: 46,
          }}
        />

        <Rise delay={56} style={{ marginTop: 34 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 34,
              fontWeight: 485,
              color: C.t2,
            }}
          >
            Tell it what you want.
          </div>
        </Rise>
      </Stage>
    </SceneFade>
  );
};
