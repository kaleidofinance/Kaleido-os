"use client";

import { useEffect, type ReactNode } from "react";
import Portal from "@/components/v2/Portal";
import s from "../pool.module.css";

/**
 * The dialog shell both of this section's modals sit in.
 *
 * Portalled, for the reason `Portal` documents at length: `backdrop-filter`
 * creates a containing block for `position: fixed` descendants, so a scrim
 * rendered inside the pools table — which is a glass surface — would cover the
 * table rather than the viewport. That has been a visible bug twice already in
 * this app.
 *
 * Shared rather than written twice because what would be duplicated is the escape
 * listener, the click-outside and the two ARIA attributes, and the second copy is
 * where one of those quietly goes missing. `BorrowModals` has the same shell and
 * is deliberately not imported: it is a lending component bound to a lending CSS
 * module, and reaching across the section for a thirty-line wrapper would couple
 * two pages' modals to one stylesheet.
 */
export default function PoolModal({
  title,
  onClose,
  children,
  /** For the deposit form, which is a column of fields rather than a short list. */
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={`${s.modal} ${wide ? s.modalWide : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.mh}>
            <span className={s.mt}>{title}</span>
            <button className={s.mx} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className={s.mb}>{children}</div>
        </div>
      </div>
    </Portal>
  );
}
