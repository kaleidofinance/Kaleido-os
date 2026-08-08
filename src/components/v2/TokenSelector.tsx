"use client";

import { useEffect, useMemo, useState } from "react";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
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
 */

interface TokenSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (token: IToken) => void;
  /** Symbol to exclude — a token can't be swapped into itself. */
  exclude?: string;
}

function TokenRow({
  token,
  chainLabel,
  onSelect,
}: {
  token: IToken;
  chainLabel: string;
  onSelect: (t: IToken) => void;
}) {
  const { balance, loading } = useTokenBalance(token);
  const hasBalance = !loading && Number(balance) > 0;

  return (
    <button className={s.row} onClick={() => onSelect(token)}>
      <span className={s.tki}>
        {token.symbol.slice(0, 3)}
        <i className={s.cb} style={{ background: "var(--k-accent)" }} />
      </span>
      <div className={s.rb}>
        <div className={s.rn}>{token.name}</div>
        <div className={s.rs}>{token.symbol} · {chainLabel}</div>
      </div>
      <div className={s.rr}>
        {loading ? (
          <span className={s.skPill} />
        ) : hasBalance ? (
          <span className={`${s.rv} tabular`}>{Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        ) : null}
      </div>
    </button>
  );
}

export default function TokenSelector({ open, onClose, onSelect, exclude }: TokenSelectorProps) {
  const [query, setQuery] = useState("");
  const { chainId } = useWalletV2();
  const chainLabel = getChainMeta(chainId)?.shortName ?? "this chain";

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const available = useMemo(() => chainTokens(chainId), [chainId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = available.filter((t) => t.symbol !== exclude);
    if (!q) return pool;
    return pool.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q,
    );
  }, [available, query, exclude]);

  if (!open) return null;

  return (
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
          </div>

          <div className={s.list}>
            {available.length === 0 ? (
              /* Not a failed search — the chain genuinely has no tokens
                 registered yet, which is every chain until one deploys. Saying
                 "no match" here would blame the query for a deployment gap. */
              <div className={s.empty}>
                No tokens are available on {chainLabel} yet.
              </div>
            ) : results.length === 0 ? (
              <div className={s.empty}>No token matches “{query}”.</div>
            ) : (
              results.map((t) => (
                <TokenRow
                  key={t.address}
                  token={t}
                  chainLabel={chainLabel}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
