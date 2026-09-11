"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
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
import type { IToken } from "@/constants/types/dex";
import type { CollateralIntent } from "@/components/v2/LendingDataContext";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { getChainMeta, toThirdwebChainOptions } from "@/constants/chains";
import { isSupportedChain } from "@/config/chain";
import { LENDING_CHAIN_ID } from "@/lib/lending/chain";
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

/**
 * The asset chooser for the lending forms.
 *
 * It used to lay every registered asset out as a row of inline pills. The pills
 * named the asset and nothing else, so the one fact that decides which to pick
 * when you are lending or posting collateral — how much of each you hold — was
 * absent, and the form only revealed it (for the selected one) in the balance
 * line below. This is the swap and pool pattern instead: a single pill showing
 * the current asset that opens a modal listing them all, each with its wallet
 * balance, so the choice is made with the balances in view rather than after.
 *
 * The list is still the curated set the diamond gave us (loanable or collateral,
 * whichever the caller passed), NOT the global token registry TokenSelector
 * lists — offering a token the facet has not registered would only revert — and
 * balances read on LENDING_CHAIN_ID, the chain these assets live on, the same as
 * the balance line the forms already show.
 *
 * Signature unchanged from the pills it replaces (value symbol, options, onChange),
 * so the three call sites are untouched.
 */
