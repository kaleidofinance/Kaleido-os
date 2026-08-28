"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { envVars } from "@/constants/envVars";
import {
  CODE_LENGTH,
  HTML_ATTR,
  OPEN_VALUE,
  SHELL_ID,
  STORAGE_KEY,
  normaliseCode,
} from "@/lib/beta";

import s from "./BetaGate.module.css";

/**
 * The private-testnet access card: six character boxes over a blurred app.
 *
 * Mounted once, in `(app)/layout.tsx`, so it covers every product route — /trade,
 * /pool, the lending pages, /stake, /stable, /portfolio, /faucet, /leaderboard,
 * /notifications — and nothing in `(marketing)`. The landing page and /docs are a
 * different route group and never see this, which is the point: the marketing
 * site stays open so the waitlist form can be reached, and the product is what
 * needs a code.
 *
 * HOW THE FLASH IS AVOIDED, WHICH DICTATES THE SHAPE OF THIS COMPONENT.
 * Whether someone has already unlocked is in localStorage, which the server
 * cannot read — so a naive `useState(() => localStorage.get(...))` mismatches
 * hydration, and reading it in an effect means React has already painted the
 * locked state and a returning visitor sees the blur flash on every navigation.
 * The fix is the same one the theme uses (see `themeScript` in the root layout):
 * a blocking inline script sets `data-beta="open"` on `<html>` before first
 * paint, and the *visual* state — blur on, card visible — is CSS keyed off that
 * attribute. React never owns it.
 *
 * So this component renders the card unconditionally on the server and on the
 * first client render, and hydration matches because both sides emit the same
 * markup. CSS has already hidden it for a returning visitor. The effect below
 * then removes it from the DOM, which is cleanup rather than the mechanism.
 *
 * On a successful unlock the order matters: write storage, set the attribute
 * (the CSS lifts the blur on the next frame), then drop the card.
 */

type Status =
  /** Nothing typed yet, or typing resumed after a failure. */
  | "idle"
  /** A request is in flight. */
  | "checking"
  /** The server said no. */
  | "wrong"
  /** The server has no code configured — an operator problem, not the visitor's. */
  | "unconfigured"
  /** The request never arrived. */
  | "offline";

const EMPTY = (): string[] => Array<string>(CODE_LENGTH).fill("");

