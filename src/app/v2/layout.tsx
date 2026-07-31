import "./tokens.css";
import type { ReactNode } from "react";

/**
 * v2 surface root.
 *
 * Nests inside the app's root layout (which supplies the wallet providers,
 * fonts, and globals.css), but scopes all v2 styling under .kaleido-v2 so
 * nothing leaks either way: the legacy app is untouched, and the legacy
 * global CSS is overridden within this subtree.
 *
 * Data comes from the existing hooks unchanged — only the presentation is new.
 */
export default function V2Layout({ children }: { children: ReactNode }) {
  return <div className="kaleido-v2">{children}</div>;
}
