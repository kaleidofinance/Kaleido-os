"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Intent } from "@/lib/v2/intents";
import type { AgentCard } from "@/lib/v2/cards/types";
import { MAX_THINKING_LINE } from "@/lib/v2/chatStream";

/**
 * The agent transcript, persisted per wallet and bounded.
 *
 * Owns what used to be a bare `useState<Msg[]>` on the agent page. Three things
 * that state could not do, and this can:
 *
 * 1. Survive a reload, and survive navigating to /trade/swap and back — that
 *    route unmounts, so an in-memory thread died on every tab change.
 * 2. Stay scoped to one wallet. The key carries the address, so switching
 *    accounts loads that account's thread rather than showing you the previous
 *    one's.
 * 3. Stop growing forever. The well scrolls, so an unbounded array never broke
 *    the layout — it just sat in memory and in storage.
 */
export interface Msg {
  role: "user" | "assistant";
  text: string;
  /** Present when a turn produced a signable plan. Never persisted — see below. */
  plan?: Intent[];
  /** Data frames for this turn. Never persisted, for the same reason as `plan`. */
  cards?: AgentCard[];
  /** Which path answered. Surfaced so the cheap path is visible, not implied. */
  via?: "local" | "model";
  /**
   * A route this turn offers, rendered as a control under the answer.
   *
   * LOCAL ONLY, and that is a property of the code rather than a convention: a
   * model turn is assembled from `via`, `plan` and `cards` explicitly (see
   * finish() on the agent page), so there is no path by which a reply over the
   * wire can set this. Which is what keeps it out of AgentCard, whose whole
   * contract is that the renderer cannot tell a local card from a model one — a
   * card must therefore never carry a URL, and this is not a card.
   *
   * Dropped on reload with `plan` and `cards`, by the allow-list in revive()
   * below rather than by a rule of its own. Right for the same reason: it
   * encodes a pair and a chain that were the wallet's when the turn was written.
   */
  link?: { href: string; label: string };
  /**
   * How the answer was reached: the steps the page took, and for a model turn the
   * read tools it called. Persisted, unlike `plan` and `cards`, because it is a
   * record of what happened rather than a claim about what is currently true —
   * the same class of thing as the prose it sits under.
   */
  thinking?: string[];
}

/**
 * sessionStorage, deliberately, where agent *settings* use localStorage.
 *
 * Settings are a standing preference and should outlive the tab. A transcript is
 * a conversation about money on a machine that may not be yours alone: "swap 500
 * USDC", "explain my health factor" and Luca's answers about your positions are
 * all in it. Clearing when the tab closes is the behaviour a wallet UI should
 * have, and it still fixes the actual complaint — reloads and route changes.
 */
const key = (address?: string) => `kaleido.v2.agentThread.${address ?? "anon"}`;

/**
 * Turns kept. Enough that scrolling back through a working session finds what
 * you are looking for, small enough that the stored payload stays trivial and
 * an all-day tab has a ceiling.
 */
const MAX_TURNS = 40;

/**
 * Strips everything that must not come back from storage.
 *
 * `plan` is the important one, and it is a security property rather than a size
 * one: an `Intent[]` is a signable transaction, authorised against prices, a
 * health factor and a chain that were true when it was proposed. Rehydrating one
 * would put a "Review and sign · 2 transactions" button in front of you for a
 * plan built against a market that has since moved. The plan dies with the page;
 * the CTA falls back to "Ask Luca", and asking again re-plans against now.
 *
 * `cards` go for the same reason, one step weaker but the same kind of wrong: a
 * balance card is a snapshot with a timestamp it does not display. Restored
 * after a reload it presents yesterday's number in the present tense, and a
 * frame around a figure is precisely what makes it look authoritative. The prose
 * survives, because a sentence about a number reads as something that was said;
 * a card reads as something that is true.
 *
 * `thinking` does survive, and the same test decides it: "Read your balances",
 * "Quoted USDC → KLD" describe steps that were taken at the time, and they read
 * as history however long ago they were written. Bounded here rather than
 * trusted, since one entry per tool call is a length the model influences.
 *
 * The per-line bound is `MAX_THINKING_LINE`, imported rather than repeated: this
 * filter *drops* an over-long line instead of trimming it, so if it and the
 * writer's cap ever disagreed, the longer lines would render correctly right up
 * until a reload and then be gone.
 */
