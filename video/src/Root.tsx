import React from "react";
import { Composition } from "remotion";

import { Launch } from "./Launch";
import { FPS, TOTAL } from "./theme";

/**
 * Three cuts of the same 30 seconds.
 *
 * `LaunchWide` (16:9) is the one to post: X renders it largest in a timeline and
 * it is the safest embed anywhere else. The square and vertical cuts exist because
 * the same asset gets asked for by Instagram, TikTok and Shorts within a day of a
 * launch, and re-cutting under that pressure is when a wordmark ends up cropped.
 *
 * All three run the identical component. Nothing is conditioned on aspect ratio —
 * `Stage` scales the 1200x900 logical canvas to fit, so the composition is
 * complete in every frame size and only the surrounding backdrop changes.
 * `TOTAL` and `FPS` come from theme.ts so the three cannot drift in length.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="LaunchWide"
      component={Launch}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="LaunchSquare"
      component={Launch}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1080}
      height={1080}
    />
    <Composition
      id="LaunchVertical"
      component={Launch}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1080}
      height={1920}
    />
  </>
);
