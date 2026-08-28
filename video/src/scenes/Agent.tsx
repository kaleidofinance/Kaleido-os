import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

import { C, F } from "../theme";
import { Eyebrow, Panel, Rise, SceneFade, Stage, Tick, Typed } from "../ui";

/**
 * Scene 3 — the agent. Seven seconds, the longest scene, because it is the only
 * one that has to show a mechanism rather than state a fact.
 *
 * One sentence goes in and a signed plan comes out. That is the product, and the
 * reason this gets a third of the runtime is that "AI agent for DeFi" means
 * nothing until someone watches an instruction become three transactions with a
 * route and a rate attached.
 *
 * The instruction is deliberately a cross-chain one. A single-chain swap would be
 * a shorter animation and would undersell the part that is actually hard.
 */

const PROMPT = "Bridge 1,000 USDC to Base and lend it at 8%";

/** Frames from the scene start, for the four beats of the plan. */
const TYPE_AT = 12;
const STEPS = [
  { at: 84, title: "Approve USDC", detail: "Sepolia · spend cap 1,000.00" },
  {
    at: 112,
    title: "Bridge to Base",
    detail: "Sepolia → Base Sepolia · ~2 min",
  },
  {
    at: 140,
    title: "Create lending offer",
    detail: "Base Sepolia · 8.00% APY",
  },
];

const Step: React.FC<{
  at: number;
  index: number;
  title: string;
  detail: string;
}> = ({ at, index, title, detail }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - at,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: 18,
  });

  /* The tick draws 10 frames after the row lands, not with it. The row appearing
     is the agent proposing the step; the tick is the step being checked. Playing
     both at once collapses two different events into one. */
  const tick = interpolate(frame, [at + 10, at + 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "18px 22px",
        borderRadius: 16,
        background: C.well,
        border: `1px solid ${C.line}`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 14}px)`,
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: "50%",
          border: `1px solid ${C.lineBright}`,
          fontFamily: F.mono,
          fontSize: 17,
          color: C.t2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: F.sans,
            fontSize: 26,
            fontWeight: 535,
            color: C.t1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 18,
            color: C.t3,
            marginTop: 4,
          }}
        >
          {detail}
        </div>
      </div>
      <Tick progress={tick} size={28} />
    </div>
  );
};

export const AgentScene: React.FC = () => {
  const frame = useCurrentFrame();

  /* The composer's ring goes green while the line is being typed and settles once
     the plan starts arriving — focus moving from the input to the output. */
  const typing = frame >= TYPE_AT && frame < STEPS[0].at;

  return (
    <SceneFade>
      <Stage>
        <Rise>
          <Eyebrow>One instruction</Eyebrow>
        </Rise>

        <Rise delay={6} style={{ marginTop: 26, width: 1000 }}>
          <Panel
            style={{
              padding: "26px 30px",
              display: "flex",
              alignItems: "center",
              gap: 16,
              textAlign: "left",
              border: `1px solid ${typing ? "rgba(0,179,131,0.55)" : C.line}`,
              boxShadow: typing
                ? "inset 0 1px 0 rgba(250,249,245,0.10), 0 0 0 4px rgba(0,179,131,0.12), 0 24px 60px rgba(0,0,0,0.55)"
                : "inset 0 1px 0 rgba(250,249,245,0.10), 0 24px 60px rgba(0,0,0,0.55)",
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 26,
                color: C.brand,
                flex: "none",
              }}
            >
              &gt;
            </div>
            <Typed
              text={PROMPT}
              start={TYPE_AT}
              cps={24}
              style={{
                fontFamily: F.mono,
                fontSize: 27,
                color: C.t1,
                letterSpacing: "-0.01em",
              }}
            />
          </Panel>
        </Rise>

        <Rise delay={72} style={{ marginTop: 30 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 20,
              fontWeight: 535,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: C.t3,
            }}
          >
            Plan · 3 steps
          </div>
        </Rise>

        <div
          style={{
            width: 1000,
            marginTop: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {STEPS.map((s, i) => (
            <Step key={s.title} index={i} {...s} />
          ))}
        </div>

        <Rise delay={168} style={{ marginTop: 28 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 26,
              fontWeight: 485,
              color: C.t2,
            }}
          >
            Priced, routed, and yours to sign.
          </div>
        </Rise>
      </Stage>
    </SceneFade>
  );
};
