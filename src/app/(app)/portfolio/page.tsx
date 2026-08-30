"use client";

import { useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import Nav from "@/components/v2/Nav";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import {
  usePortfolio,
  type Position,
  type PositionGroup as Group,
  type GroupId,
} from "@/hooks/usePortfolio";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import AvatarPicker from "./_components/AvatarPicker";
import { drawShareCard } from "./shareCard";
import s from "./portfolio.module.css";

const usd = (n: number | null, dp = 2) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      });

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}%`);

const healthText = (h: number | null) =>
  h === null ? "—" : h === Infinity ? "∞" : h.toFixed(2);

/**
 * Which tables fold their status chip up beside the money on a phone, instead of
 * spending a line of row height on it. See `.rowFold` in portfolio.module.css.
 *
 * By group, and hard-coded, because the layout has to be a property of the table
 * rather than of what the reader happens to be holding. The natural test —
 * "does any row here have a rate?" — is right about the pixels and wrong about
 * the experience: it was live data, so a Borrowing table folded until the day you
 * borrowed, a Stable table unfolded the moment the vault's APY resolved from null,
 * and repaying your last loan reshuffled a table you were not looking at. Fixed
 * per group, a table looks the same every time you open it.
 *
 * A chip can only fold where there is no rate to share its line with, so the three
 * groups that can hold a rate at all (Lending always does; Borrowing and Stable
 * do as soon as there is a debt or a priced vault) keep the chip on its own line
 * even in the states where they happen to have none. It is a `Record`, not a
 * `Set`, so a sixth group cannot be added without answering this question.
 */
const FOLD_CHIP: Record<GroupId, boolean> = {
  wallet: true,
  staking: true,
  lending: false,
  borrowing: false,
  stable: false,
};

/** Row shared by all five group tables. */
function PositionRow({ p, fold }: { p: Position; fold: boolean }) {
  const toneClass =
    p.state.tone === "bad" ? s.bad : p.state.tone === "warn" ? s.warn : "";
  return (
    <div className={`${s.row} ${fold ? s.rowFold : ""}`}>
      <div className={s.asset}>
        <span className={`${s.icon} ${hasTokenIcon(p.label) ? s.iconArt : ""}`}>
          <TokenIcon
            symbol={p.label}
            size={34}
            fallback={p.label.slice(0, 3)}
          />
        </span>
        <div>
          <div className={s.aName}>{p.label}</div>
          <div className={s.aSub}>{p.sublabel}</div>
        </div>
      </div>
      {/* These tables have no header row at any width — on desktop the four
          columns are read by position — so the phone layout at the foot of
          portfolio.module.css is where the figures get named, from `data-label`.
          It prints only the APY one: a right-aligned currency figure with a token
          amount under it needs no label, while a bare "4.80%" could be read as
          anything. The `cellValue` / `cellApy` classes are what place the two on
          the phone's two-column row; the desktop template ignores them. */}
      <div data-label="Value" className={`${s.cell} ${s.cellValue} tabular`}>
        <span className={s.cVal}>{usd(p.valueUsd)}</span>
        {p.amount && <span className={s.cSub}>{p.amount}</span>}
      </div>
      {/* APY and the status chip travel together in one wrapper, which is
          `display: contents` everywhere except one case — so they stay two
          ordinary cells, the four-column grid on desktop and two stacked cells on
          a phone, exactly as when they were direct children. The exception is a
          table listed in `FOLD_CHIP` above: nothing there has a rate for the chip
          to share a line with, so rather than spend a whole line on the word
          "Idle" the wrapper becomes a flex row tucked under the figures. Every
          other table is untouched. See portfolio.module.css. */}
      <div className={s.meta}>
        {/* `cellNone` hides this cell outright on a phone when there is no rate to
            show. Desktop keeps the em dash, because there the cell is holding a
            column open under the rows above and below it; stacked, an "APY —" line
            is a label with nothing behind it, and most rows on this page have no
            rate at all. */}
        <div
          data-label="APY"
          className={`${s.cell} ${s.cellApy} ${
            p.apy === null ? s.cellNone : ""
          } tabular`}
        >
          <span className={p.apy !== null && p.apy > 0 ? s.pos : s.cVal}>
            {pct(p.apy)}
          </span>
        </div>
        <span className={`${s.badge} ${toneClass}`}>{p.state.text}</span>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { address, isConnected, shortAddress, chainName } = useWalletV2();
  const p = usePortfolio();
  const gate = useChainGate();
  /* Passed to drawShareCard as its token scope. A ref rather than a
     querySelector because the card reads --k-bg and friends off `.kaleido-v2`
     (tokens.css:29), and this <main> is inside it by construction. */
  const mainRef = useRef<HTMLElement>(null);

  /*
   * Share and Deposit were markup with no handler — chrome from the first pass
   * at this header. Wiring them meant deciding what each one is for, and both
   * answers ruled out the obvious implementation:
   *
   * Share posts an IMAGE, and falls back through two weaker forms of the same
   * thing. What it must never share is this URL on its own: /portfolio renders
   * whichever wallet is connected in the reader's own browser, so the bare link
   * tells a recipient nothing about the sender — it shows them their own empty
   * portfolio. The figures have to travel with it. A card is how the trading apps
   * do this and the reason is not decoration: the numbers are the message, and an
   * image is the only form of them that survives a repost and a thumbnail. See
   * shareCard.ts for why it is drawn on the device instead of by an OG route.
   *
   * Deposit goes to /borrow because "deposit" already means one thing in this
   * app: the Deposit/Withdraw control in the lending Collateral modal. Opening
   * that modal here would need a second useBorrowV2 instance (usePortfolio does
   * not use it) plus the LendingDataProvider it reads from — a page of contract
   * calls for one button. The other candidates all have their own verb and their
   * own tab: add liquidity, mint, stake.
   *
   * Both are hidden until a wallet is connected, the way WalletMenu gates
   * /faucet: a control whose target is empty is worse than one that is absent.
   */
  const share = async () => {
    const url = window.location.origin;
    /* Figures only when they are real — usd(null) is an em dash, and "— net
       position" reads worse than an invitation with no numbers in it. */
    const text =
      p.netValue === null
        ? "My Kaleido portfolio — lending, swaps and kfUSD in one place."
        : `My Kaleido portfolio: ${usd(p.netValue)} net position, health factor ${healthText(p.health)}.`;

    /*
     * The card, drawn before anything is offered so the three delivery paths
     * below all carry the same artefact. `null` back is a real outcome — no 2D
     * context, or an encoder failure — and it is why the text share stays as the
     * floor rather than being replaced.
     */
    let blob: Blob | null = null;
    if (mainRef.current) {
      try {
        blob = await drawShareCard(mainRef.current, {
          netValue: usd(p.netValue),
          /* Same four in the same order as the strip below, so the card is a
             portrait of the page and not a second opinion about it. */
          stats: [
            { label: "Health factor", value: healthText(p.health) },
            { label: "Collateral", value: usd(p.collateralUsd, 0) },
            { label: "Borrowed", value: usd(p.debtUsd, 0) },
            { label: "Unclaimed", value: usd(p.unclaimedYieldUsd) },
          ],
          /* `?? null` because useWalletV2 reports an unknown chain as undefined
             while the card's contract is `string | null` — the codebase's spelling
             of "genuinely unknown", per usePortfolio's Position doc. */
          network: chainName ?? null,
        });
      } catch {
        /* Anything unexpected in the draw is not worth the user's share. */
        blob = null;
      }
    }

    if (blob) {
      const file = new File([blob], "kaleido-portfolio.png", {
        type: "image/png",
      });
      /* canShare({files}) rather than a bare `share` check: desktop Chrome has
         navigator.share and refuses files, so feature-detecting the API instead
         of the payload opens a share sheet that then throws. */
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          return;
        } catch (err) {
          /* AbortError is the user closing the sheet — an intentional no, and
             saving a file behind their back is not the answer to it. Anything
             else falls through: notably Safari can reject on lost transient
             activation, since drawing the card spends part of the click's
             activation window, and a download is the right consolation. */
          if (err instanceof Error && err.name === "AbortError") return;
        }
      }

      /* Clipboard image — the desktop equivalent of the share sheet, and the one
         that lands the card straight into a compose box. Chromium and Safari
         only; Firefox has no image write, hence the download below. */
      try {
        if (
          typeof ClipboardItem === "function" &&
          typeof navigator.clipboard?.write === "function"
        ) {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          toast.success("Portfolio card copied");
          return;
        }
      } catch {
        /* Permission-gated and origin-gated. Fall through rather than report —
           the download below always works. */
      }

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "kaleido-portfolio.png";
      a.click();
      /* Revoked on a later task, not immediately: some browsers cancel a
         download whose blob URL is torn down in the same tick as the click. */
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      toast.success("Portfolio card saved");
      return;
    }

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Kaleido portfolio", text, url });
        return;
      } catch (err) {
        /* AbortError is the user closing the share sheet — an intentional no,
           and copying to the clipboard behind their back is not the answer to
           it. Any other rejection is the API failing (no transient activation,
           no share target), which is what the fallback below exists for. */
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Portfolio summary copied");
    } catch {
      /* Clipboard is permission-gated and throws on insecure origins. */
      toast.error(
        "Couldn't copy — the figures are on screen to share by hand.",
      );
    }
  };

  return (
    <>
      <Nav />
      <main className={s.wrap} ref={mainRef}>
        <div className={s.head}>
          {/* Generated from the address, and pickable — see _components/
              AvatarPicker.tsx. It stands in for a profile picture the app has no
              way to know yet, which is also why the component is one branch away
              from resolving a linked NFT instead. */}
          <AvatarPicker address={address ?? null} />
          <div>
            <div className={s.paddr}>
              {isConnected ? shortAddress : "Not connected"}
            </div>
            <div className={s.pnet}>{chainName ?? "No network"}</div>
          </div>
          {isConnected && (
            <div className={s.hActions}>
              <button className={s.bt} onClick={share}>
                Share
              </button>
              <Link href="/borrow" className={`${s.bt} ${s.btWhite}`}>
                Deposit
              </Link>
            </div>
          )}
        </div>

        {/* The header stays above the gate on purpose — the address and network
            are the two facts that explain *why* the gate is showing, so hiding
            them behind it would remove the evidence. Everything below reads
            positions, so all of it is gated together rather than left as four
            dashes and two empty tables. */}
        {!gate.ready ? (
          <ChainGate product="portfolio" state={gate} />
        ) : (
          <>
            <div>
              {/*
                `netValuePartial` is true whenever a group could not price
                something it holds — a wallet with WBTC in it, a collateral figure
                the oracle would not answer for — which makes this figure a floor
                rather than a total. It used to say so in a sentence under the
                number, and each group used to name its own gap under its table.
                Neither does now: a product's headline figure is the headline
                figure, and a paragraph of caveat under it reads as an apology for
                the page. What is unpriced already shows as an em dash on the row
                itself, which is where a reader is looking when they wonder. The
                flag survives here as the number's own tooltip.
              */}
              <div
                className={`${s.value} tabular`}
                title={
                  p.netValuePartial
                    ? "Excludes holdings with no price feed"
                    : undefined
                }
              >
                {usd(p.netValue)}
              </div>
              <div className={s.eyebrow}>Net position</div>
            </div>

            <div className={s.strip}>
              <div className={s.stat}>
                <span className={s.sLabel}>Health factor</span>
                <span className={`${s.sVal} tabular`}>
                  {healthText(p.health)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Collateral</span>
                <span className={`${s.sVal} tabular`}>
                  {usd(p.collateralUsd, 0)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Borrowed</span>
                <span className={`${s.sVal} tabular`}>{usd(p.debtUsd, 0)}</span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Unclaimed</span>
                <span className={`${s.sVal} tabular`}>
                  {usd(p.unclaimedYieldUsd)}
                </span>
              </div>
            </div>

            <div className={s.cols}>
              <div className={s.main}>
                {/* Every group, every time — including the empty ones. A reader
                    with nothing lent cannot tell "I have no offers" from "this
                    page does not show offers" if the Lending group is absent,
                    and the empty state is one line plus a link to the surface
                    that fills it. The order is the hook's, which is the order
                    money moves through the protocol: wallet, then what it was
                    lent to, borrowed against, minted into, staked as. */}
                {p.groups.map((g) => (
                  <PositionGroup key={g.id} group={g} loading={p.isLoading} />
                ))}
              </div>

              <aside className={s.side}>
                <div className={s.sideTitle}>Needs attention</div>
                {p.alerts.length === 0 && (
                  <div className={s.calm}>Nothing needs attention.</div>
                )}
                {p.alerts.map((a) => (
                  <a key={a.id} href={a.href ?? "#"} className={s.alert}>
                    <span
                      className={`${s.aIcon} ${
                        a.severity === "info" ? "" : s.aWarn
                      }`}
                    >
                      {a.severity === "info" ? "↑" : "!"}
                    </span>
                    <div>
                      <div className={s.alTitle}>{a.title}</div>
                      <div className={s.alDetail}>{a.detail}</div>
                    </div>
                  </a>
                ))}
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

/**
 * One group: a heading that links to the product, a subtotal, and its rows.
 *
 * The subtotal is the group's contribution to the net figure above, which for
 * Borrowing means collateral net of debt rather than the sum of the rows — see
 * usePortfolio's header. So the five subtotals add up to the headline exactly,
 * and a reader can check the page against itself.
 *
 * A row the hook could not price shows an em dash in its Value cell, and that is
 * the whole of what this page says about it. `group.unpriced` names those rows and
 * is deliberately not rendered: the dash is already visible on the row itself, and
 * a sentence under the table repeating it in prose is a note about the product's
 * plumbing rather than about the reader's money.
 */
function PositionGroup({ group, loading }: { group: Group; loading: boolean }) {
  const { rows } = group;
  const fold = FOLD_CHIP[group.id];
  return (
    <section className={s.group}>
      <div className={s.gHead}>
        {/* The heading is the link: "Lending" → /lend is the whole label a
            separate call-to-action would have carried, and it gives the empty
            state somewhere to point without inventing a verb per group. */}
        <Link href={group.href} className={s.gTitle}>
          {group.title}
        </Link>
        <span className={`${s.gSum} tabular`}>{usd(group.subtotalUsd)}</span>
      </div>
      <div className={s.table}>
        {loading && rows.length === 0 ? (
          <div className={s.rowSkeleton}>
            <span className={s.skCircle} />
            <span className={s.skLine} />
          </div>
        ) : rows.length === 0 ? (
          <Link href={group.href} className={s.empty}>
            {group.empty}
          </Link>
        ) : (
          rows.map((r) => <PositionRow key={r.id} p={r} fold={fold} />)
        )}
      </div>
    </section>
  );
}
