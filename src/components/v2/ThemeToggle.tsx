"use client";

import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "dark" | "light";

const KEY = "kaleido-theme";

/**
 * Dark/light switch.
 *
 * The initial theme is *not* decided here. An inline script in
 * src/app/layout.tsx sets `data-theme` on <html> before first paint, because
 * doing it in an effect means React has already painted dark and a light-mode
 * user sees a flash on every load. This component's only job is to read what
 * that script decided and to flip it on click.
 *
 * `mounted` guards the label: on the server there is no way to know which
 * theme the script will pick, so rendering a definite icon during SSR would
 * hydrate mismatched. Until mount the button renders its glyph as empty and
 * holds its size, which is invisible in practice at ~one frame.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Safari private mode throws on write. The theme still applies for
      // this session; only persistence is lost.
    }
  };

  return (
    <button
      className={styles.btn}
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      <span aria-hidden="true">
        {!mounted ? "" : theme === "dark" ? "☾" : "☀"}
      </span>
    </button>
  );
}
