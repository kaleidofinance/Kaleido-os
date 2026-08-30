"use client";

import { useEffect, useRef, useState } from "react";

import WalletAvatar, {
  AVATAR_STYLES,
  AVATAR_STYLE_LABELS,
  setAvatarStyle,
  useAvatarStyle,
} from "@/components/v2/WalletAvatar";

import s from "./AvatarPicker.module.css";

/**
 * The profile avatar, and the six samples behind it.
 *
 * The avatar is generated from the connected address (WalletAvatar.tsx), so what
 * the reader picks here is which of six geometries their own seed is drawn with —
 * the colours are their wallet's either way. Every sample is rendered with their
 * address for exactly that reason: a picker showing six strangers' avatars asks
 * the reader to imagine the result instead of seeing it.
 *
 * Anchored to the avatar rather than opened as a modal, and no scrim behind it —
 * the same call WalletMenu makes, for the same reason: six swatches is not a
 * gesture worth darkening the page for. It does not need WalletMenu's `Portal`
 * either, because this header has no `backdrop-filter` ancestor to become the
 * containing block for a fixed child.
 *
 * The control is absent, not disabled, when no wallet is connected: with no
 * address there is no art to choose between, and a live-looking button that opens
 * a panel of empty plates is worse than nothing there.
 */
export default function AvatarPicker({ address }: { address: string | null }) {
  const current = useAvatarStyle();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    /* Pointerdown rather than click: a click that starts inside the panel and ends
       outside it is a drag, not a dismissal, and `click` fires on the common
       ancestor for that. */
    const onDown = (e: PointerEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!address) return <WalletAvatar address={null} size={44} />;

  return (
    <div className={s.anchor} ref={anchorRef}>
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Change avatar"
        title="Change avatar"
      >
        <WalletAvatar address={address} size={44} />
      </button>

      {open && (
        <div className={s.panel} role="radiogroup" aria-label="Avatar style">
          {AVATAR_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={`${s.opt} ${style === current ? s.on : ""}`}
              /* Radio inside a radiogroup, not six plain items: these are one
                 setting with one answer, and `aria-checked` is what says which
                 answer is live. */
              role="radio"
              aria-checked={style === current}
              aria-label={AVATAR_STYLE_LABELS[style]}
              title={AVATAR_STYLE_LABELS[style]}
              onClick={() => {
                setAvatarStyle(style);
                setOpen(false);
              }}
            >
              <WalletAvatar address={address} size={38} style={style} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
