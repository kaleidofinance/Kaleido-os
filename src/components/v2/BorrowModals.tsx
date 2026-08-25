"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  type BorrowV2,
  type CollateralHolding,
  type LendingAsset,
} from "@/hooks/v2/useBorrowV2";
import Portal from "./Portal";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import type { LendingFees } from "@/hooks/useLendingFees";
import {
  formatBps,
  netLenderRateBps,
  penaltySplitBps,
} from "@/lib/lending/fees";
import s from "./BorrowModals.module.css";

/**
 * The v2 Borrow action surfaces — post an offer, post a request, take a loan
 * from a listing, and manage collateral.
 *
 * These replace the legacy /borrow-allocation page and the marketplace forms
 * the v2 rebuild never carried over. Each one calls through useBorrowV2, which
 * passes an onSuccess callback so the legacy hooks don't redirect out of v2.
 */

const TERMS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
];

const daysToUnix = (days: number) =>
  Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;

function Shell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={s.modal}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.mh}>
            <span className={s.mt}>{title}</span>
            <button className={s.mx} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className={s.mb}>{children}</div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * The selected asset, chosen out of a list the diamond itself gave us.
 *
 * The list arrives asynchronously and can legitimately be empty, so `asset` is
 * `LendingAsset | undefined` and every caller has to gate its submit on it. That
 * is the whole point of the change: the picker used to be a module-level
 * `borrowCurrencies(READ_ONLY_CHAIN_ID)` — ETH / USDC / USDT / kfUSD, derived from
 * which addresses EXIST in the deployment registry — and on all five deployed
 * chains that disagreed with what the diamond will accept. kfUSD was offered
 * everywhere and registered nowhere; the native asset was offered as a loan
 * currency everywhere and is loanable nowhere; the wrapped native is registered
 * collateral on all five and was offered on none. Each wrong option cost the user
 * gas to discover, because the facet fails closed on the same `s_priceFeeds`
 * mapping it gates registration on.
 *
 * `preferred` is a hint, not a guarantee — Arc's only loanable asset is WUSDC, so
 * asking for "USDC" there falls through to the first entry.
 */
function useAssetOptions(
  options: LendingAsset[],
  preferred = "USDC",
): {
  asset: LendingAsset | undefined;
  symbol: string;
  setSymbol: (symbol: string) => void;
} {
  const [wanted, setSymbol] = useState(preferred);
  const asset = options.find((o) => o.symbol === wanted) ?? options[0];
  return { asset, symbol: asset?.symbol ?? wanted, setSymbol };
}

/**
 * Why the picker above it is unusable, or nothing.
 *
 * A failed read and an empty list are different facts and read differently here.
 * useLendingAssets fails closed — it does not fall back to the registry's offered
 * list — so an RPC outage has to say so rather than silently presenting four
 * options the protocol never agreed to.
 */
function AssetState({
  state,
  options,
  what,
}: {
  state: BorrowV2["assets"];
  options: LendingAsset[];
  what: string;
}) {
  if (state.loading)
    return <div className={s.hint}>Reading what this market accepts…</div>;
  if (state.error) return <div className={s.warn}>{state.error}</div>;
  if (options.length === 0)
    return (
      <div className={s.warn}>
        Nothing is registered as {what} on the lending chain right now.
      </div>
    );
  return null;
}

function CurrencyPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: LendingAsset[];
  onChange: (symbol: string) => void;
}) {
  return (
    <div className={s.ccy}>
      {options.map((c) => {
        return (
          <button
            /* Keyed on the address, not the symbol: identity here is
               (chain, address), and two registered assets can share a symbol —
               Arc's registered WUSDC and the `0x3600…` USDC predeploy both read
               as dollar tokens. */
            key={c.address}
            className={`${s.ccyOpt} ${value === c.symbol ? s.ccyOn : ""}`}
            onClick={() => onChange(c.symbol)}
          >
            {/* TokenIcon alone, resolved by symbol. There was a raw <img> ahead
                of it sourced from `tokenImageMap[c.address]?.image` — a flat map
                of five Abstract-testnet addresses, so once the protocol deployed
                elsewhere it matched nothing and this fell through to TokenIcon on
                every chain anyway. Dead branch, and a per-address image table is
                the wrong shape for art that depends only on the asset. */}
            <span
              className={`${s.tki} ${hasTokenIcon(c.symbol) ? s.tkiArt : ""}`}
            >
              {hasTokenIcon(c.symbol) ? (
                <TokenIcon symbol={c.symbol} size={20} variant="branded" />
              ) : null}
            </span>
            {c.symbol}
          </button>
        );
      })}
    </div>
  );
}

function TermPicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  return (
    <div className={s.terms}>
      {TERMS.map((t) => (
        <button
          key={t.days}
          className={`${s.term} ${days === t.days ? s.termOn : ""}`}
          onClick={() => onChange(t.days)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const num = (v: string) => v.replace(/[^0-9.]/g, "");

/**
 * What the lender keeps of the rate they just typed.
 *
 * The protocol takes `getBPS()` of the interest a loan earns, out of the
 * repayment and before the lender is credited — so the APR entered here is the
 * borrower's cost and not the lender's yield, and the two differ by a tenth on
 * every deployed chain. Nothing said so anywhere: this modal's only rate hint
 * explained proration and stopped.
 *
 * `pct` is a percentage, matching the input, because useCreateLoanListing scales
 * it to basis points with `formatInterestRate` on the way to the contract.
 */
function LenderYieldNote({ fees, pct }: { fees: LendingFees; pct: number }) {
  if (fees.loading)
    return <div className={s.hint}>Reading the protocol&apos;s fee…</div>;

  /* Stated, not skipped. A fee that failed to load is still charged, and the
     alternative to saying so is a screen that quietly implies there is none. */
  if (fees.error || fees.interestFeeBps === null)
    return (
      <div className={s.warn}>
        Couldn&apos;t read the protocol&apos;s cut of interest. It still applies
        — your yield will be below the rate you set here.
      </div>
    );

  const cut = formatBps(fees.interestFeeBps);
  const net = pct > 0 ? netLenderRateBps(pct * 100, fees.interestFeeBps) : null;

  return (
    <div className={s.hint}>
      Annual rate, prorated over the term. The protocol takes {cut} of the
      interest,{" "}
      {net === null
        ? "so your yield is below the rate you set."
        : `so you net ${formatBps(net)} APR on this offer.`}
    </div>
  );
}

/**
 * What being liquidated costs the borrower, beyond the debt.
 *
 * The penalty is charged on the lender's claim and taken from collateral above
 * it, so it is the borrower who bears it — three quarters to whoever closes the
 * position and the rest to the protocol. Every borrower-facing surface offered a
 * health factor and no indication of what crossing it costs.
 */
function LiquidationNote({ fees }: { fees: LendingFees }) {
  if (fees.loading || fees.liquidationPenaltyBps === null) return null;

  const { liquidator, protocol } = penaltySplitBps(fees.liquidationPenaltyBps);

  return (
    <div className={s.hint}>
      If your health factor breaks, liquidation takes up to{" "}
      {formatBps(fees.liquidationPenaltyBps)} of the debt out of your collateral
      on top of the debt itself — {formatBps(liquidator)} to the liquidator,{" "}
      {formatBps(protocol)} to the protocol.
    </div>
  );
}

/**
 * The borrower's side of the interest fee: there isn't one.
 *
 * `repayLoan` computes the fee out of the interest already owed and credits the
 * lender the remainder, so `totalRepayment` — the borrower's whole obligation —
 * is unaffected by `getBPS()`. Worth saying rather than leaving blank: a borrower
 * who has seen the fee disclosed on the lend side will otherwise assume it is
 * added to what they repay.
 */
function BorrowerCostNote({ fees }: { fees: LendingFees }) {
  if (fees.loading || fees.interestFeeBps === null)
    return (
      <div className={s.hint}>
        Annual rate, prorated over the term. This is the whole cost of the loan.
      </div>
    );

  return (
    <div className={s.hint}>
      Annual rate, prorated over the term. Nothing is added on top — the
      protocol&apos;s {formatBps(fees.interestFeeBps)} comes out of your
      lender&apos;s share of this interest, not out of your repayment.
    </div>
  );
}

/** Lender posts an offer others can borrow against. */
export function PostOfferModal({
  open,
  onClose,
  borrow,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [apr, setApr] = useState("");
  const [days, setDays] = useState(30);
  /* Loanable, not collateral. An offer lends the asset out, and the two sets are
     genuinely different — the native asset is registered collateral on all five
     chains and loanable on none, so offering it here would revert
     Protocol__TokenNotLoanable. */
  const { loanable } = borrow.assets;
  const { asset, symbol, setSymbol } = useAssetOptions(loanable);
  const [busy, setBusy] = useState(false);

  const minN = Number(min);
  const maxN = Number(max);
  const amountN = Number(amount);
  const rangeBad = minN > 0 && maxN > 0 && minN > maxN;
  const overAmount = maxN > 0 && amountN > 0 && maxN > amountN;
  const ready =
    !!asset &&
    amountN > 0 &&
    minN > 0 &&
    maxN > 0 &&
    Number(apr) > 0 &&
    !rangeBad &&
    !overAmount;

  const submit = async () => {
    if (!ready || !asset) return;
    setBusy(true);
    try {
      await borrow.postOffer({
        amount,
        minAmount: minN,
        maxAmount: maxN,
        returnDate: daysToUnix(days),
        interest: Number(apr),
        asset,
        onSuccess: () => {
          toast.success("Offer posted");
          onDone();
          onClose();
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell open={open} title="Post an offer" onClose={onClose}>
      <div className={s.box}>
        <div className={s.bl}>You lend</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            value={amount}
            onChange={(e) => setAmount(num(e.target.value))}
            placeholder="0"
            aria-label="Amount to lend"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <CurrencyPicker
            value={symbol}
            options={loanable}
            onChange={setSymbol}
          />
        </div>
        <AssetState
          state={borrow.assets}
          options={loanable}
          what="a loan currency"
        />
      </div>

      <div className={s.row2}>
        <div className={s.box}>
          <div className={s.bl}>Min per borrower</div>
          <input
            className={`${s.smallInp} tabular`}
            value={min}
            onChange={(e) => setMin(num(e.target.value))}
            placeholder="0"
            aria-label="Minimum per borrower"
          />
        </div>
        <div className={s.box}>
          <div className={s.bl}>Max per borrower</div>
          <input
            className={`${s.smallInp} tabular`}
            value={max}
            onChange={(e) => setMax(num(e.target.value))}
            placeholder="0"
            aria-label="Maximum per borrower"
          />
        </div>
      </div>
      {rangeBad && <div className={s.warn}>Min can&apos;t be above max.</div>}
      {overAmount && (
        <div className={s.warn}>
          Max can&apos;t exceed the amount you&apos;re lending.
        </div>
      )}

      <div className={s.box}>
        <div className={s.bl}>APR</div>
        <div className={s.amt}>
          <input
            className={`${s.smallInp} tabular`}
            value={apr}
            onChange={(e) => setApr(num(e.target.value))}
            placeholder="0.0"
            aria-label="Annual percentage rate"
          />
          <span className={s.sLabel}>%</span>
        </div>
        <LenderYieldNote fees={borrow.fees} pct={Number(apr)} />
      </div>

      <div className={s.box}>
        <div className={s.bl}>Term</div>
        <TermPicker days={days} onChange={setDays} />
      </div>

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy
          ? "Posting…"
          : borrow.assets.loading
            ? "Reading assets…"
            : !asset
              ? "No loan currency available"
              : ready
                ? "Post offer"
                : "Enter amount, range and rate"}
      </button>
    </Shell>
  );
}

/** Borrower posts a request lenders can fund. */
export function PostRequestModal({
  open,
  onClose,
  borrow,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [apr, setApr] = useState("");
  const [days, setDays] = useState(30);
  /* Loanable: a request asks to borrow the asset, and the facet rejects one
     denominated in anything it has not marked `s_isLoanable`. */
  const { loanable } = borrow.assets;
  const { asset, symbol, setSymbol } = useAssetOptions(loanable);
  const [busy, setBusy] = useState(false);

  const ready = !!asset && Number(amount) > 0 && Number(apr) > 0;

  const submit = async () => {
    if (!ready || !asset) return;
    setBusy(true);
    try {
      await borrow.postRequest({
        amount,
        interest: Number(apr),
        returnDate: daysToUnix(days),
        asset,
        onSuccess: () => {
          toast.success("Request posted");
          onDone();
          onClose();
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell open={open} title="Post a request" onClose={onClose}>
      <div className={s.box}>
        <div className={s.bl}>You borrow</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            value={amount}
            onChange={(e) => setAmount(num(e.target.value))}
            placeholder="0"
            aria-label="Amount to borrow"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <CurrencyPicker
            value={symbol}
            options={loanable}
            onChange={setSymbol}
          />
        </div>
        <AssetState
          state={borrow.assets}
          options={loanable}
          what="borrowable"
        />
      </div>

      <div className={s.box}>
        <div className={s.bl}>APR you&apos;ll pay</div>
        <div className={s.amt}>
          <input
            className={`${s.smallInp} tabular`}
            value={apr}
            onChange={(e) => setApr(num(e.target.value))}
            placeholder="0.0"
            aria-label="Annual percentage rate"
          />
          <span className={s.sLabel}>%</span>
        </div>
        <BorrowerCostNote fees={borrow.fees} />
      </div>

      <div className={s.box}>
        <div className={s.bl}>Term</div>
        <TermPicker days={days} onChange={setDays} />
      </div>

      <div className={s.summary}>
        <div className={s.sRow}>
          <span className={s.sLabel}>Collateral posted</span>
          <span className="tabular">
            $
            {borrow.collateralValueUsd.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>
      {borrow.collateralValueUsd === 0 && (
        <div className={s.warn}>
          You have no collateral deposited — the request will revert until you
          add some.
        </div>
      )}
      <LiquidationNote fees={borrow.fees} />

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy
          ? "Posting…"
          : borrow.assets.loading
            ? "Reading assets…"
            : !asset
              ? "Nothing borrowable here"
              : ready
                ? "Post request"
                : "Enter an amount and rate"}
      </button>
    </Shell>
  );
}

/** Take a loan against an existing listing — replaces /borrow-allocation. */
export function TakeLoanModal({
  open,
  onClose,
  borrow,
  listing,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  /**
   * The row's own asset, resolved by the caller, not a symbol.
   *
   * There is no picker here — a listing is denominated in one thing and the
   * borrower can only take that. It used to carry `symbol: string`, resolved from
   * `tokenImageMap[addr]?.label ?? "USDC"`, and useAcceptListedAds then turned
   * that symbol back into a scale with `=== "ETH" ? 18 : 6`. An unmapped listing
   * token therefore borrowed at 6 decimals whatever it actually was.
   */
  listing: {
    listingId: number;
    min: number;
    max: number;
    asset: LendingAsset;
  } | null;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount("");
  }, [open, listing?.listingId]);

  if (!listing) return null;

  const symbol = listing.asset.symbol;
  const n = Number(amount);
  const tooLow = n > 0 && n < listing.min;
  const tooHigh = n > 0 && n > listing.max;
  const ready = n > 0 && !tooLow && !tooHigh;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await borrow.takeLoan({
        listingId: listing.listingId,
        amount,
        asset: listing.asset,
        onSuccess: () => {
          toast.success("Loan taken");
          onDone();
          onClose();
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const fmt = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <Shell open={open} title="Take a loan" onClose={onClose}>
      <div className={s.box}>
        <div className={s.bl}>You borrow</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            value={amount}
            onChange={(e) => setAmount(num(e.target.value))}
            placeholder="0"
            autoFocus
            aria-label="Amount to borrow"
          />
          <span
            className={s.ccyOn}
            style={{
              padding: "6px 13px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              className={`${s.tki} ${hasTokenIcon(symbol) ? s.tkiArt : ""}`}
            >
              <TokenIcon
                symbol={symbol}
                size={16}
                fallback={symbol.slice(0, 3)}
              />
            </span>
            {symbol}
          </span>
        </div>
        <div className={s.hint}>
          This offer allows {fmt(listing.min)} – {fmt(listing.max)} {symbol}.
        </div>
      </div>

      {tooLow && (
        <div className={s.warn}>Below the {fmt(listing.min)} minimum.</div>
      )}
      {tooHigh && (
        <div className={s.warn}>Above the {fmt(listing.max)} maximum.</div>
      )}

      <div className={s.summary}>
        <div className={s.sRow}>
          <span className={s.sLabel}>Your collateral</span>
          <span className="tabular">
            $
            {borrow.collateralValueUsd.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>
      {/* The offer's rate is the whole interest cost — the protocol's cut comes
          out of the lender's side. What is not otherwise visible here is the
          liquidation penalty, which is entirely the borrower's. */}
      <LiquidationNote fees={borrow.fees} />

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy
          ? "Borrowing…"
          : ready
            ? `Borrow ${amount} ${symbol}`
            : "Enter an amount"}
      </button>
    </Shell>
  );
}

/** Deposit or withdraw collateral backing your loans. */
export function CollateralModal({
  open,
  onClose,
  borrow,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  /* Collateral, not loanable. This is the set the offered list was most wrong
     about: the wrapped native (WETH9 / WBNB / WUSDC) is registered collateral on
     all five chains and had no option here at all, so a user who deposited it
     could not withdraw it from this surface, while kfUSD — registered nowhere —
     was offered on every one. */
  const { collateral: depositable } = borrow.assets;
  const { asset, symbol, setSymbol } = useAssetOptions(depositable);
  const [busy, setBusy] = useState(false);

  /* Matched on address. The holdings come from the same diamond list the picker
     does, so the addresses are identical strings today — but symbol matching is
     what let a picker entry and a holding row disagree in the first place, and
     identity here is (chain, address). */
  const held: CollateralHolding | undefined = asset
    ? borrow.collateral.find(
        (c) => c.address.toLowerCase() === asset.address.toLowerCase(),
      )
    : undefined;
  const overWithdraw =
    mode === "withdraw" && Number(amount) > (held?.amount ?? 0);
  const ready = !!asset && Number(amount) > 0 && !overWithdraw;

  const submit = async () => {
    if (!ready || !asset) return;
    setBusy(true);
    try {
      if (mode === "deposit") {
        await borrow.depositCollateral(amount, asset);
        toast.success("Collateral deposited");
      } else {
        await borrow.withdrawCollateral(amount, asset);
        toast.success("Collateral withdrawn");
      }
      setAmount("");
      onDone();
      onClose();
    } catch {
      toast.error("Couldn't update collateral");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell open={open} title="Collateral" onClose={onClose}>
      <div className={s.seg}>
        <button
          className={`${s.segBtn} ${mode === "deposit" ? s.segOn : ""}`}
          onClick={() => setMode("deposit")}
        >
          Deposit
        </button>
        <button
          className={`${s.segBtn} ${mode === "withdraw" ? s.segOn : ""}`}
          onClick={() => setMode("withdraw")}
        >
          Withdraw
        </button>
      </div>

      <div className={s.box}>
        <div className={s.bl}>Amount</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            value={amount}
            onChange={(e) => setAmount(num(e.target.value))}
            placeholder="0"
            aria-label="Collateral amount"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <CurrencyPicker
            value={symbol}
            options={depositable}
            onChange={setSymbol}
          />
        </div>
        <AssetState
          state={borrow.assets}
          options={depositable}
          what="collateral"
        />
        <div className={s.hint}>
          Deposited:{" "}
          {(held?.amount ?? 0).toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })}{" "}
          {symbol}
        </div>
      </div>

      {overWithdraw && (
        <div className={s.warn}>
          You only have {held?.amount ?? 0} {symbol} deposited.
        </div>
      )}
      {mode === "withdraw" && borrow.loans.length > 0 && (
        <>
          <div className={s.warn}>
            Withdrawing lowers your health factor while loans are open.
          </div>
          {/* The consequence, not just the direction. The warning above named the
              risk and left its price out; the penalty is read from the same
              diamond the loans are in. */}
          <LiquidationNote fees={borrow.fees} />
        </>
      )}

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy
          ? mode === "deposit"
            ? "Depositing…"
            : "Withdrawing…"
          : borrow.assets.loading
            ? "Reading assets…"
            : !asset
              ? "No collateral asset available"
              : ready
                ? mode === "deposit"
                  ? "Deposit collateral"
                  : "Withdraw collateral"
                : "Enter an amount"}
      </button>
    </Shell>
  );
}
