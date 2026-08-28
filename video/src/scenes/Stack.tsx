import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";

import { C, F } from "../theme";
import { Eyebrow, Headline, Rise, SceneFade, Stage } from "../ui";

/**
 * Scene 4 — the stack. Four seconds.
 *
 * Six chips, one per primitive that ships in the app today: the DEX, the lending
 * book, LP positions, the KLD vault, the kfUSD stablecoin, and the bridge. The
 * point of listing them is that the previous scene's single instruction reaches
 * all six — an agent over one primitive is a feature, over six it is an operating
 * system, which is the claim the product's name makes.
 *
 * These are the live surfaces, not a roadmap. Anything not deployed stays off this
 * list.
 */
const CHIPS = [
  { label: "Swaps", detail: "v2 + v3 pools" },
  { label: "Lending", detail: "peer-to-peer book" },
  { label: "Liquidity", detail: "concentrated ranges" },
  { label: "Staking", detail: "KLD → stKLD" },
  { label: "kfUSD", detail: "collateral-backed" },
  { label: "Bridge", detail: "five networks" },
];

const Chip: React.FC<{ index: number; label: string; detail: string }> = ({
  index,
  label,
  detail,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* Staggered four frames apart. Reading order, left to right and down — a grid
     that lands all at once is a slide, one that lands in sequence is a list. */
  const p = spring({
    frame: frame - (30 + index * 5),
    fps,
    config: { damping: 200, mass: 0.45 },
    durationInFrames: 16,
  });

  return (
    <div
      style={{
        width: 300,
        padding: "24px 26px",
        borderRadius: 18,
        background: C.well,
        border: `1px solid ${C.line}`,
        textAlign: "left",
        opacity: p,
        transform: `translateY(${(1 - p) * 18}px)`,
      }}
    >
      <div
        style={{
          fontFamily: F.sans,
          fontSize: 32,
          fontWeight: 535,
          color: C.t1,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 17,
          color: C.t3,
          marginTop: 6,
        }}
      >
        {detail}
      </div>
    </div>
  );
};

export const StackScene: React.FC = () => (
  <SceneFade>
    <Stage>
      <Rise>
        <Eyebrow>The whole stack</Eyebrow>
      </Rise>
      <Rise delay={6} style={{ marginTop: 18 }}>
        <Headline size={62}>Six primitives. One instruction.</Headline>
      </Rise>

      <div
        style={{
          marginTop: 46,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          width: 948,
          justifyContent: "center",
        }}
      >
        {CHIPS.map((c, i) => (
          <Chip key={c.label} index={i} {...c} />
        ))}
      </div>
    </Stage>
  </SceneFade>
);