export default function BetaGate() {
  const [locked, setLocked] = useState(true);
  const [chars, setChars] = useState<string[]>(EMPTY);
  const [status, setStatus] = useState<Status>("idle");
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const open = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, OPEN_VALUE);
    } catch {
      /* Safari private mode throws on setItem. The unlock still applies to this
         page load; it just will not survive a reload. Better than refusing. */
    }
    document.documentElement.setAttribute(HTML_ATTR, OPEN_VALUE);
    setLocked(false);
  }, []);

  /* Already unlocked in a previous session? Drop the card. Otherwise put the
     caret in the first box, so a visitor holding a code can type immediately
     rather than hunting for the input. */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* Storage disabled entirely. Treat as locked and ask for the code. */
    }
    if (stored === OPEN_VALUE) {
      open();
      return;
    }
    boxes.current[0]?.focus();
  }, [open]);

  /*
   * `pointer-events: none` in the stylesheet stops the mouse reaching the
   * blurred page, but it does nothing for the keyboard — Tab out of the last box
   * lands on the nav, and Enter there can open the wallet modal behind the card.
   * `inert` is the only attribute that removes a subtree from the tab order and
   * the accessibility tree together, and it cannot be set from the layout because
   * that is a server component. Hence reaching for the shell by id from here.
   */
  useEffect(() => {
    const shell = document.getElementById(SHELL_ID);
    if (!shell) return;
    if (locked) shell.setAttribute("inert", "");
    else shell.removeAttribute("inert");
    return () => shell.removeAttribute("inert");
  }, [locked]);

  const submit = useCallback(
    async (code: string) => {
      setStatus("checking");
      try {
        const res = await fetch("/api/beta/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (res.ok) {
          open();
          return;
        }
        if (res.status === 503) {
          setStatus("unconfigured");
          return;
        }
        setStatus("wrong");
        setChars(EMPTY());
        boxes.current[0]?.focus();
      } catch {
        setStatus("offline");
      }
    },
    [open],
  );

  /**
   * Writes one or more characters starting at `i`.
   *
   * More than one because a paste arrives here too (see `onPaste`), and because
   * some soft keyboards commit a whole word at once. Spreading rather than
   * truncating is what makes pasting a code from an email fill all six boxes.
   */
  const write = (i: number, raw: string) => {
    const cleaned = normaliseCode(raw);
    const next = [...chars];
    if (cleaned) {
      for (let k = 0; k < cleaned.length && i + k < CODE_LENGTH; k++) {
        next[i + k] = cleaned[k];
      }
    } else {
      /* An empty value is a deletion — or a character the filter rejected, which
         is treated the same way rather than silently keeping the old one. */
      next[i] = "";
    }
    setChars(next);
    if (status !== "checking") setStatus("idle");

    if (cleaned) {
      boxes.current[Math.min(i + cleaned.length, CODE_LENGTH - 1)]?.focus();
    }
    /* Six non-empty boxes is the only way this reaches length six, since empty
       strings contribute nothing to the join. Auto-submit: nobody wants to reach
       for a button after typing the last character of a code. */
    const joined = next.join("");
    if (joined.length === CODE_LENGTH) void submit(joined);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !chars[i] && i > 0) {
      /* Backspace in an already-empty box steps back and clears the one behind,
         which is what every code input does and what the hand expects. */
      e.preventDefault();
      const next = [...chars];
      next[i - 1] = "";
      setChars(next);
      setStatus("idle");
      boxes.current[i - 1]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      boxes.current[i - 1]?.focus();
      return;
    }
    if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) {
      e.preventDefault();
      boxes.current[i + 1]?.focus();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const joined = chars.join("");
      if (joined.length === CODE_LENGTH) void submit(joined);
    }
  };

  /* maxLength={1} makes the browser truncate a paste to one character, so the
     paste has to be intercepted and spread by hand. Always from box 0: a code
     pasted into the fourth box is still the whole code. */
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    write(0, e.clipboardData.getData("text"));
  };

  if (!locked) return null;

  const complete = chars.join("").length === CODE_LENGTH;
  const message =
    status === "wrong"
      ? "That code isn't recognised. Check the one in your invitation."
      : status === "unconfigured"
        ? "Access codes aren't configured on this deployment yet."
        : status === "offline"
          ? "Couldn't reach the server. Try that again."
          : null;

  return (
    <div className={s.overlay}>
      <div
        className={`${s.card} k-glass-raised`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-title"
      >
        <span className={s.eyebrow}>Private testnet</span>
        <h1 id="beta-title" className={s.title}>
          Enter your access code
        </h1>
        <p className={s.body}>
          Kaleido runs on public testnets with a private group of testers while
          we put the protocol through real transactions. Your six-character code
          came with your invitation.
        </p>

        <div className={s.boxes} onPaste={onPaste}>
          {chars.map((c, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              className={s.box}
              value={c}
              onChange={(e) => write(i, e.currentTarget.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              /* Selecting on focus is what lets a filled box be overtyped:
                 maxLength={1} would otherwise reject the keystroke and the
                 visitor would have to delete before correcting. */
              onFocus={(e) => e.currentTarget.select()}
              maxLength={1}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={status === "checking"}
              aria-label={`Access code character ${i + 1} of ${CODE_LENGTH}`}
              aria-invalid={status === "wrong"}
            />
          ))}
        </div>

        {/* Live, because after a wrong code the boxes are cleared and refocused —
            a screen reader user would otherwise get no account of why. */}
        <p className={s.msg} role="status" aria-live="polite">
          {message}
        </p>

        <button
          type="button"
          className={s.cta}
          disabled={!complete || status === "checking"}
          onClick={() => void submit(chars.join(""))}
        >
          {status === "checking" ? "Checking…" : "Unlock"}
        </button>

        {/* Only rendered once there is a form to point at. A gate that offers a
            codeless visitor nothing is a dead end for exactly the audience the
            waitlist is for — but inventing a URL would be worse. */}
        {envVars.waitlistUrl && (
          <a
            className={s.waitlist}
            href={envVars.waitlistUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            No code? Join the private testnet waitlist
          </a>
        )}
      </div>
    </div>
  );
}