const MAX_THINKING = 12;

const reviveThinking = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw.filter(
    (l): l is string =>
      typeof l === "string" && l.length > 0 && l.length <= MAX_THINKING_LINE,
  );
  return lines.length ? lines.slice(0, MAX_THINKING) : undefined;
};

const revive = (raw: unknown): Msg[] => {
  if (!Array.isArray(raw)) return [];
  const out: Msg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { role, text, via, thinking } = m as Partial<Msg>;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof text !== "string" || !text) continue;
    const kept = reviveThinking(thinking);
    out.push({
      role,
      text,
      ...(via === "local" || via === "model" ? { via } : {}),
      ...(kept ? { thinking: kept } : {}),
    });
  }
  return out.slice(-MAX_TURNS);
};

export function useChatHistory(address?: string) {
  const [messages, setRaw] = useState<Msg[]>([]);
  /**
   * False until storage has been read for the current address. The persist
   * effect below is gated on it: without the gate, the initial empty array
   * would be written over a real stored thread before hydration ever ran.
   */
  const [hydrated, setHydrated] = useState(false);

  /*
   * Which key the current `messages` belong to. The persist effect fires after
   * a render in which the address may already have changed, and writing this
   * wallet's thread under the next wallet's key is how you leak one account's
   * conversation into another's.
   */
  const hydratedKey = useRef<string | null>(null);

  /*
   * The thread as of the last render, readable from an effect that must not
   * re-run when it changes. Used for the anon hand-off below.
   */
  const live = useRef<Msg[]>([]);
  live.current = messages;

  /** Whether the previous render had no wallet, so the direction is known. */
  const wasAnon = useRef(true);

  useEffect(() => {
    const k = key(address);
    setHydrated(false);
    let next: Msg[] = [];
    try {
      const raw = sessionStorage.getItem(k);
      if (raw) next = revive(JSON.parse(raw));
    } catch {
      /* unavailable, disabled, or unparseable — start clean rather than throw */
    }

    /*
     * Connecting a wallet mid-conversation keeps the conversation.
     *
     * Scoping threads by address is right, but applied naively it means asking
     * Luca something, connecting a wallet to act on the answer, and watching the
     * exchange disappear at the exact moment it became useful. The connect was
     * a step *in* that conversation, not a change of subject.
     *
     * Strictly one direction and only into an empty thread: anon → wallet, when
     * that wallet has nothing stored. Disconnecting does NOT carry the thread
     * down to anon — that would leave one account's conversation on screen for
     * whoever connects next — and switching between two wallets never merges,
     * because the second one either has its own thread or starts clean.
     */
    if (wasAnon.current && address && next.length === 0) {
      const carried = revive(live.current);
      if (carried.length > 0) {
        next = carried;
        try {
          sessionStorage.removeItem(key(undefined));
        } catch {
          /* nothing to clean up if storage is unavailable */
        }
      }
    }
    wasAnon.current = !address;

    hydratedKey.current = k;
    setRaw(next);
    setHydrated(true);
  }, [address]);

  useEffect(() => {
    const k = key(address);
    // Only write once this address's read has landed, and only to its own key.
    if (!hydrated || hydratedKey.current !== k) return;
    try {
      if (messages.length === 0) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, JSON.stringify(revive(messages)));
    } catch {
      /* storage full or unavailable — the thread stays in-memory */
    }
  }, [messages, address, hydrated]);

  /**
   * Same shape as a `useState` setter, so every existing call site keeps its
   * updater form and its object identity — `onComplete` on the page compares
   * turns by reference to find the one that owns the spent plan.
   *
   * The cap is applied here, as a pure computation inside the updater, rather
   * than as an effect that trims after the fact. Trimming in an effect means a
   * render where the array is over the cap, and a second render to correct it.
   */
  const setMessages = useCallback(
    (updater: Msg[] | ((prev: Msg[]) => Msg[])) => {
      setRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        return next.length > MAX_TURNS ? next.slice(-MAX_TURNS) : next;
      });
    },
    [],
  );

  const clear = useCallback(() => setRaw([]), []);

  return { messages, setMessages, clear, hydrated };
}
