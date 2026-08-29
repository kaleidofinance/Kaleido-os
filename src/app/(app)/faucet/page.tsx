"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/v2/Nav";
import NetworkSelector from "@/components/v2/NetworkSelector";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { useFaucet, type FaucetAsset } from "@/hooks/v2/useFaucet";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { CHAINS, getChainMeta } from "@/constants/chains";
import { faucetChains, isNativeSentinel } from "@/constants/registry";
import { gasFaucetsFor, gasNameFor } from "@/constants/gasFaucets";
import { getChainAddressUrl, getChainTxUrl } from "@/constants/utils/getTxUrl";
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
 * with a little gas can top the rest up here. It still cannot bootstrap a wallet
 * at exactly zero — the claim transaction itself costs gas — so the strip below
 * the table covers that first drop two ways: the chain's own public faucet, from
 * constants/gasFaucets.ts, and us paying the fee via /api/gas-drip.
 *
 * This file used to record the links as deliberately absent, on the grounds that
 * only one of the five URLs was known and four invented ones would be worse than
 * none, since a dead faucet link costs the reader a round trip to find out. The
 * reasoning was right and is why gasFaucets.ts stores a verification date and
 * the status each URL actually returned; what has changed is that all five were
 * checked. The sponsorship button is the better answer where it is switched on,
 * but it is off unless an operator key is set, so the links are the path that
 * always works rather than a fallback.
 *
 * On two chains that ordering flips outright. BSC testnet and Arc run the
 * faucet bytecode from before it could hold native gas, so they list no gas row
 * and cannot be given one without a redeploy — every answer to "I have no gas"
 * there happens on somebody else's site. So those two promote the chain's own
 * official faucet to the page's primary button, rather than offering it as one
 * of a row of equal-weight links beside an in-app control that cannot help.
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
  const { address, isConnected } = useWalletV2();
  const faucet = useFaucet();
  const now = useNow();
  const [picker, setPicker] = useState(false);

  /*
   * The sponsored-fee request. Four states rather than a boolean because the
   * three non-failures read differently to someone who is stuck: gas is on its
   * way, they already had enough, or they have used their one bootstrap. Folding
   * those into "error" would tell a funded wallet that something broke.
   */
  const [drip, setDrip] = useState<{
    phase: "idle" | "sending" | "sent" | "noted" | "error";
    message?: string;
    hash?: string;
  }>({ phase: "idle" });

  /* A chain switch invalidates every one of those outcomes — a hash on one chain
     and an eligibility answer from its faucet say nothing about the next. */
  useEffect(() => {
    setDrip({ phase: "idle" });
  }, [faucet.chainId, address]);

  const requestGas = async () => {
    if (!address) return;
    setDrip({ phase: "sending" });
    try {
      const res = await fetch("/api/gas-drip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, chainId: faucet.chainId }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setDrip({
          phase: "error",
          message: body?.error ?? "Could not send gas right now.",
        });
        return;
      }
      if (body?.status === "sent") {
        setDrip({
          phase: "sent",
          message: `Sent ${body.amount} ${body.symbol}. Claim below once it lands.`,
          hash: body.transactionHash,
        });
        /* Re-read the faucet so the native row's balance and its button stop
           disagreeing with the message that just appeared above them. */
        faucet.refetch();
        return;
      }
      setDrip({
        phase: "noted",
        message: body?.message ?? "Nothing to send.",
      });
    } catch {
      /* Only a genuine transport failure reaches here — every answered request,
         including a 503, went through the branches above. */
      setDrip({ phase: "error", message: "Could not reach the network." });
    }
  };

  const chainName =
    getChainMeta(faucet.chainId)?.name ?? `chain ${faucet.chainId}`;
  const explorer = faucet.address
    ? getChainAddressUrl(faucet.chainId, faucet.address)
    : null;

  /* Public faucets for this chain, and what it calls the thing they hand out. */
  const gasLinks = gasFaucetsFor(faucet.chainId);
  const gasName = gasNameFor(faucet.chainId);

  /*
   * The native row, and whether the wallet can afford to use it.
   *
   * The faucet lists native gas under the lending sentinel — address(1), which
   * Faucet.sol pins to NATIVE_SENTINEL.lending precisely so this lookup works.
   * A zero balance is the whole condition: it is not "low on gas", it is unable
   * to send the transaction that would fix that.
   *
   * Only Sepolia, Base and Robinhood register that row, though — BSC testnet and
   * Arc still run the faucet bytecode from before native support, so they stock
   * tokens only. That is not a config gap to be filled in: `FAUCET_EXTEND`
   * cannot add a `receive()`, it takes a redeploy, so on those two chains there
   * is no in-app route to gas at all and every answer happens elsewhere.
   *
   * Read from the live asset list rather than a hardcoded pair of chain ids, so
   * the day either one is redeployed with native support the page follows the
   * chain instead of needing this file edited again.
   */
  const nativeAsset = faucet.assets.find((a) =>
    isNativeSentinel(a.address, "lending"),
  );
  const hasNativeRow = nativeAsset !== undefined;
  /* "We can see that the wallet is at zero" — the only case that earns the loud
     border, because it is the only one we actually know. */
  const knownStuck =
    isConnected && nativeAsset !== undefined && Number(nativeAsset.balance) === 0;

  /*
   * Whether the asset list above described this chain at all.
   *
   * The server pass renders with an empty list on every chain, and a failed read
   * tells us nothing either — so before the list has loaded, or after it errored,
   * nothing on this page knows whether a native row exists. Everything below is
   * gated on this for that reason: asserting "there is no gas row here" from an
   * empty list would be wrong on three of the five chains.
   */
  const rowKnown = !faucet.loading && !faucet.error;

  /*
   * On a chain with no native row, the chain's own faucet IS the primary action.
   *
   * `gasFaucetsFor` sorts first-party first, so this is BNB Chain's own faucet on
   * 97 and Circle's on Arc — in both cases the team that actually issues the gas.
   * Leading with it rather than listing it beside a sponsored-fee button is the
   * honest arrangement: the button is off unless an operator key is set, so
   * offering it as the equal-weight in-app option would send the one reader it
   * was meant for into a 503 while the thing that works sat next to it looking
   * like a footnote.
   */
  const leadLink = rowKnown && !hasNativeRow ? gasLinks[0] : undefined;
  const restLinks = leadLink ? gasLinks.slice(1) : gasLinks;

  /*
   * "Worth offering."
   *
   * Where a native row exists and is read, the balance above is evidence: the
   * button appears exactly when the wallet is known to be stuck. Where the row
   * provably does not exist, the official faucet link above it replaces it — the
   * one exception is a chain with no checked link at all, and there the route is
   * the only thing left and gets asked anyway rather than leaving a dead end,
   * which is the state gasFaucets.test.ts fails the build over. While the list is
   * unread (loading or error) neither is claimed.
   */
  const canAskForFee =
    isConnected &&
    (knownStuck ||
      (rowKnown && !hasNativeRow && gasLinks.length === 0));

  const dripTxUrl =
    drip.hash ? getChainTxUrl(faucet.chainId, drip.hash) : null;

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

            {/*
              The zeroth transaction.

              Rendered under the table rather than above it, and only ever loud
              when the wallet's native balance is actually zero: for everyone
              else this is reference material, and a warning-styled panel about a
              problem the reader does not have is the kind of thing that trains
              people to skip the page's real messages.

              Which control leads depends on whether this chain's faucet can hand
              out gas at all. Where it can, the sponsored button leads and appears
              only when `canAskForFee`, so the one person who can meet a
              "sponsorship is not enabled" 503 is the one it would have helped —
              and they meet it with the public faucets already on screen beside
              it, rather than as a dead end. Where it cannot — BSC testnet and
              Arc, on the pre-receive() bytecode — the chain's own faucet leads
              instead, because it is the only thing on this panel that can
              actually fund a wallet there.
            */}
            {(gasLinks.length > 0 || canAskForFee) && (
              <section className={`${s.gas} ${knownStuck ? s.gasLoud : ""}`}>
                <div className={s.gasText}>
                  <b className={s.gasTitle}>
                    {knownStuck
                      ? `You have no ${gasName} to claim with`
                      : `Need ${gasName} first?`}
                  </b>
                  {/* Two different facts, not one sentence with a variable in
                      it: where a native row exists the faucet covers you from
                      the second claim onwards, and where it does not, it never
                      will. Promising a row that is not in the table above would
                      be wrong on the two chains that stock tokens only — and
                      so would the reverse claim, asserted while the list is
                      still loading. */}
                  <p className={s.gasBody}>
                    {!rowKnown ? (
                      <>
                        Claiming is a transaction, so it costs a fee. A wallet at
                        exactly zero has to get its first {gasName} from outside
                        the app before it can claim anything here.
                      </>
                    ) : hasNativeRow ? (
                      <>
                        Claiming is a transaction, so it costs a fee. A wallet at
                        exactly zero has to get its first {gasName} from outside
                        the app — after that, the {gasName} row above tops you
                        up.
                      </>
                    ) : (
                      <>
                        Claiming is a transaction, so it costs a fee, and this
                        faucet stocks tokens only — there is no {gasName} row
                        above. Get {gasName} from{" "}
                        {leadLink ? `${leadLink.operator}'s faucet` : "elsewhere"}{" "}
                        first, then come back and claim the tokens here.
                      </>
                    )}
                  </p>
                </div>

                <div className={s.gasActions}>
                  {/* The primary action, and on a chain with no gas row it is a
                      link rather than a button. Styled as the page's brand CTA
                      because that is what it is here: nothing else on this panel
                      can put gas in an empty wallet on BSC or Arc, so demoting it
                      to one of a row of outlined links would hide the only route
                      that works. */}
                  {leadLink && (
                    <a
                      className={s.gasCta}
                      href={leadLink.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get {gasName} from {leadLink.operator}
                    </a>
                  )}
                  {canAskForFee && (
                    <button
                      className={s.gasCta}
                      disabled={drip.phase === "sending"}
                      onClick={requestGas}
                    >
                      {drip.phase === "sending"
                        ? "Sending…"
                        : "Send me one claim's fee"}
                    </button>
                  )}
                  {restLinks.map((f) => (
                    <a
                      className={s.gasLink}
                      key={f.url}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <b>{f.operator}</b>
                      <em>
                        {f.gives}
                        {f.note ? ` · ${f.note}` : ""}
                      </em>
                    </a>
                  ))}
                </div>

                {/* Only under a leading link, and only where it is not obvious
                    from the operator's name: the reader is about to leave the app
                    for a site that may want a sign-in or rate-limit them, and
                    that is worth knowing before the trip, not after. */}
                {leadLink?.note && (
                  <p className={s.gasMsg}>{leadLink.note}</p>
                )}

                {drip.message && (
                  <p
                    className={`${s.gasMsg} ${drip.phase === "error" ? s.gasMsgBad : ""}`}
                  >
                    {drip.message}
                    {dripTxUrl && (
                      <>
                        {" "}
                        <a
                          className={s.link}
                          href={dripTxUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                        </a>
                      </>
                    )}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <NetworkSelector open={picker} onClose={() => setPicker(false)} />
    </>
  );
}
