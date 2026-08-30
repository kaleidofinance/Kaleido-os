"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/v2/Nav";
import NetworkSelector from "@/components/v2/NetworkSelector";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { useFaucet, type FaucetAsset } from "@/hooks/v2/useFaucet";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { CHAINS, getChainMeta } from "@/constants/chains";
import { faucetChains, isNativeSentinel } from "@/constants/registry";
import {
  gasFaucetsFor,
  gasNameFor,
  issuerFaucetFor,
  type GasFaucet,
} from "@/constants/gasFaucets";
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

  /* Public faucets for this chain, and what it calls the thing they hand out.
     Memoised because `gasFaucetsFor` hands back a fresh sorted copy on every
     call — deliberately, so a caller cannot reorder the table — which would give
     `gasRow` below a new dependency identity on every render and stop its memo
     from memoising anything. */
  const gasLinks = useMemo(() => gasFaucetsFor(faucet.chainId), [faucet.chainId]);
  const gasName = gasNameFor(faucet.chainId);

  /*
   * The native row, and whether the wallet can afford to use it.
   *
   * The faucet lists native gas under the lending sentinel — address(1), which
   * Faucet.sol pins to NATIVE_SENTINEL.lending precisely so this lookup works.
   * A zero balance is the whole condition: it is not "low on gas", it is unable
   * to send the transaction that would fix that.
   *
   * Only Sepolia, Base and Robinhood register that row, though. BSC testnet and
   * Arc still run the faucet bytecode from before native support, and no
   * `FAUCET_EXTEND` closes that — it cannot add a `receive()`, it takes a
   * redeploy. Note the two are not the same shape underneath: BSC stocks tokens
   * only, while Arc's gas IS one of its tokens (USDC, listed as a 6dp alias of
   * the native balance) and so appears in the table without appearing here.
   * `gasRow` below is what reconciles them, by asking whether the gas can be paid
   * rather than whether the sentinel is present.
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

  /**
   * The gas row this chain's faucet cannot actually pay out, as a row that links
   * out to the faucet that can.
   *
   * Two chains need this, for two different reasons, and both were measured on
   * chain rather than inferred from the deployment records:
   *
   *  - **BSC testnet** runs the faucet bytecode from before native support:
   *    `assetInfo` lists no `address(1)` row at all, while Sepolia's, Base's and
   *    Robinhood's do. There is nothing to claim.
   *  - **Arc** does list its gas — its native currency IS USDC and
   *    `0x3600…0000` is an ERC20 alias of the same balance (the faucet reads
   *    8.694815 through both `eth_getBalance` and `balanceOf`, the identical
   *    number). But the row's drip is **100.0** against a stock of **8.694815**,
   *    i.e. less than one drip, so `claim` reverts `InsufficientContractBalance`
   *    and `useFaucet` already flags it `empty`. A row whose button says "Out of
   *    stock" is not a route to gas.
   *
   * Both are the same thing to the reader — the gas they need to claim anything
   * else here has to come from off-site — so both get the link. Note this is not
   * a stock gap that topping up would close on Arc either: its USDC and WUSDC
   * share one budget with the deployer's own gas, and the deployer is down to
   * 0.52 against a 1.0 reserve.
   *
   * A row, not just the panel below, because the panel is where someone looks
   * *after* noticing they are stuck — and the table is where they look first. The
   * whole point is that "get BNB" is a step in the same list as "get USDT", since
   * on these chains it is the step that has to happen before any of the others.
   *
   * Null where the faucet can genuinely pay gas out (Sepolia, Base, Robinhood),
   * and null before the asset list has loaded, since an empty list is not evidence
   * of a missing row — it is the SSR pass, on every chain.
   */
  const gasRow = useMemo(() => {
    if (!rowKnown) return null;
    const meta = getChainMeta(faucet.chainId);
    const symbol = meta?.nativeCurrency.symbol;
    /* No symbol means chains.ts does not carry this chain, which is the same case
       where gasFaucetsFor returns nothing — there would be nowhere to send them. */
    if (!symbol || gasLinks.length === 0) return null;

    /*
     * Can this faucet actually hand out gas right now? Not "does it list it" —
     * Arc lists it and cannot pay it. The row has to exist, be unpaused and hold
     * at least one drip, which is exactly what `empty`/`paused` already encode.
     *
     * The native row is found either by the address(1) sentinel or by symbol,
     * because those are two genuinely different ways a chain carries its gas: the
     * sentinel on the three redeployed faucets, and a 6dp ERC20 alias on Arc.
     */
    const gasAsset =
      nativeAsset ??
      faucet.assets.find(
        (a) => a.symbol.toUpperCase() === symbol.toUpperCase(),
      );
    if (gasAsset && !gasAsset.empty && !gasAsset.paused) return null;

    return { symbol, link: gasLinks[0], asset: gasAsset };
  }, [rowKnown, nativeAsset, faucet.chainId, faucet.assets, gasLinks]);

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
   *
   * Promoted out of the link list — but only when the table is not already
   * carrying it. `gasRow` renders a Claim-shaped link in the asset table itself,
   * which is the primary action wherever it exists; leading the panel with the
   * same URL as a second brand-coloured button would be two controls for one
   * errand, so this is left undefined in that case and the link stays in the
   * ordinary list below.
   *
   * It still fires where the table cannot show one: no sentinel row to read a
   * balance from, and a gas asset the faucet *can* pay, so `gasRow` correctly
   * stands down. On today's five chains that is nobody — both BSC and Arc go
   * through `gasRow` — but it is precisely the state Arc enters the moment its
   * USDC is topped up past one drip, and a wallet at literal zero still cannot
   * pay for the claim call that would fill it. So the panel keeps its lead there
   * rather than degrading to a list of equal-weight links.
   *
   * BELOW `gasRow`, NOT ABOVE IT. These two lines sat before the memo they read,
   * which is a temporal dead zone: `const` is hoisted but not initialised, so the
   * page threw "Cannot access 'gasRow' before initialization" on every render —
   * the whole route, not a branch of it. `tsc` catches it (TS2448/TS2454) and
   * nothing else would have.
   */
  const leadLink =
    rowKnown && !hasNativeRow && !gasRow ? gasLinks[0] : undefined;
  const restLinks = leadLink ? gasLinks.slice(1) : gasLinks;

  /**
   * For one listed row: the faucet to send the reader to instead of claiming, or
   * `undefined` when our own Claim button is the right control.
   *
   * Two reasons a row links out, and they are the same reason underneath — the
   * row cannot pay and somebody else can:
   *
   *  - It is the gas row on a chain whose faucet cannot pay gas. On Arc that row
   *    is a real listed asset (its 6dp USDC alias), so the link belongs on the
   *    button already there rather than on a second row describing the same
   *    balance. On BSC there is no such row and `gasRow` renders one; same link,
   *    the difference is only whether the table already had somewhere to put it.
   *  - It is a token we do not issue. Arc's EURC and cirBTC are Circle's, so they
   *    are paused on chain and point at Circle's faucet, which hands out more of
   *    both than we could and does not run dry.
   *
   * Gated on `paused || empty` rather than on being in the issuer table at all, so
   * a third-party token we DO manage to stock keeps its working Claim button — our
   * row is better than a round trip whenever it can actually pay. That is the same
   * rule `gasRow` uses, and it is why neither case needs a chain id.
   */
  const linkOutFor = useCallback(
    (a: FaucetAsset): GasFaucet | undefined => {
      if (gasRow && a.address === gasRow.asset?.address) return gasRow.link;
      if (!a.paused && !a.empty) return undefined;
      return issuerFaucetFor(faucet.chainId, a.address);
    },
    [gasRow, faucet.chainId],
  );

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
                <>
                  {/*
                    The gas row, first, where the faucet's own native row sits on
                    the chains that have one — because it is the step that comes
                    before the others here, not an afterthought below them.

                    Deliberately dashed and dimmed rather than styled like the
                    rows under it: nothing in this row is a reading from our
                    faucet. Every figure is unknown to us — the operator sets
                    the drip and can change it without telling us — so the cells
                    say so instead of showing a number that looks measured. Cf.
                    gasFaucets.ts, which stores no amounts for the same reason.
                  */}
                  {/* Only where the table has no row for the gas at all — BSC.
                      On Arc the gas IS a listed row (its USDC alias) and gets the
                      link on its own button below, rather than a duplicate row. */}
                  {gasRow && !gasRow.asset && (
                    <div className={`${s.row} ${s.rowOut}`} key="gas-external">
                      <span className={s.asset}>
                        <span
                          className={`${s.tki} ${hasTokenIcon(gasRow.symbol) ? s.tkiArt : ""}`}
                        >
                          <TokenIcon
                            symbol={gasRow.symbol}
                            size={30}
                            fallback={gasRow.symbol.slice(0, 3)}
                          />
                        </span>
                        <span className={s.assetText}>
                          <b>{gasRow.symbol}</b>
                          <em>needed to claim · not stocked here</em>
                        </span>
                      </span>
                      <span className={`${s.num} ${s.dim} tabular`}>—</span>
                      <span className={`${s.num} ${s.dim} tabular`}>—</span>
                      <span className={`${s.num} ${s.dim} tabular`}>—</span>
                      <span className={s.act}>
                        {/*
                          The claim button for this row is a link, because that is
                          literally where the claim happens. Carries the operator's
                          name rather than a bare "Claim": the reader is about to
                          leave the app, and a button that navigates off-site
                          should say so before it is pressed, not after.
                        */}
                        <a
                          className={s.claimOut}
                          href={gasRow.link.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Claim at {gasRow.link.operator} ↗
                        </a>
                      </span>
                    </div>
                  )}
                  {faucet.assets.map((a) => {
                    const action = cta(a);
                    const linkOut = linkOutFor(a);
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
                            <em className={s.left}>
                              {a.claimsLeft} claims left
                            </em>
                          )}
                        </span>
                        <span className={s.act}>
                          {/* A row that cannot pay links to the faucet that can,
                              in place of a disabled "Out of stock"/"Paused" that
                              offers nothing: the gas row on a chain whose faucet
                              holds no gas, and the tokens we did not deploy. Every
                              row for an asset we issue keeps its real Claim
                              button — those are stocked. */}
                          {linkOut ? (
                            <a
                              className={s.claimOut}
                              href={linkOut.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Claim at {linkOut.operator} ↗
                            </a>
                          ) : (
                            <button
                              className={s.claim}
                              disabled={!action.on}
                              onClick={() => faucet.claim(a.address)}
                            >
                              {action.label}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </>
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
              Arc — the lead has already happened in the table above, as that
              row's Claim button, so this panel deliberately leads with nothing
              and explains where that button goes instead. Repeating the same URL
              here as a brand-coloured button would be two controls for one
              errand; `leadLink` stands down for exactly that reason.
            */}
            {(gasLinks.length > 0 || canAskForFee) && (
              <section className={`${s.gas} ${knownStuck ? s.gasLoud : ""}`}>
                <div className={s.gasText}>
                  <b className={s.gasTitle}>
                    {knownStuck
                      ? `You have no ${gasName} to claim with`
                      : `Need ${gasName} first?`}
                  </b>
                  {/* Four different facts, not one sentence with variables in
                      it. Where the table carries the link, this points at it
                      rather than repeating it — and it has to distinguish "no
                      row" (BSC) from "the row is out of stock" (Arc), because a
                      reader looking at a USDC row while being told there isn't
                      one stops believing the rest of the page. Where a native row
                      exists and pays, the faucet covers them from the second
                      claim onwards; where it does not, it never will. And none of
                      it is asserted while the list is still loading. */}
                  <p className={s.gasBody}>
                    {!rowKnown ? (
                      <>
                        Claiming is a transaction, so it costs a fee. A wallet at
                        exactly zero has to get its first {gasName} from outside
                        the app before it can claim anything here.
                      </>
                    ) : gasRow ? (
                      <>
                        Claiming is a transaction, so it costs a fee, and{" "}
                        {gasRow.asset
                          ? `the ${gasName} row above is out of stock`
                          : `this faucet cannot stock ${gasName} — there is no ${gasName} row above`}
                        . That row&rsquo;s Claim button goes to{" "}
                        {gasRow.link.operator}&rsquo;s faucet instead; get{" "}
                        {gasName} there first, then come back and claim the rest
                        here.
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
                  {/* The panel's primary action, as a link rather than a button,
                      for a chain where we can neither read the wallet's native
                      balance nor pay the gas out ourselves. Styled as the brand
                      CTA because in that state it is the only route that works.
                      Undefined wherever the table above already carries the same
                      link — see the note on `leadLink`. */}
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
