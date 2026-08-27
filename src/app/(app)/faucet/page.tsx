"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/v2/Nav";
import NetworkSelector from "@/components/v2/NetworkSelector";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { useFaucet, type FaucetAsset } from "@/hooks/v2/useFaucet";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { CHAINS, getChainMeta } from "@/constants/chains";
import { faucetChains } from "@/constants/registry";
import { getChainAddressUrl } from "@/constants/utils/getTxUrl";
import s from "./faucet.module.css";

/**
 * /faucet — test tokens for the chain the wallet is on.
 *
 * Everything on this page is read from KaleidoTokenFaucet: the asset list, the
 * drip, the remaining stock, the cooldown and the claimer count. Nothing is
 * configured here, which is what makes the page correct on a chain whose faucet
 * lists two assets and on one that lists five.
 *
 * The faucet now lists the chain's native gas as its first asset, so a wallet
 * with a little gas can top the rest up here. It cannot bootstrap a wallet with
 * exactly zero — the claim transaction itself costs gas — and pointing at each
 * chain's own native faucet for that first drop would genuinely help, but
 * `chains.ts` carries no such field and only one of the five URLs is known. Four
 * invented links is worse than none, since a dead faucet link costs the reader a
 * round trip to find out.
 */

const fmt = (v: string | null, dp = 2) => {
  if (v === null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
};

/** "1h", "45m", "30s" — the wait between claims of one asset. */
const fmtDuration = (secs: number) => {
  if (secs <= 0) return "none";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
};

/**
 * A ticking clock, but only after mount.
 *
 * Null on the server pass and on the first client render, so a row's remaining
 * cooldown — which is a deadline minus *now* — never lands in the SSR markup. It
 * would differ from the value the client computes a moment later, and React
 * treats that as a hydration mismatch on the whole subtree.
 */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function FaucetPage() {
  const { isConnected } = useWalletV2();
  const faucet = useFaucet();
  const now = useNow();
  const [picker, setPicker] = useState(false);

  const chainName =
    getChainMeta(faucet.chainId)?.name ?? `chain ${faucet.chainId}`;
  const explorer = faucet.address
    ? getChainAddressUrl(faucet.chainId, faucet.address)
    : null;

  /* Chains that actually carry a faucet, so the empty state can name them
     instead of asking the user to guess which network to switch to. */
  const elsewhere = useMemo(
    () => faucetChains(CHAINS).filter((c) => c.id !== faucet.chainId),
    [faucet.chainId],
  );

  /** What a row's button says, and whether it does anything. */
  const cta = (a: FaucetAsset) => {
    if (faucet.claiming === a.address) return { label: "Claiming…", on: false };
    if (a.paused) return { label: "Paused", on: false };
    if (a.empty) return { label: "Out of stock", on: false };
    if (!isConnected) return { label: "Connect wallet", on: false };
    if (a.nextClaimAt > 0) {
      /* Before the clock mounts there is no remaining time to quote, so the
         button states the fact and leaves the number for a beat later. */
      const left = now === null ? null : a.nextClaimAt - now;
      if (left === null) return { label: "On cooldown", on: false };
      if (left > 0) return { label: `Wait ${fmtDuration(left)}`, on: false };
    }
    /* A batch in flight claims this row too, and pressing both would put two
       transactions in the mempool competing for the same cooldown — the second
       reverts. */
    if (faucet.claimingAll) return { label: "Claim", on: false };
    return { label: "Claim", on: true };
  };

  /*
   * Shown only when it saves signatures — two or more assets due at once.
   *
   * With one due, the row's own button sends the identical transaction (see
   * claimAll), so a second control would be two ways to do one thing. With none
   * due it would be a permanently disabled button explaining a state the rows
   * already spell out per asset.
   */
  const batch = isConnected && faucet.claimable.length > 1;

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <header className={s.head}>
          <h1 className={s.h1}>Test tokens</h1>
          <p className={s.lede}>
            Claim the test assets Kaleido runs on {chainName}. Use them anywhere
            in the app — swap them, post them as collateral, mint kfUSD against
            them.
          </p>
        </header>

        {!faucet.supported ? (
          <div className={s.panel}>
            <div className={s.panelTitle}>No faucet on {chainName}</div>
            <p className={s.panelBody}>
              {elsewhere.length > 0
                ? `Switch to ${elsewhere.map((c) => c.shortName).join(", ")} to claim test tokens.`
                : "There are no test tokens to claim right now."}
            </p>
            {elsewhere.length > 0 && (
              <button className={s.panelCta} onClick={() => setPicker(true)}>
                Choose network
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={s.strip}>
              <div className={s.stat}>
                <span className={s.sl}>Network</span>
                <span className={s.sv}>{chainName}</span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Wait between claims</span>
                <span className={`${s.sv} tabular`}>
                  {faucet.cooldownSeconds === null
                    ? "—"
                    : fmtDuration(faucet.cooldownSeconds)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Claimers</span>
                <span className={`${s.sv} tabular`}>
                  {faucet.totalUsers === null
                    ? "—"
                    : faucet.totalUsers.toLocaleString("en-US")}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Faucet</span>
                {explorer ? (
                  <a
                    className={`${s.sv} ${s.link} tabular`}
                    href={explorer}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {faucet.address?.slice(0, 6)}…{faucet.address?.slice(-4)}
                  </a>
                ) : (
                  <span className={`${s.sv} tabular`}>
                    {faucet.address?.slice(0, 6)}…{faucet.address?.slice(-4)}
                  </span>
                )}
              </div>
            </div>

            <div className={s.card}>
              <div className={`${s.row} ${s.thead}`}>
                <span>Asset</span>
                <span className={s.num}>Per claim</span>
                <span className={s.num}>You hold</span>
                <span className={s.num}>Faucet holds</span>
                <span className={s.act}>
                  {batch && (
                    <button
                      className={s.claimAll}
                      disabled={faucet.claimingAll || faucet.claiming !== null}
                      onClick={faucet.claimAll}
                    >
                      {faucet.claimingAll
                        ? "Claiming…"
                        : `Claim all ${faucet.claimable.length}`}
                    </button>
                  )}
                </span>
              </div>

              {faucet.loading && faucet.assets.length === 0 ? (
                <div className={s.note}>Reading the faucet…</div>
              ) : faucet.error ? (
                <div className={s.note}>
                  Could not read the faucet on {chainName}.{" "}
                  <button className={s.retry} onClick={faucet.refetch}>
                    Try again
                  </button>
                </div>
              ) : faucet.assets.length === 0 ? (
                <div className={s.note}>
                  This faucet has no assets listed yet.
                </div>
              ) : (
                faucet.assets.map((a) => {
                  const action = cta(a);
                  return (
                    <div className={s.row} key={a.address}>
                      <span className={s.asset}>
                        <span
                          className={`${s.tki} ${hasTokenIcon(a.symbol) ? s.tkiArt : ""}`}
                        >
                          <TokenIcon
                            symbol={a.symbol}
                            size={30}
                            fallback={a.symbol.slice(0, 3)}
                          />
                        </span>
                        <span className={s.assetText}>
                          <b>{a.symbol}</b>
                          <em>{a.decimals} decimals</em>
                        </span>
                      </span>
                      <span className={`${s.num} tabular`}>
                        {fmt(a.amount, 4)}
                      </span>
                      <span className={`${s.num} ${s.dim} tabular`}>
                        {isConnected ? fmt(a.balance, 4) : "—"}
                      </span>
                      <span className={`${s.num} ${s.dim} tabular`}>
                        {fmt(a.stock, 0)}
                        {a.claimsLeft > 0 && (
                          <em className={s.left}>{a.claimsLeft} claims left</em>
                        )}
                      </span>
                      <span className={s.act}>
                        <button
                          className={s.claim}
                          disabled={!action.on}
                          onClick={() => faucet.claim(a.address)}
                        >
                          {action.label}
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>
      <NetworkSelector open={picker} onClose={() => setPicker(false)} />
    </>
  );
}