function AssetSelectRow({
  asset,
  selected,
  onPick,
}: {
  asset: LendingAsset;
  selected: boolean;
  onPick: () => void;
}) {
  /* Lifted to the token shape useTokenBalance reads, pinned to LENDING_CHAIN_ID
     like BalanceRow — so the figure stays right while the wallet is still on the
     wrong network and the form is saying so. */
  const token: IToken = {
    address: asset.address,
    symbol: asset.symbol,
    name: asset.symbol,
    decimals: asset.decimals,
    chainId: LENDING_CHAIN_ID,
    verified: true,
  };
  const { balance, loading, unread } = useTokenBalance(token);
  const shown =
    loading || unread
      ? null
      : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return (
    <button
      type="button"
      className={`${s.asRow} ${selected ? s.asRowOn : ""}`}
      onClick={onPick}
    >
      <span className={`${s.tki} ${hasTokenIcon(asset.symbol) ? s.tkiArt : ""}`}>
        {hasTokenIcon(asset.symbol) ? (
          <TokenIcon symbol={asset.symbol} size={24} variant="branded" />
        ) : null}
      </span>
      <span className={s.asRowSym}>{asset.symbol}</span>
      <span className={s.asRowBal}>
        {shown === null ? "" : shown}
        {selected ? <span className={s.asRowTick} aria-hidden="true">{"\u2713"}</span> : null}
      </span>
    </button>
  );
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
  const [open, setOpen] = useState(false);
  /* Selected by symbol to match the incoming value, falling back to the first
     option so the trigger always names something once a list has arrived. */
  const selected = options.find((o) => o.symbol === value) ?? options[0];

  return (
    <>
      <button
        type="button"
        className={s.asSel}
        onClick={() => setOpen(true)}
        disabled={options.length === 0}
        aria-haspopup="dialog"
      >
        <span
          className={`${s.tki} ${
            selected && hasTokenIcon(selected.symbol) ? s.tkiArt : ""
          }`}
        >
          {selected && hasTokenIcon(selected.symbol) ? (
            <TokenIcon symbol={selected.symbol} size={20} variant="branded" />
          ) : null}
        </span>
        <span className={s.asSelSym}>{selected?.symbol ?? "Select asset"}</span>
        <span className={s.asSelChev} aria-hidden="true">
          {"\u25be"}
        </span>
      </button>

      {open && (
        <Portal>
          <div
            className={s.overlay}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={s.asSelModal}
              role="dialog"
              aria-modal="true"
              aria-label="Select an asset"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={s.mh}>
                <span className={s.mt}>Select an asset</span>
                <button
                  className={s.mx}
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  {"\u2715"}
                </button>
              </div>
              <div className={s.asList}>
                {options.map((o) => (
                  <AssetSelectRow
                    key={o.address}
                    asset={o}
                    selected={o.symbol === value}
                    onPick={() => {
                      onChange(o.symbol);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
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

/**
 * The chain an action needs, the wallet's chain, and the one button that closes
 * the gap — the CTA becomes a switch, the pattern pool/DepositModal settled.
 *
 * TWO SHAPES, because lending went multi-chain:
 *
 *  - With a `targetChainId` (taking a specific listing): the action MUST happen
 *    on that listing's chain — the diamond that holds it — so `wrong` is "the
 *    wallet is not on that chain" and the button switches to it. This is what
 *    lets a Base listing be taken from a wallet on Sepolia.
 *  - Without one (posting an offer or a request, managing collateral): the
 *    action works on whatever supported chain the wallet is on, so `wrong` is
 *    only "the wallet is on a chain with no lending deployment", and the switch
 *    lands on LENDING_CHAIN_ID as a sensible default. On a supported chain the
 *    button just does its job, on the connected chain, which is the multi-chain
 *    behaviour.
 *
 * DISCONNECTED IS NOT A MISMATCH. With no wallet there is nothing to switch —
 * switchChain would throw and the catch would advise switching a wallet that was
 * never connected. The toast in useBorrowV2 still backs every path, catching a
 * chain changed in the wallet between opening the modal and pressing.
 */
function useLendingChain(targetChainId?: number) {
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const [switching, setSwitching] = useState(false);

  const goTo = targetChainId ?? LENDING_CHAIN_ID;
  const meta = getChainMeta(goTo);
  const target = meta?.shortName ?? meta?.name ?? `chain ${goTo}`;

  const wrong =
    !!account &&
    !!chain &&
    (targetChainId !== undefined
      ? chain.id !== targetChainId
      : !isSupportedChain(chain.id));

  const goToChain = async () => {
    if (!meta) {
      toast.error(`Chain ${goTo} is not in the registry.`);
      return;
    }
    setSwitching(true);
    try {
      await switchChain(defineChain(toThirdwebChainOptions(meta)));
    } catch {
      toast.error(
        `Couldn't switch to ${meta.name} — switch manually in your wallet, then try again.`,
      );
    } finally {
      setSwitching(false);
    }
  };

  return { wrong, switching, goToChain, target };
}

const num = (v: string) => v.replace(/[^0-9.]/g, "");

/**
 * A number as a plain decimal string the amount input will accept back.
 *
 * `String(n)` is wrong here for the two cases that matter: a small balance
 * formats as `1e-7`, and `num()` strips the `e` on the way in, turning a dust
 * amount into `17`. `toLocaleString` is wrong too — it groups with commas,
 * which `num()` also strips, so 20,000 comes back as 20000 only by luck of the
 * separator. Fixed notation, then the trailing zeros off, and only inside the
 * fraction so `100` does not become `1`.
 */
const exact = (n: number, dp = 8) => {
  const s0 = n.toFixed(dp);
  return s0.includes(".") ? s0.replace(/0+$/, "").replace(/\.$/, "") : s0;
};

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
/**
 * The connected wallet's balance of an asset, optionally with a Max.
 *
 * A tester reported the lend form showed no balance on selecting a token - the
 * swap form does, and a form that spends your tokens should say how many you
 * have. The same then applied everywhere an asset is named: borrowing, posting
 * a request, and depositing collateral all show it now.
 *
 * `onMax` IS OPTIONAL, AND ITS ABSENCE IS THE POINT on the borrow forms. What
 * you hold is context there, not a bound - a loan is capped by the offer's own
 * min/max, and a Max chip that filled in your wallet balance would name a
 * number the form is about to reject. Only a form that SPENDS the balance gets
 * the chip.
 *
 * `useTokenBalance` takes an IToken and the lending assets are on a single
 * chain (LENDING_CHAIN_ID), so the LendingAsset is lifted to the token shape
 * the hook reads. It resolves through `providerForChain(token.chainId)` rather
 * than the wallet's chain, so this stays correct while the wallet is still on
 * the wrong network and the page is saying so. `unread` (a dead RPC, or no
 * wallet) shows nothing rather than a zero that would read as an empty wallet.
 */
function BalanceRow({
  asset,
  onMax,
}: {
  asset: LendingAsset | undefined;
  onMax?: (amount: string) => void;
}) {
  const token: IToken | null = asset
    ? {
        address: asset.address,
        symbol: asset.symbol,
        name: asset.symbol,
        decimals: asset.decimals,
        chainId: LENDING_CHAIN_ID,
        verified: true,
      }
    : null;
  const { balance, loading, unread } = useTokenBalance(token);
  if (!asset || loading || unread) return null;
  const shown = Number(balance).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
  return (
    <div className={s.balRow}>
      <span>
        Balance: {shown} {asset.symbol}
      </span>
      {onMax && Number(balance) > 0 && (
        <button
          type="button"
          className={s.maxBtn}
          onClick={() => onMax(balance)}
        >
          Max
        </button>
      )}
    </div>
  );
}

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
  const gate = useLendingChain();

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
        <BalanceRow asset={asset} onMax={setAmount} />
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

      {/* Two actions behind one button — see useLendingChain. `ready` is
          not consulted while the chain is wrong: the amount cannot be
          validated against a market the wallet cannot reach yet, and a
          disabled switch would strand the user exactly where the toast
          used to. */}
      <button
        className={s.cta}
        disabled={gate.switching || busy || (!gate.wrong && !ready)}
        onClick={gate.wrong ? gate.goToChain : submit}
      >
        {gate.switching
          ? "Switching…"
          : gate.wrong
            ? `Switch to ${gate.target}`
            : busy
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
  onNeedCollateral,
  onWithdrawCollateral,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  onDone: () => void;
  /** Open the Collateral (deposit) modal — a request with no collateral
   *  behind it reverts Protocol__InsufficientCollateral, same as a take. */
  onNeedCollateral?: () => void;
  /** Open the Collateral modal on Withdraw, on this asset — the loan token is
   *  the borrower's own collateral, and the diamond won't lend it back. */
  onWithdrawCollateral?: (symbol: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [apr, setApr] = useState("");
  const [days, setDays] = useState(30);
  /* Loanable: a request asks to borrow the asset, and the facet rejects one
     denominated in anything it has not marked `s_isLoanable`. */
  const { loanable } = borrow.assets;
  const { asset, symbol, setSymbol } = useAssetOptions(loanable);
  const [busy, setBusy] = useState(false);
  const gate = useLendingChain();

  /*
   * The facet will not lend you a token you have posted as collateral:
   * createLendingRequest reverts Protocol__CannotBorrowCollateralAsset when
   * `s_addressToCollateralDeposited[msg.sender][token] > 0` (ProtocolFacet.sol:192).
   *
   * A tester hit this on 2026-09-09 by doing the obvious thing — deposit USDC,
   * because USDC is what the faucet gives out, then ask to borrow USDC. The form
   * offered the asset, priced it, enabled the button, and the wallet rejected the
   * transaction with a decoded custom error. Nothing on the way there mentioned
   * the rule.
   *
   * Read off `borrow.collateral`, the deposited balances this modal's sibling
   * already loads from the same diamond, so this costs no extra call. Matched on
   * address: identity is (chain, address), and a symbol match is what let a
   * picker entry and a holding row disagree elsewhere in this file.
   */
  const collateralBlocked = asset
    ? borrow.collateral.some(
        (c) => c.address.toLowerCase() === asset.address.toLowerCase(),
      )
    : false;

  const account = useActiveAccount();
  /* Same rule as taking a listing: createLendingRequest reverts
     Protocol__InsufficientCollateral with nothing posted. Only a fact once
     connected and on a supported chain — collateralValueUsd follows the
     connected chain, and while it is wrong the CTA is Switch. */
  const noCollateral =
    !!account && !gate.wrong && borrow.collateralValueUsd === 0;
  const ready =
    !!asset &&
    !collateralBlocked &&
    !noCollateral &&
    Number(amount) > 0 &&
    Number(apr) > 0;

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
        <BalanceRow asset={asset} />
        {collateralBlocked && (
          <div className={s.warn}>
            You have {symbol} deposited as collateral, so the protocol
            won&apos;t lend it to you — pick a different asset, or withdraw your{" "}
            {symbol} collateral first.
          </div>
        )}
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
      {noCollateral && (
        <div className={s.warn}>
          You have no collateral deposited — a request reverts until you add
          some. Post collateral first; you can then borrow up to 75% of its
          value.
        </div>
      )}
      <LiquidationNote fees={borrow.fees} />

      {/* Two actions behind one button — see useLendingChain. `ready` is
          not consulted while the chain is wrong: the amount cannot be
          validated against a market the wallet cannot reach yet, and a
          disabled switch would strand the user exactly where the toast
          used to. */}
      <button
        className={s.cta}
        disabled={
          gate.switching ||
          busy ||
          (!gate.wrong &&
            !ready &&
            !(noCollateral && onNeedCollateral) &&
            !(collateralBlocked && onWithdrawCollateral))
        }
        onClick={
          gate.wrong
            ? gate.goToChain
            : noCollateral && onNeedCollateral
              ? onNeedCollateral
              : collateralBlocked && onWithdrawCollateral
                ? () => onWithdrawCollateral(symbol)
                : submit
        }
      >
        {gate.switching
          ? "Switching…"
          : gate.wrong
            ? `Switch to ${gate.target}`
            : busy
              ? "Posting…"
              : borrow.assets.loading
                ? "Reading assets…"
                : !asset
                  ? "Nothing borrowable here"
                  : noCollateral
                    ? onNeedCollateral
                      ? "Deposit collateral to borrow"
                      : "Deposit collateral first"
                    : collateralBlocked
                      ? onWithdrawCollateral
                        ? `Withdraw ${symbol} collateral`
                        : `${symbol} is your collateral`
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
  onNeedCollateral,
  onWithdrawCollateral,
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
    /** The chain the listing lives on — the take must run there, so the gate
     *  switches the wallet to it rather than to a fixed lending chain. */
    chainId: number;
    min: number;
    max: number;
    asset: LendingAsset;
  } | null;
  onDone: () => void;
  /** Open the Collateral (deposit) modal — the way out of a zero-
   *  collateral book, where every take reverts Protocol__InsufficientCollateral. */
  onNeedCollateral?: () => void;
  /** Open the Collateral modal on Withdraw, on this asset — the loan token is
   *  the borrower's own collateral, and the diamond won't lend it back. */
  onWithdrawCollateral?: (symbol: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  /* Targeted at the listing's OWN chain: taking it must run on the diamond that
     holds it, so the gate switches the wallet there rather than to a fixed
     lending chain. */
  const gate = useLendingChain(listing?.chainId);
  const account = useActiveAccount();

  useEffect(() => {
    if (open) setAmount("");
  }, [open, listing?.listingId]);

  if (!listing) return null;

  const symbol = listing.asset.symbol;
  const n = Number(amount);
  const tooLow = n > 0 && n < listing.min;
  const tooHigh = n > 0 && n > listing.max;
  /* requestLoanFromListing carries the same collateral rule as
     createLendingRequest (ProtocolFacet.sol:944), and there is no picker here to
     choose past it — the listing is denominated in one thing. So this one can
     only be reported, which is still better than paying gas to learn it. */
  const collateralBlocked = borrow.collateral.some(
    (c) => c.address.toLowerCase() === listing.asset.address.toLowerCase(),
  );
  /* No collateral, no loan. requestLoanFromListing prices the borrow limit
     at 75% of deposited collateral and reverts Protocol__InsufficientCollateral
     when that is zero (ProtocolFacet.sol:957,996) — the "Failed to accept bid!"
     a tester hit with a full wallet but nothing posted. collateralValueUsd
     follows the connected chain, so this is only a fact once the wallet is on
     the listing's chain; while it is not, the CTA is Switch and `ready` is not
     consulted anyway. Gated on `account` because collateralValueUsd is 0 for a
     disconnected wallet too, and that is a connect prompt, not a deposit one. */
  const noCollateral =
    !!account && !gate.wrong && borrow.collateralValueUsd === 0;
  const ready =
    n > 0 && !tooLow && !tooHigh && !collateralBlocked && !noCollateral;

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
        <BalanceRow asset={listing.asset} />
      </div>

      {tooLow && (
        <div className={s.warn}>Below the {fmt(listing.min)} minimum.</div>
      )}
      {tooHigh && (
        <div className={s.warn}>Above the {fmt(listing.max)} maximum.</div>
      )}
      {collateralBlocked && (
        <div className={s.warn}>
          You have {symbol} deposited as collateral, and the protocol won&apos;t
          lend you a token you&apos;re using to back a loan. Withdraw your{" "}
          {symbol} collateral first, or take an offer in a different asset.
        </div>
      )}
      {noCollateral && (
        <div className={s.warn}>
          Borrowing is collateralised — you have none deposited on {gate.target},
          so the protocol has nothing to lend against and the loan reverts. Post
          some collateral first; you can then borrow up to 75% of its value.
        </div>
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

      {/* Two actions behind one button — see useLendingChain. `ready` is
          not consulted while the chain is wrong: the amount cannot be
          validated against a market the wallet cannot reach yet, and a
          disabled switch would strand the user exactly where the toast
          used to. */}
      <button
        className={s.cta}
        disabled={
          gate.switching ||
          busy ||
          (!gate.wrong &&
            !ready &&
            !(noCollateral && onNeedCollateral) &&
            !(collateralBlocked && onWithdrawCollateral))
        }
        onClick={
          gate.wrong
            ? gate.goToChain
            : noCollateral && onNeedCollateral
              ? onNeedCollateral
              : collateralBlocked && onWithdrawCollateral
                ? () => onWithdrawCollateral(symbol)
                : submit
        }
      >
        {gate.switching
          ? "Switching…"
          : gate.wrong
            ? `Switch to ${gate.target}`
            : busy
              ? "Borrowing…"
              : noCollateral
                ? onNeedCollateral
                  ? "Deposit collateral to borrow"
                  : "Deposit collateral first"
                : collateralBlocked
                  ? onWithdrawCollateral
                    ? `Withdraw ${symbol} collateral`
                    : `${symbol} is your collateral`
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
  intent,
}: {
  open: boolean;
  onClose: () => void;
  borrow: BorrowV2;
  onDone: () => void;
  /** Which tab and asset to land on when opened from a CTA — a blocked
   *  borrower arrives on Withdraw, on their collateral token. */
  intent?: CollateralIntent | null;
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

  /* Land where the CTA that opened this asked — Withdraw on the blocked
     token, Deposit for an empty position. Keyed on `intent` identity (each
     opener makes a fresh object) so a fresh open re-applies it while a manual
     switch inside the modal is left alone. */
  useEffect(() => {
    if (!open || !intent) return;
    setMode(intent.mode);
    if (intent.symbol) setSymbol(intent.symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intent]);
  const [busy, setBusy] = useState(false);
  const gate = useLendingChain();

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
        {/* Two figures, and which one you are spending depends on the tab.
            Depositing spends the wallet; withdrawing spends what is already
            posted. Both are shown in both modes, because the one you are not
            acting on is the context for the one you are - you cannot judge a
            deposit without knowing what is already down. Only the one being
            spent carries a Max.

            Until now this box showed "Deposited" in BOTH modes and nothing
            else, so the deposit tab named the one number that has no bearing
            on how much you can deposit. */}
        {mode === "deposit" && <BalanceRow asset={asset} onMax={setAmount} />}
        <div className={s.balRow}>
          <span>
            Deposited:{" "}
            {(held?.amount ?? 0).toLocaleString(undefined, {
              maximumFractionDigits: 6,
            })}{" "}
            {symbol}
          </span>
          {mode === "withdraw" && (held?.amount ?? 0) > 0 && (
            <button
              type="button"
              className={s.maxBtn}
              onClick={() => setAmount(exact(held?.amount ?? 0))}
            >
              Max
            </button>
          )}
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

      {/* Two actions behind one button — see useLendingChain. `ready` is
          not consulted while the chain is wrong: the amount cannot be
          validated against a market the wallet cannot reach yet, and a
          disabled switch would strand the user exactly where the toast
          used to. */}
      <button
        className={s.cta}
        disabled={gate.switching || busy || (!gate.wrong && !ready)}
        onClick={gate.wrong ? gate.goToChain : submit}
      >
        {gate.switching
          ? "Switching…"
          : gate.wrong
            ? `Switch to ${gate.target}`
            : busy
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
