"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BORROW_CURRENCIES,
  type BorrowCurrency,
  type BorrowV2,
  type CollateralHolding,
} from "@/hooks/v2/useBorrowV2";
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
  );
}

function CurrencyPicker({
  value,
  onChange,
}: {
  value: BorrowCurrency;
  onChange: (c: BorrowCurrency) => void;
}) {
  return (
    <div className={s.ccy}>
      {BORROW_CURRENCIES.map((c) => (
        <button
          key={c.symbol}
          className={`${s.ccyOpt} ${value === c.symbol ? s.ccyOn : ""}`}
          onClick={() => onChange(c.symbol)}
        >
          {c.symbol}
        </button>
      ))}
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
  const [currency, setCurrency] = useState<BorrowCurrency>("USDC");
  const [busy, setBusy] = useState(false);

  const minN = Number(min);
  const maxN = Number(max);
  const amountN = Number(amount);
  const rangeBad = minN > 0 && maxN > 0 && minN > maxN;
  const overAmount = maxN > 0 && amountN > 0 && maxN > amountN;
  const ready =
    amountN > 0 && minN > 0 && maxN > 0 && Number(apr) > 0 && !rangeBad && !overAmount;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await borrow.postOffer({
        amount,
        minAmount: minN,
        maxAmount: maxN,
        returnDate: daysToUnix(days),
        interest: Number(apr),
        currency,
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
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </div>
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
        <div className={s.warn}>Max can&apos;t exceed the amount you&apos;re lending.</div>
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
        <div className={s.hint}>Annual rate. The contract prorates it over the term.</div>
      </div>

      <div className={s.box}>
        <div className={s.bl}>Term</div>
        <TermPicker days={days} onChange={setDays} />
      </div>

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy ? "Posting…" : ready ? "Post offer" : "Enter amount, range and rate"}
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
  const [currency, setCurrency] = useState<BorrowCurrency>("USDC");
  const [busy, setBusy] = useState(false);

  const ready = Number(amount) > 0 && Number(apr) > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await borrow.postRequest({
        amount,
        interest: Number(apr),
        returnDate: daysToUnix(days),
        currency,
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
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </div>
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
      </div>

      <div className={s.box}>
        <div className={s.bl}>Term</div>
        <TermPicker days={days} onChange={setDays} />
      </div>

      <div className={s.summary}>
        <div className={s.sRow}>
          <span className={s.sLabel}>Collateral posted</span>
          <span className="tabular">
            ${borrow.collateralValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
      {borrow.collateralValueUsd === 0 && (
        <div className={s.warn}>
          You have no collateral deposited — the request will revert until you add some.
        </div>
      )}

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy ? "Posting…" : ready ? "Post request" : "Enter an amount and rate"}
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
  listing: { listingId: number; min: number; max: number; symbol: string } | null;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount("");
  }, [open, listing?.listingId]);

  if (!listing) return null;

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
        currency: listing.symbol,
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

  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 6 });

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
          <span className={s.ccyOn} style={{ padding: "6px 13px", borderRadius: 999 }}>
            {listing.symbol}
          </span>
        </div>
        <div className={s.hint}>
          This offer allows {fmt(listing.min)} – {fmt(listing.max)} {listing.symbol}.
        </div>
      </div>

      {tooLow && <div className={s.warn}>Below the {fmt(listing.min)} minimum.</div>}
      {tooHigh && <div className={s.warn}>Above the {fmt(listing.max)} maximum.</div>}

      <div className={s.summary}>
        <div className={s.sRow}>
          <span className={s.sLabel}>Your collateral</span>
          <span className="tabular">
            ${borrow.collateralValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy ? "Borrowing…" : ready ? `Borrow ${amount} ${listing.symbol}` : "Enter an amount"}
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
  const [currency, setCurrency] = useState<BorrowCurrency>("USDC");
  const [busy, setBusy] = useState(false);

  const token = BORROW_CURRENCIES.find((c) => c.symbol === currency)!;
  const held: CollateralHolding | undefined = borrow.collateral.find(
    (c) => c.symbol === currency,
  );
  const overWithdraw =
    mode === "withdraw" && Number(amount) > (held?.amount ?? 0);
  const ready = Number(amount) > 0 && !overWithdraw;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      if (mode === "deposit") {
        await borrow.depositCollateral(amount, token.address);
        toast.success("Collateral deposited");
      } else {
        await borrow.withdrawCollateral(amount, token.address);
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
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </div>
        <div className={s.hint}>
          Deposited: {(held?.amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
          {currency}
        </div>
      </div>

      {overWithdraw && (
        <div className={s.warn}>You only have {held?.amount ?? 0} {currency} deposited.</div>
      )}
      {mode === "withdraw" && borrow.loans.length > 0 && (
        <div className={s.warn}>
          Withdrawing lowers your health factor while loans are open.
        </div>
      )}

      <button className={s.cta} disabled={!ready || busy} onClick={submit}>
        {busy
          ? mode === "deposit"
            ? "Depositing…"
            : "Withdrawing…"
          : ready
            ? mode === "deposit"
              ? "Deposit collateral"
              : "Withdraw collateral"
            : "Enter an amount"}
      </button>
    </Shell>
  );
}
