import { continueRender, delayRender, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";

/**
 * Loads the app's own typefaces before the first frame renders.
 *
 * The three woff files in ./public are copies of the ones in
 * src/app/fonts/ — the same files next/font serves in the product, so the video
 * and the app are set in the same type rather than in something that looks close.
 *
 * The explicit delayRender is not redundant belt-and-braces. A render that starts
 * before the font is parsed lays the frame out in the fallback, and because the
 * fallback metrics differ the text is a different width — so the first frames of
 * a cut are subtly misaligned and nothing errors. delayRender holds every frame
 * until all three have resolved.
 *
 * The catch continues the render rather than leaving it hanging: a missing font
 * should produce a video in the fallback face, which is fixable, instead of a
 * render that times out after 30 seconds with no output at all.
 */
const handle = delayRender("Loading Kaleido typefaces");

export const fontsReady = Promise.all([
  loadFont({
    family: "KaleidoSans",
    url: staticFile("GeistVF.woff"),
    /* The variable axis, not a single weight. The design tokens ask for 485 and
       535, which only exist on a continuous axis — pinned to "400" these would
       round and the type would lose the texture it has in the product. */
    weight: "100 900",
  }),
  loadFont({
    family: "KaleidoDisplay",
    url: staticFile("zen-dots-400.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "KaleidoMono",
    url: staticFile("GeistMonoVF.woff"),
    weight: "100 900",
  }),
])
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));
