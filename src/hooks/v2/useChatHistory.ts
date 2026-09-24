"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Intent } from "@/lib/v2/intents";
import { renderIntent } from "@/lib/v2/intents";
import type { AgentCard } from "@/lib/v2/cards/types";
import { localCards } from "@/lib/v2/cards";
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
  /**
   * Present when a turn produced a signable plan. Never persisted — a stale
   * signable is the one thing that must not come back (toStored keeps its step
   * titles as `planSummary` instead).
   */
  plan?: Intent[];
  /**
   * The step to resume this plan at — set when the review panel stops part-way
   * (a decline, a revert, a pause) so re-opening the plan does not re-sign the
   * steps that already landed. Never persisted, for the same reason as `plan`.
   */
  planFrom?: number;
  /**
   * When this turn was produced, epoch ms. Two readers: within a session, a plan
   * carries quotes priced at this instant so PlanReview can refuse a quote that has
   * since gone stale; and across a reload it is the "as of" a restored turn's
   * dimmed cards are dated with. Persisted for the second reader.
   */
  ts?: number;
  /**
   * Data frames for this turn. Persisted now, but a restored turn is marked
   * `historical` and its cards render dimmed and dated — a snapshot from earlier,
   * not a reading of now. See toStored/fromStored.
   */
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
   * Dropped on reload by `toStored` — unlike `cards`, which now survive as a dated
   * snapshot — because it encodes a pair and a chain that were the wallet's when
   * the turn was written, and it opens a form, which a record should not.
   */
  link?: { href: string; label: string };
  /**
   * How the answer was reached: the steps the page took, and for a model turn the
   * read tools it called. Persisted, unlike `plan` and `cards`, because it is a
   * record of what happened rather than a claim about what is currently true —
   * the same class of thing as the prose it sits under.
   */
  thinking?: string[];
  /**
   * The step titles a plan proposed, kept as a plain record when the signable
   * `plan` itself is dropped on reload.
   *
   * This is the safe half of the plan: "Approve USDC", "Swap USDC → KLD" is a
   * sentence about what was proposed, where the `Intent[]` is a transaction
   * authorised against prices and a chain that have since moved. So the summary
   * persists and the plan does not — a reloaded turn shows what it offered without
   * offering to sign it again.
   */
  planSummary?: string[];
  /** Safe resume marker only; signable intents are never persisted. */
  planFrom?: number;
  /**
   * True for a turn read back from storage, false (absent) for one produced this
   * session. The renderer reads it to mark a restored turn's cards as a snapshot
   * from earlier rather than a reading of now — the distinction the old code drew
   * by dropping the cards entirely.
   */
  historical?: boolean;
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
 * What survives a reload, and in what form. The rule is one test: a reloaded turn
 * may show what it SAID and what it DID, but must never re-present as CURRENT
 * anything that was a reading of the moment.
 *
 * `plan` — the signable `Intent[]` — never comes back: it is a transaction
 * authorised against prices, a health factor and a chain that were true when it
 * was proposed, and rehydrating one would put "Review and sign · 2 transactions"
 * in front of a market that has since moved. Its step titles come back instead as
 * `planSummary`: "Approve USDC", "Swap USDC → KLD" is a record of what was offered,
 * not an offer to sign it again.
 *
 * `cards` DO come back now — the change that prompted this — but marked
 * `historical`, so the renderer shows them dimmed and dated, a snapshot from
 * earlier rather than a reading of now. The old code dropped them for the right
 * reason (a restored balance card presents yesterday's number in the present
 * tense); labelling them as past keeps the record without the lie. They pass
 * through `localCards`, the same gate a live card does, so a hand-edited store
 * cannot inject a shape the renderer has not vetted.
 *
 * `thinking` and `ts` survive untouched: the trace reads as history however long
 * ago, and `ts` is the "as of" the dimmed cards show. `link` does not — it encodes
 * a pair and chain that were the wallet's then.
 *
 * MAX_THINKING_LINE is imported rather than repeated: this filter DROPS an
 * over-long line instead of trimming it, so a disagreement with the writer's cap
 * would render right up until a reload and then vanish.
 */
const MAX_THINKING = 12;
const MAX_SUMMARY_STEPS = 10;
const MAX_SUMMARY_LEN = 80;

const reviveThinking = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw.filter(
    (l): l is string =>
      typeof l === "string" && l.length > 0 && l.length <= MAX_THINKING_LINE,
  );
  return lines.length ? lines.slice(0, MAX_THINKING) : undefined;
};

const reviveSummary = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw
    .filter((l): l is string => typeof l === "string" && l.length > 0)
    .slice(0, MAX_SUMMARY_STEPS)
    .map((l) => l.slice(0, MAX_SUMMARY_LEN));
  return lines.length ? lines : undefined;
};

/** A plan's step titles — the record kept once the signable plan is dropped. */
const summarize = (plan?: Intent[]): string[] | undefined => {
  if (!plan?.length) return undefined;
  try {
    return plan
      .slice(0, MAX_SUMMARY_STEPS)
      .map((i) => renderIntent(i).title.slice(0, MAX_SUMMARY_LEN));
  } catch {
    return undefined;
  }
};

/** The stored shape: what a turn said and did, never a live signable or a
 *  present-tense reading. One writer for the storage effect and the anon hand-off,
 *  so the two paths cannot drift. */
interface StoredMsg {
  role: "user" | "assistant";
  text: string;
  via?: "local" | "model";
  thinking?: string[];
  cards?: AgentCard[];
  ts?: number;
  planSummary?: string[];
  planFrom?: number;
}

const toStored = (messages: Msg[]): StoredMsg[] =>
  messages.slice(-MAX_TURNS).map((m) => {
    const kept = reviveThinking(m.thinking);
    /* Already-historical turns carry a summary; live ones derive it from the plan
       that is about to be dropped. */
    const summary = m.planSummary ?? summarize(m.plan);
    return {
      role: m.role,
      text: m.text,
      ...(m.via === "local" || m.via === "model" ? { via: m.via } : {}),
      ...(kept ? { thinking: kept } : {}),
      ...(m.cards?.length ? { cards: m.cards } : {}),
      ...(typeof m.ts === "number" ? { ts: m.ts } : {}),
      ...(summary ? { planSummary: summary } : {}),
      ...(typeof m.planFrom === "number" ? { planFrom: m.planFrom } : {}),
    };
  });

const fromStored = (raw: unknown): Msg[] => {
  if (!Array.isArray(raw)) return [];
  const out: Msg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { role, text, via, thinking, cards, ts, planSummary, planFrom } =
      m as Partial<Msg>;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof text !== "string" || !text) continue;
    const kept = reviveThinking(thinking);
    const revived = Array.isArray(cards) ? localCards(cards as AgentCard[]) : [];
    const summary = reviveSummary(planSummary);
    out.push({
      role,
      text,
      historical: true,
      ...(via === "local" || via === "model" ? { via } : {}),
      ...(kept ? { thinking: kept } : {}),
      ...(revived.length ? { cards: revived } : {}),
      ...(typeof ts === "number" ? { ts } : {}),
      ...(summary ? { planSummary: summary } : {}),
      ...(typeof planFrom === "number" && planFrom > 0 ? { planFrom } : {}),
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
      if (raw) next = fromStored(JSON.parse(raw));
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
      /* The in-memory thread, kept live — cards and plan intact — because the
         connect is a step IN this conversation, not a reload of a past one. It is
         re-serialized (and so reduced to its stored shape) on the next persist. */
      const carried = live.current.slice(-MAX_TURNS);
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
      else sessionStorage.setItem(k, JSON.stringify(toStored(messages)));
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
