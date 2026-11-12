"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveWallet, useSwitchActiveWalletChain } from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { isAddress } from "ethers";
import { toast } from "sonner";
import { chainTokens, tokensAcrossChains } from "@/constants/tokens";
import { useTestnetMode } from "@/hooks/v2/useTestnetMode";
import {
  CHAINS,
  getChainMeta,
  toThirdwebChainOptions,
  type ChainMeta,
} from "@/constants/chains";
import { isDeployed } from "@/constants/registry";
import ChainIcon from "./ChainIcon";
import TokenIcon, { hasTokenIcon } from "./TokenIcon";
import VerifiedBadge, { verifiedTitleFor } from "./VerifiedBadge";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import Portal from "./Portal";
import Chevron from "./Chevron";
import s from "./TokenSelector.module.css";

/**
 * TokenSelector — global tier.
 *
 * Any page may open one. It takes params (the current selection, a callback)
 * and returns a result; it knows nothing about which page opened it. That's
 * the ownership rule from the component map: page-owned components may not
 * be imported across pages, but global ones are built to be.
 *
 * Balances are fetched per-row with the existing useTokenBalance hook rather
 * than pre-loaded, so opening the list is instant and each row fills in as
 * its own call resolves — the same pattern the skeleton in Portfolio uses.
 *
 * THE RESULT IS ALWAYS USABLE ON THE WALLET CHAIN, and that is this component's
 * job rather than each caller's.
 *
 * The list spans every chain in the registry and the network filter is a
 * control, so a user can reach USDC on Base while their wallet is on Sepolia.
 * Handing that token back unchanged is what used to happen, and both callers
 * then acted on it against the *wallet's* router: the swap form quoted a Base
 * address through Sepolia's quoter and rendered an empty amount with no
 * explanation, and /pool/new offered to create a position on a pair that does
 * not exist. Nothing in either form was wrong; the picker had returned a token
 * from a chain the form could not reach.
 *
 * So a pick from another chain switches the wallet there first, and `onSelect`
 * fires only once the switch lands. That turns the network filter from a trap
 * into what it looks like — a way to get to a token wherever it lives — and it
 * is the same contract NetworkSelector already implements for chains.
 *
 * The one assumption is that the caller acts on the WALLET chain. Both do. A
 * picker on a read-chain surface (lending reads READ_ONLY_CHAIN_ID regardless of
 * where the wallet is) would need to say so explicitly rather than inherit this.
 */

interface TokenSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (token: IToken) => void;
  /**
   * The other side of the pair, excluded because a token cannot be swapped or
   * pooled against itself.
   *
   * The whole token, not its symbol. Excluding by symbol was wrong in both
   * directions at once: it hid Sepolia's USDC when the other side was Base's
   * USDC (different assets, a perfectly good pair) and it offered Base's USDC
   * when the other side was Base's USDC (the same asset, a pair that can never
   * quote). Identity is (chainId, address) — rule 1 in the registry header.
   */
  exclude?: IToken | null;
  /** Eagerly switch the wallet to a cross-chain pick before returning it
   *  (the default, for forms that act on the wallet's chain). The Swap card
   *  passes false: it prices any chain read-only and switches only at signing,
   *  so a pick must come back on its own chain without moving the wallet. */
  switchOnSelect?: boolean;
  /**
   * Optional product constraint. Swap accepts native assets; a V3 liquidity
   * position accepts ERC-20 contracts only. Filtering here prevents a caller
   * from offering a row it has to silently replace after selection.
   */
  tokenFilter?: (token: IToken) => boolean;
}

