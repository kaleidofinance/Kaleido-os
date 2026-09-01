"use client";

import { useEffect, useMemo, useState } from "react";
import { useActiveWallet, useSwitchActiveWalletChain } from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { toast } from "sonner";
import { chainTokens, tokensAcrossChains } from "@/constants/tokens";
import {
  CHAINS,
  getChainMeta,
  toThirdwebChainOptions,
  type ChainMeta,
} from "@/constants/chains";
import ChainIcon from "./ChainIcon";
import TokenIcon, { hasTokenIcon } from "./TokenIcon";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import Portal from "./Portal";
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
        className={`${s.tki} ${hasTokenIcon(token.symbol) ? s.tkiArt : ""}`}
      >
        {/* `chainLabel={false}` — the row's second line already reads
            "USDC · Ethereum", so an aria-label on the badge would have a screen
            reader announce the chain twice per row. */}
        <TokenIcon
          symbol={token.symbol}
          size={34}
          fallback={token.symbol.slice(0, 3)}
          chainId={token.chainId}
          chainLabel={false}
        />
      </span>
      <div className={s.rb}>
        <div className={s.rn}>{token.name}</div>
        <div className={s.rs}>
          {token.symbol} · {meta?.shortName ?? "Unknown chain"}
        </div>
      </div>
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
        type="button"
        className={s.nfBtn}
        onClick={() => setOpen((o) => !o)}
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
        <span className={s.nfCaret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <>
          {/* Click-away. A transparent sibling rather than a document
              listener: it cannot fire before React has processed the click
              that opened the panel, which is the classic double-toggle bug. */}
          <div
            className={s.nfScrim}
            onClick={() => setOpen(false)}
            role="presentation"
          />
          <div className={s.nfPanel} role="listbox">
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
        </>
      )}
    </div>
  );
}

export default function TokenSelector({
  open,
  onClose,
  onSelect,
  exclude,
}: TokenSelectorProps) {
  const [query, setQuery] = useState("");
  /* "all" is only the value before the first open. The effect below points it at
     the connected chain every time the modal opens, so a swap picker lands on
     tokens the user can trade right now — and reaching the rest is a deliberate
     act, which is what makes the network switch below expected rather than a
     surprise. Disconnected there is no chain to point at, so it stays "all". */
  const [network, setNetwork] = useState<number | "all">("all");
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Mainnets first, then testnets, each in registry order — the same ordering
     NetworkSelector uses, so the two lists never disagree about precedence. */
  const chains = useMemo(
    () => [
      ...CHAINS.filter((c) => c.network === "mainnet"),
      ...CHAINS.filter((c) => c.network !== "mainnet"),
    ],
    [],
  );

  const available = useMemo(
    () =>
      network === "all"
        ? tokensAcrossChains(chains.map((c) => c.id))
        : chainTokens(network),
    [network, chains],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = available.filter(
      (t) =>
        !(
          exclude &&
          t.chainId === exclude.chainId &&
          t.address.toLowerCase() === exclude.address.toLowerCase()
        ),
    );
    if (!q) return pool;
    return pool.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q,
    );
  }, [available, query, exclude]);

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
    if (!wallet || token.chainId === chainId) {
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
                value={network}
                onChange={setNetwork}
              />
            </div>

            <div className={s.list}>
              {available.length === 0 ? (
                /* Not a failed search — the chain genuinely has no tokens in the
                 registry, which is every chain while `TOKENS` is chain-keyed and
                 empty. Saying "no match" here would blame the query for a gap in
                 the registry. No "yet": the panel states what it can see, and
                 speculating about a future entry is release talk. */
                <div className={s.empty}>
                  {network === "all"
                    ? "No tokens are registered on any network."
                    : `No tokens are available on ${getChainMeta(network)?.shortName ?? chainLabel}.`}
                </div>
              ) : results.length === 0 ? (
                <div className={s.empty}>No token matches “{query}”.</div>
              ) : (
                results.map((t) => (
                  <TokenRow
                    key={`${t.chainId}:${t.address}`}
                    token={t}
                    onSelect={handleSelect}
                    switches={Boolean(wallet) && t.chainId !== chainId}
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
