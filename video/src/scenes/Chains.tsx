import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

import { C, F } from "../theme";
import { Eyebrow, Headline, Rise, SceneFade, Stage } from "../ui";

/**
 * Scene 5 — the networks. Four seconds.
 *
 * Five rows, each with its real chain id, because a chain id is checkable and a
 * logo is not: anyone watching can paste 46630 or 5042002 into an explorer and
 * find the deployment. For a testnet announcement that is the difference between
 * a claim and a receipt.
 *
 * Arc and Robinhood are the two nobody recognises, so they go last, after the
 * three that establish the list is real.
 */
const CHAINS = [
  { name: "Sepolia", id: 11155111 },
  { name: "Base Sepolia", id: 84532 },
  { name: "BSC Testnet", id: 97 },
  { name: "Robinhood", id: 46630 },
  { name: "Arc", id: 5042002 },
];

const Row: React.FC<{ index: number; name: string; id: number }> = ({
  index,
  name,
  id,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = 26 + index * 8;

  const p = spring({
    frame: frame - at,
    fps,
    config: { damping: 200, mass: 0.45 },
    durationInFrames: 16,
  });

  /* Rows slide in from alternating sides by a small amount. It keeps five
     identically-shaped bars from reading as a loading skeleton. */
  const dx = index % 2 === 0 ? -22 : 22;

  return (
    <div
      style={{
        width: 720,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 26px",
        borderRadius: 16,
        background: C.well,
        border: `1px solid ${C.line}`,
        opacity: p,
        transform: `translateX(${(1 - p) * dx}px)`,
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: C.pos,
          flex: "none",
          /* Live dot with a halo, matching the app's status pill. */
          boxShadow: `0 0 0 4px rgba(76,196,106,0.16)`,
          opacity: interpolate(p, [0, 1], [0, 1]),
        }}
      />
      <div
        style={{
          flex: 1,
          fontFamily: F.sans,
          fontSize: 30,
          fontWeight: 535,
          color: C.t1,
        }}
      >
        {name}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.t3 }}>{id}</div>
    </div>
  );
};

export const ChainsScene: React.FC = () => (
  <SceneFade>
    <Stage>
      <Rise>
        <Eyebrow>Live now</Eyebrow>
      </Rise>
      <Rise delay={6} style={{ marginTop: 18 }}>
        <Headline size={62}>Deployed on five networks.</Headline>
      </Rise>

      <div
        style={{
          marginTop: 40,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {CHAINS.map((c, i) => (
          <Row key={c.id} index={i} {...c} />
        ))}
      </div>
    </Stage>
  </SceneFade>
);