function TokenRow({
  token,
  onSelect,
  switches,
  disabled,
}: {
  token: IToken;
  onSelect: (t: IToken) => void;
  /** Picking this row will switch the wallet's network first. */
  switches: boolean;
  disabled: boolean;
}) {
  const { balance, loading, unread } = useTokenBalance(token);
  const hasBalance = !loading && !unread && Number(balance) > 0;
  /* The token's own chain, not the connected one. In a multichain list those
     differ for most rows, and labelling a Base token with the wallet's current
     chain is the (chainId, address) confusion this registry exists to stop. */
  const meta = getChainMeta(token.chainId);

  const launchpadTag = (token.tags ?? []).find(
    (tag) =>
      tag !== "custom" &&
      tag !== "argus" &&
      tag !== "peach" &&
      tag !== "elysium" &&
      tag !== "meme" &&
      tag !== "stablecoin" &&
      tag !== "stock" &&
      tag !== "wrapped-native" &&
      tag !== "wrapped-btc" &&
      tag !== "governance",
  );
  const isCustom = token.tags?.includes("custom");
  const launchpadLabel = launchpadTag
    ? `${launchpadTag.charAt(0).toUpperCase() + launchpadTag.slice(1)} launch`
    : token.tags?.includes("argus")
    ? "Argus launch"
    : token.tags?.includes("peach")
    ? "Peach launch"
    : null;

  return (
    <button
      className={s.row}
      onClick={() => onSelect(token)}
      disabled={disabled}
    >
      {/* The disc drops its grey fill once a real logo lands in it. A token mark
          is already a filled circle, so keeping the plate behind it draws a ring
          of a second colour around every branded row. */}
      <span
        className={`${s.tki} ${hasTokenIcon(token.symbol) || token.logoURI ? s.tkiArt : ""}`}
      >
        {token.logoURI ? (
          <img
            src={token.logoURI}
            alt=""
            width={34}
            height={34}
            style={{ borderRadius: "50%", display: "block", objectFit: "contain" }}
          />
        ) : (
          <TokenIcon
            symbol={token.symbol}
            size={34}
            fallback={token.symbol.slice(0, 3)}
            chainId={token.chainId}
            chainLabel={false}
          />
        )}
      </span>
      <div className={s.rb}>
        <div className={s.rn}>
          <span className={s.rnName}>{token.name}</span>
          {token.verified && (
            <VerifiedBadge title={verifiedTitleFor(token.tags)} />
          )}
        </div>
        <div className={s.rs}>
          {token.symbol} · {meta?.shortName ?? "Unknown chain"}
        </div>
      </div>
      {launchpadLabel && <span className={s.tag}>{launchpadLabel}</span>}
      {!launchpadLabel && isCustom && <span className={s.tag}>Custom token</span>}
      {/* Said before the click, not after. The wallet's own confirmation is the
          consent gate, but a prompt you did not expect reads as the site
          misbehaving — and the reason this row switches networks is not
          something the user can infer from a token list. */}
      {switches && <span className={s.tag}>Switches network</span>}
      <div className={s.rr}>
        {loading ? (
          <span className={s.skPill} />
        ) : hasBalance ? (
          <span className={`${s.rv} tabular`}>
            {Number(balance).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}
          </span>
        ) : unread ? (
          /* A row whose balance could not be read, kept distinct from the empty
             rows around it. Blank would put it in the same silence as a token the
             wallet genuinely holds none of — and this list is how people pick
             what to trade, so "we couldn't check" has to look different from
             "you have none". */
          <span className={s.rv} title="Balance could not be read">
            —
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * The network filter, modelled on Uniswap's: a control docked in the search
 * bar that opens a searchable network list, with "All networks" as the default
 * and a check against the active choice.
 *
 * Kept in this file rather than promoted to a shared component because it is
 * meaningless outside a token list — it filters tokens, it does not switch the
 * wallet's chain. NetworkSelector is the one that switches chains, and mixing
 * the two is how a user ends up changing network when they meant to filter.
 */
function NetworkFilter({
  chains,
  value,
  onChange,
}: {
  chains: ChainMeta[];
  value: number | "all";
  onChange: (v: number | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = value === "all" ? undefined : getChainMeta(value);

  /* The panel is portalled out of the dialog and positioned against the
     button's rect. It has to be: the dialog is a `backdrop-filter` surface with
     `overflow: hidden`, so a panel left inside it is both trapped as a
     containing block AND clipped at the dialog's edge — which is why it was
     appearing squashed inside the box instead of floating over it. */
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const PANEL_W = 264;
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(
        Math.max(8, r.right - PANEL_W),
        window.innerWidth - PANEL_W - 8,
      );
      setPos({ top: r.bottom + 8, left });
    }
    setOpen(true);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return chains;
    return chains.filter((c) => c.name.toLowerCase().includes(t));
  }, [chains, q]);

  const pick = (v: number | "all") => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div className={s.nf}>
      <button
        ref={btnRef}
        type="button"
        className={s.nfBtn}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={
          active ? `Filtering by ${active.name}` : "Filtering by all networks"
        }
      >
        {active ? (
          <ChainIcon id={active.iconId} size={18} variant="branded" />
        ) : (
          <span className={s.nfAll} aria-hidden="true">
            {chains.slice(0, 4).map((c) => (
              <i key={c.id} style={{ background: c.color }} />
            ))}
          </span>
        )}
        <Chevron className={s.nfCaret} />
      </button>

      {open && pos && (
        <Portal>
          {/* Click-away. A transparent sibling rather than a document
              listener: it cannot fire before React has processed the click
              that opened the panel, which is the classic double-toggle bug. */}
          <div
            className={s.nfScrim}
            onClick={() => setOpen(false)}
            role="presentation"
            style={{ zIndex: 110 }}
          />
          <div
            className={s.nfPanel}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              right: "auto",
              width: PANEL_W,
              zIndex: 111,
            }}
          >
            <div className={s.nfSearch}>
              <span aria-hidden="true">⌕</span>
              <input
                autoFocus
                placeholder="Search networks"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search networks"
              />
            </div>
            <div className={s.nfList}>
              <button
                type="button"
                className={s.nfRow}
                onClick={() => pick("all")}
                role="option"
                aria-selected={value === "all"}
              >
                <span className={s.nfAll} aria-hidden="true">
                  {chains.slice(0, 4).map((c) => (
                    <i key={c.id} style={{ background: c.color }} />
                  ))}
                </span>
                <span className={s.nfName}>All networks</span>
                {value === "all" && <span className={s.nfTick}>✓</span>}
              </button>

              {shown.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={s.nfRow}
                  onClick={() => pick(c.id)}
                  role="option"
                  aria-selected={value === c.id}
                >
                  <ChainIcon
                    id={c.iconId}
                    size={22}
                    variant="branded"
                    fallback={
                      <i className={s.nfDot} style={{ background: c.color }} />
                    }
                  />
                  <span className={s.nfName}>{c.name}</span>
                  {!c.tradable && <span className={s.nfTag}>Balances</span>}
                  {value === c.id && <span className={s.nfTick}>✓</span>}
                </button>
              ))}

              {shown.length === 0 && (
                <div className={s.empty}>No network matches “{q}”.</div>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

/**
 * A category filter over the registry's own `tags`.
 *
 * Not a new taxonomy — each test reads the tags the registry already carries
 * (see registry.ts), so a token joins a category by being tagged, and nothing
 * here has to be kept in sync with the token tables. Order is the row order.
 *
 * A category renders ONLY when the list in view has a token in it (see
 * `categoryTabs`), so the row never offers a button that filters to nothing:
 * "Memes" stays hidden until the launchpad memes are registered with a `meme`
 * tag, and "Stocks" appears on Robinhood and nowhere the stock tokens are not
 * listed. That is the same honesty the empty state keeps — the panel states
 * what it can see rather than speculating about a future entry.
 */
type TokenCategory = {
  id: string;
  label: string;
  test: (t: IToken) => boolean;
};

const hasTag = (t: IToken, tag: string) => (t.tags ?? []).includes(tag);

const NETWORK_DISPLAY_ORDER: Record<number, number> = {
  5042: 10,
  5042002: 10,
  99901: 15,
  99801: 15,
  4663: 20,
  46630: 20,
  56: 30,
  97: 30,
  8453: 40,
  84532: 40,
};

const CUSTOM_TOKENS_STORAGE_KEY = "kaleido_user_custom_tokens";

function loadStoredCustomTokens(): IToken[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCustomToken(token: IToken): IToken[] {
  if (typeof window === "undefined") return [];
  try {
    const existing = loadStoredCustomTokens();
    const key = `${token.chainId}:${token.address.toLowerCase()}`;
    const filtered = existing.filter(
      (t) => `${t.chainId}:${t.address.toLowerCase()}` !== key,
    );
    const updated = [token, ...filtered];
    localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

const CATEGORIES: TokenCategory[] = [
  {
    /* The blue-chips: a chain's gas asset and its wrapper, wrapped BTC, and our
       own governance token — the assets a user reaches for first, spread across
       several tags rather than one. */
    id: "major",
    label: "Major",
    test: (t) =>
      Boolean(t.isNative) ||
      hasTag(t, "wrapped-native") ||
      hasTag(t, "wrapped-btc") ||
      hasTag(t, "governance"),
  },
  { id: "stable", label: "Stablecoins", test: (t) => hasTag(t, "stablecoin") },
  { id: "custom", label: "Custom", test: (t) => hasTag(t, "custom") },
  { id: "stock", label: "Stocks", test: (t) => hasTag(t, "stock") },
  { id: "meme", label: "Memes", test: (t) => hasTag(t, "meme") },
];

export default function TokenSelector({
  open,
  onClose,
  onSelect,
  exclude,
  switchOnSelect = true,
  tokenFilter,
}: TokenSelectorProps) {
  const [query, setQuery] = useState("");
  /* "all" is only the value before the first open. The effect below points it at
     the connected chain every time the modal opens, so a swap picker lands on
     tokens the user can trade right now — and reaching the rest is a deliberate
     act, which is what makes the network switch below expected rather than a
     surprise. Disconnected there is no chain to point at, so it stays "all". */
  const [network, setNetwork] = useState<number | "all">("all");
  /* Which category pill is active; null is "All". Reset whenever the network
     changes (below), so a category that has no tokens on the newly chosen
     network cannot stay selected and blank the list. */
  const [category, setCategory] = useState<string | null>(null);
  /* Held across the await so a second row click cannot queue a second
     wallet_switchEthereumChain behind the first. */
  const [switching, setSwitching] = useState(false);
  const { chainId } = useWalletV2();
  const wallet = useActiveWallet();
  const switchChain = useSwitchActiveWalletChain();
  const chainLabel = getChainMeta(chainId)?.shortName ?? "this chain";

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setNetwork(chainId ?? "all");
  }, [open, chainId]);

  /* A category is meaningful only within the network in view — Stocks exist on
     Robinhood and Stablecoins everywhere — so a network change clears it rather
     than leaving a now-empty filter applied. */
  useEffect(() => {
    setCategory(null);
  }, [network]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [customTokens, setCustomTokens] = useState<IToken[]>([]);

  useEffect(() => {
    setCustomTokens(loadStoredCustomTokens());
  }, [open]);

  /* Keep the token list on the same exclusive network mode as NetworkSelector:
     testnet mode shows testnet assets only, while the default shows mainnet
     assets only. Mixing both sets here lets a hidden-mode token leak into a
     quote even when every other multichain surface is scoped correctly. */
  const { showTestnets } = useTestnetMode();
  const chains = useMemo(() => {
    const shown = (c: ChainMeta) => Boolean(c.tradable) || isDeployed(c.id);
    const byProductOrder = (a: ChainMeta, b: ChainMeta) =>
      (NETWORK_DISPLAY_ORDER[a.id] ?? 1000) -
      (NETWORK_DISPLAY_ORDER[b.id] ?? 1000);
    return CHAINS.filter(
      (c) => c.network === (showTestnets ? "testnet" : "mainnet") && shown(c),
    ).sort(byProductOrder);
  }, [showTestnets]);
  const selectedNetwork =
    network !== "all" &&
    getChainMeta(network)?.network === (showTestnets ? "testnet" : "mainnet")
      ? network
      : "all";

  useEffect(() => {
    if (network !== selectedNetwork) setNetwork(selectedNetwork);
  }, [network, selectedNetwork]);

  const available = useMemo(() => {
    const base =
      selectedNetwork === "all"
        ? tokensAcrossChains(chains.map((c) => c.id))
        : chainTokens(selectedNetwork);
    const filteredCustom = customTokens.filter((ct) =>
      selectedNetwork === "all"
        ? chains.some((c) => c.id === ct.chainId)
        : ct.chainId === selectedNetwork,
    );
    const seen = new Set(
      base.map((t) => `${t.chainId}:${t.address.toLowerCase()}`),
    );
    const extra: IToken[] = [];
    for (const ct of filteredCustom) {
      const key = `${ct.chainId}:${ct.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        extra.push(ct);
      }
    }
    const combined = [...base, ...extra];
    return tokenFilter ? combined.filter(tokenFilter) : combined;
  }, [selectedNetwork, chains, customTokens, tokenFilter]);

  /* Everything selectable in the current network view, the excluded token
     (the swap's other side) already removed — the base both the category row
     and the results derive from, so a category button and the list agree about
     what exists. */
  const pool = useMemo(
    () =>
      available.filter(
        (t) =>
          !(
            exclude &&
            t.chainId === exclude.chainId &&
            t.address.toLowerCase() === exclude.address.toLowerCase()
          ),
      ),
    [available, exclude],
  );

  /* Only the categories with a token in the current pool, so an empty filter is
     never offered. Because this is derived from the pool, an active category is
     guaranteed at least one match until a search query narrows it further. */
  const categoryTabs = useMemo(
    () => CATEGORIES.filter((cat) => pool.some(cat.test)),
    [pool],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeCat = CATEGORIES.find((cat) => cat.id === category) ?? null;
    const scoped = activeCat ? pool.filter(activeCat.test) : pool;
    if (!q) return scoped;
    return scoped.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q,
    );
  }, [pool, query, category]);

  const [resolvedToken, setResolvedToken] = useState<IToken | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const isPastedAddress = isAddress(trimmedQuery);
  const inPool = useMemo(() => {
    if (!isPastedAddress) return null;
    return pool.find((t) => t.address.toLowerCase() === trimmedQuery.toLowerCase()) ?? null;
  }, [pool, isPastedAddress, trimmedQuery]);

  useEffect(() => {
    if (!isPastedAddress || inPool) {
      setResolvedToken(null);
      setResolving(false);
      setResolveError(null);
      return;
    }

    const abort = new AbortController();
    setResolving(true);
    setResolveError(null);
    setResolvedToken(null);

    const primaryChainId =
      selectedNetwork !== "all" ? selectedNetwork : (chainId ?? 5042);

    const tryFetchOnChain = async (cId: number) => {
      try {
        const res = await fetch(`/api/token/card?chainId=${cId}&address=${trimmedQuery}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.ok && (data.symbol || data.name) ? { data, chainId: cId } : null;
      } catch {
        return null;
      }
    };

    const fetchToken = async () => {
      try {
        let result = await tryFetchOnChain(primaryChainId);

        // If on "all" networks and primary didn't match, check other major launchpad chains
        if (!result && selectedNetwork === "all") {
          const fallbacks = [99901, 5042].filter((c) => c !== primaryChainId);
          for (const fallbackChain of fallbacks) {
            if (abort.signal.aborted) return;
            result = await tryFetchOnChain(fallbackChain);
            if (result) break;
          }
        }

        if (abort.signal.aborted) return;

        if (result) {
          const { data, chainId: resolvedChainId } = result;
          const customToken: IToken = {
            chainId: resolvedChainId,
            address: data.address || trimmedQuery,
            name: data.name || data.symbol || "Custom Token",
            symbol: data.symbol || "TOKEN",
            decimals: typeof data.decimals === "number" ? data.decimals : 18,
            logoURI: data.launchpadId
              ? `/launchpads/${data.launchpadId}.svg`
              : undefined,
            tags: [
              ...(data.source && data.source !== "unknown" && data.source !== "listed"
                ? [data.source]
                : []),
              ...(data.launchpadId ? [data.launchpadId] : []),
              "custom",
            ],
            verified:
              data.source === "argus" ||
              data.source === "peach" ||
              data.source === "elysium" ||
              data.source === "listed",
          };
          setResolvedToken(customToken);
          setResolveError(null);
          const updated = persistCustomToken(customToken);
          setCustomTokens(updated);
        } else {
          setResolveError(
            `Address is not an ERC-20 contract on ${getChainMeta(primaryChainId)?.shortName ?? "this network"}.`,
          );
        }
      } catch {
        if (!abort.signal.aborted) {
          setResolveError("Couldn't reach token lookup. Try again in a moment.");
        }
      } finally {
        if (!abort.signal.aborted) {
          setResolving(false);
        }
      }
    };

    fetchToken();
    return () => {
      abort.abort();
    };
  }, [trimmedQuery, isPastedAddress, inPool, selectedNetwork, chainId]);

  /*
   * Switch first, hand back second.
   *
   * `onSelect` is only reached once the wallet is on the token's chain, so a
   * caller can treat the result as belonging to the chain it acts on without
   * checking. A refused or failed switch selects nothing and leaves the modal
   * open on the list, because the alternative — selecting anyway — is the silent
   * cross-chain quote this whole path exists to prevent.
   *
   * Disconnected is not a failure to route around: there is no wallet to switch,
   * every form is a disabled preview, and opening a connect modal would turn a
   * click on a token into a wallet flow the user did not ask for. The pick goes
   * through as-is.
   */
  const handleSelect = async (token: IToken) => {
    if (token.tags?.includes("custom")) {
      const updated = persistCustomToken(token);
      setCustomTokens(updated);
    }

    if (!wallet || token.chainId === chainId || !switchOnSelect) {
      onSelect(token);
      return;
    }

    const meta = getChainMeta(token.chainId);
    /* Unreachable while the list is built from CHAINS, which is also why it is
       worth saying rather than falling through to a switch with no target. */
    if (!meta) {
      toast.error(`${token.symbol}'s network is not in the registry.`);
      return;
    }

    setSwitching(true);
    try {
      await switchChain(defineChain(toThirdwebChainOptions(meta)));
      onSelect(token);
    } catch {
      toast.error(
        `Couldn't switch to ${meta.name} — switch manually in your wallet, then pick ${token.symbol}.`,
      );
    } finally {
      setSwitching(false);
    }
  };

  if (!open) return null;

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={s.modal}
          role="dialog"
          aria-modal="true"
          aria-label="Select a token"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.mh}>
            <span className={s.mt}>Select a token</span>
            <button className={s.mx} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className={s.mb}>
            <div className={s.search}>
              <span className={s.searchIcon}>⌕</span>
              <input
                autoFocus
                placeholder="Search name or paste address"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search tokens"
              />
              <NetworkFilter
                chains={chains}
                value={selectedNetwork}
                onChange={setNetwork}
              />
            </div>

            {categoryTabs.length > 0 && (
              <div
                className={s.cats}
                role="tablist"
                aria-label="Token categories"
              >
                <button
                  type="button"
                  className={`${s.cat} ${category === null ? s.catOn : ""}`}
                  onClick={() => setCategory(null)}
                  role="tab"
                  aria-selected={category === null}
                >
                  All
                </button>
                {categoryTabs.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`${s.cat} ${category === cat.id ? s.catOn : ""}`}
                    onClick={() =>
                      setCategory((cur) => (cur === cat.id ? null : cat.id))
                    }
                    role="tab"
                    aria-selected={category === cat.id}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}

            <div className={s.list}>
              {available.length === 0 && !resolving && !resolvedToken ? (
                /* Not a failed search — the chain genuinely has no tokens in the
                 registry, which is every chain while `TOKENS` is chain-keyed and
                 empty. Saying "no match" here would blame the query for a gap in
                 the registry. No "yet": the panel states what it can see, and
                 speculating about a future entry is release talk. */
                <div className={s.empty}>
                  {selectedNetwork === "all"
                    ? "No tokens are registered on any network."
                    : `No tokens are available on ${getChainMeta(selectedNetwork)?.shortName ?? chainLabel}.`}
                </div>
              ) : resolving ? (
                <div className={s.empty}>
                  <span
                    className={s.skPill}
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      verticalAlign: "middle",
                      marginRight: 8,
                      borderRadius: "50%",
                    }}
                  />
                  Resolving contract address…
                </div>
              ) : resolvedToken ? (
                <div>
                  <div className={s.customHeader}>Custom token</div>
                  <TokenRow
                    key={`${resolvedToken.chainId}:${resolvedToken.address}`}
                    token={resolvedToken}
                    onSelect={handleSelect}
                    switches={
                      Boolean(wallet) && switchOnSelect && resolvedToken.chainId !== chainId
                    }
                    disabled={switching}
                  />
                </div>
              ) : results.length === 0 ? (
                <div className={s.empty}>
                  {resolveError ? (
                    <>
                      <div style={{ color: "var(--k-red, #ff5555)", marginBottom: 4 }}>
                        Token lookup failed
                      </div>
                      <div style={{ fontSize: "12px", opacity: 0.8 }}>
                        {resolveError}
                      </div>
                    </>
                  ) : (
                    `No token matches “${query}”.`
                  )}
                </div>
              ) : (
                results.map((t) => (
                  <TokenRow
                    key={`${t.chainId}:${t.address}`}
                    token={t}
                    onSelect={handleSelect}
                    switches={
                      Boolean(wallet) && switchOnSelect && t.chainId !== chainId
                    }
                    disabled={switching}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
