import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

import { C, F } from "../theme";
import { Eyebrow, Headline, Mark, Rise, SceneFade, Stage } from "../ui";

/**
 * Scene 6 — the ask. Six seconds, the second-longest scene.
 *
 * Long on purpose: this is the frame people screenshot and the one still on
 * screen when the loop restarts, so it has to hold the address and the handle
 * legibly rather than flash them. The poster still (`npm run still`, frame 870)
 * is taken from inside this scene for the same reason.
 *
 * One instruction and one destination. No secondary link, no QR code, nothing
 * competing with the domain.
 */
export const Cta: React.FC = () => {
  const frame = useCurrentFrame();

  /* The rule under the domain keeps drawing for two seconds after everything else
     has landed, so the last third of the scene is not a frozen frame. */
  const rule = interpolate(frame, [70, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFade>
      <Stage>
        <Rise>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Mark size={52} />
            <div
              style={{
                fontFamily: F.display,
                fontSize: 34,
                color: C.t1,
                letterSpacing: "0.02em",
              }}
            >
              KALEIDO
            </div>
          </div>
        </Rise>

        <Rise delay={10} style={{ marginTop: 44 }}>
          <Eyebrow>Now open</Eyebrow>
        </Rise>

        <Rise delay={18} style={{ marginTop: 20 }}>
          <Headline size={78}>Join the private testnet.</Headline>
        </Rise>

        <Rise delay={30} style={{ marginTop: 22 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 30,
              fontWeight: 485,
              color: C.t2,
              maxWidth: 820,
            }}
          >
            Join the waitlist. Codes go out in batches.
          </div>
        </Rise>

        <Rise delay={46} style={{ marginTop: 48 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 44,
              fontWeight: 535,
              letterSpacing: "-0.01em",
              color: C.brandFg,
              background: C.brand,
              padding: "20px 44px",
              borderRadius: 18,
            }}
          >
            kaleidofi.xyz
          </div>
        </Rise>

        <div
          style={{
            width: 520 * rule,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${C.lineBright}, transparent)`,
            marginTop: 40,
          }}
        />

        <Rise delay={62} style={{ marginTop: 26 }}>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 24,
              color: C.t3,
              letterSpacing: "0.02em",
            }}
          >
            @kaleido_finance
          </div>
        </Rise>
      </Stage>
    </SceneFade>
  );
};
