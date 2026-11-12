import { useState } from "react";
import type { AgentCard, CardTone } from "@/lib/v2/cards/types";
import { customBuyCommand } from "@/lib/v2/cards/tokenCard";
import TokenIcon from "./TokenIcon";
import s from "./AgentCards.module.css";

/**
 * The token card's "Buy [amount] USDC" field — an exact amount beside the %
 * presets. The amount is validated by customBuyCommand (digits only), and the
 * command it sends takes the same grammar → plan → audit → review → signature
 * path as a preset tap: typing saves a step, it never skips one.
 */
function CustomBuy({
  tokenRef,
  disabled,
  onBuy,
}: {
  tokenRef: string;
  disabled: boolean;
  onBuy?: (command: string) => void;
}) {
  const [value, setValue] = useState("");
  const command = customBuyCommand(tokenRef, value);
  return (
    <form
      className={s.tokCustom}
      onSubmit={(e) => {
        e.preventDefault();
        if (!command || disabled || !onBuy) return;
        onBuy(command);
        setValue("");
      }}
    >
      <label className={s.tokAmountField}>
        <span className={s.tokInputLabel}>Spend amount</span>
        <span className={s.tokAmountRow}>
          <input
            className={`${s.tokAmt} tabular`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            aria-label="USDC amount to spend"
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className={s.tokUnit}>USDC</span>
        </span>
      </label>
      <button
        type="submit"
        className={s.tokSubmit}
        disabled={disabled || !command}
      >
        Review buy
      </button>
    </form>
  );
}

/**
 * The tone glyph a notice carries beside its title.
 *
 * Drawn here as inline SVG rather than pulled from an icon package, the same way
 * ChainIcon and SectionIcon are: four line marks on `currentColor` cost less than
 * a dependency's tree-shaking bet, and inheriting the colour is what lets the
 * tone classes below tint the glyph without the component knowing a palette. It
 * is decoration in the strict sense — `aria-hidden`, because the notice's title
 * already says in words what the mark says in shape, and a screen reader that
 * announced "warning icon" before "warning:" would say it twice.
 */
function ToneIcon({ tone, className }: { tone: CardTone; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (tone) {
    case "good":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      );
    case "warn":
      return (
        <svg {...common}>
          <path d="M12 3.5 2.5 20h19L12 3.5Z" />
          <path d="M12 10v4" />
          <path d="M12 17.4v.01" />
        </svg>
      );
    case "bad":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6" />
          <path d="M9 9l6 6" />
        </svg>
      );
    case "neutral":
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8v.01" />
        </svg>
      );
  }
}

/**
 * The mark on a settled step: a tick for one that ran, a dash for one that
 * needed nothing sent, a cross for one that did not land. Same inline-SVG,
 * `currentColor` treatment as ToneIcon — the colour comes from the status class
 * beside it — and `aria-hidden`, because the detail text already names the
 * outcome in words.
 */
function StepIcon({
  status,
  className,
}: {
  status: "done" | "skipped" | "failed";
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (status === "failed") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6" />
        <path d="M9 9l6 6" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12h7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

function TokenCardView({
  card,
  historical,
  onSend,
  onPrompt,
}: {
  card: Extract<AgentCard, { kind: "token" }>;
  historical?: { at?: number } | boolean;
  onSend?: (command: string) => void;
  onPrompt: (prompt: string) => void;
}) {
  const [currentCard, setCurrentCard] = useState(card);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing || historical) return;
    const ref = currentCard.ref || currentCard.address;
    if (!ref) return;
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/token/card?address=${encodeURIComponent(ref)}&chainId=${(currentCard as any).chainId ?? 99901}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data.card && data.card.kind === "token") {
        setCurrentCard(data.card);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const act = (command: string) =>
    historical ? undefined : () => (onSend ?? onPrompt)(command);

  return (
    <div className={`${s.card} ${s.tokenCard}`}>
      <div className={s.tokHead}>
        <div className={s.tokId}>
          <div className={s.tokSymRow}>
            <button
              type="button"
              className={`${s.tokRefreshBtn} ${refreshing ? s.spinning : ""}`}
              onClick={handleRefresh}
              disabled={refreshing || Boolean(historical)}
              title="Refresh live token price and facts"
              aria-label="Refresh live token price and facts"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>
            <span className={s.tokSym}>{currentCard.symbol}</span>
            {currentCard.name && (
              <span className={s.tokName}>{currentCard.name}</span>
            )}
          </div>
          <div className={`${s.tokAddr} tabular`}>{currentCard.address}</div>
        </div>
        {currentCard.badge && (
          <span className={`${s.tokBadge} ${s[currentCard.badge.tone]}`}>
            {currentCard.badge.iconUrl && (
              <img
                src={currentCard.badge.iconUrl}
                alt=""
                className={s.tokBadgeIcon}
                width={14}
                height={14}
              />
            )}
            <span>{currentCard.badge.text}</span>
          </span>
        )}
      </div>

      {(currentCard.price || currentCard.rows.length > 0) && (
        <div className={s.tokStatsGrid}>
          {currentCard.price && (
            <div className={s.tokStatCol}>
              <span className={s.tokStatLabel}>Price</span>
              <span className={`${s.tokStatVal} tabular`}>{currentCard.price}</span>
            </div>
          )}
          {currentCard.rows.map((row, j) => (
            <div key={j} className={s.tokStatCol}>
              <span className={s.tokStatLabel}>{row.label}</span>
              <span className={`${s.tokStatVal} ${s[row.tone ?? "neutral"]} tabular`}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {currentCard.note && <div className={s.mNote}>{currentCard.note}</div>}

      <div className={s.tokTradeGrid}>
        {currentCard.buys.length > 0 && (
          <div className={s.tokTradeGroup}>
            <div className={s.tokGroupLabel}>
              <span>Buy</span>
              <span>Share of USDC balance</span>
            </div>
            <div className={s.tokPresets}>
              {currentCard.buys.map((b, j) => (
                <button
                  key={j}
                  type="button"
                  className={`${s.chip} ${s.tokBuy}`}
                  aria-label={`Buy with ${b.label} of your USDC`}
                  disabled={Boolean(b.disabled) || Boolean(historical)}
                  onClick={b.disabled ? undefined : act(b.command)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {currentCard.sells.length > 0 && (
          <div className={`${s.tokTradeGroup} ${s.tokSellGroup}`}>
            <div className={s.tokGroupLabel}>
              <span>Sell</span>
              <span>Share of {currentCard.symbol} balance</span>
            </div>
            <div className={s.tokPresets}>
              {currentCard.sells.map((b, j) => (
                <button
                  key={j}
                  type="button"
                  className={`${s.chip} ${s.tokSell}`}
                  aria-label={`Sell ${b.label} of your ${currentCard.symbol}`}
                  disabled={Boolean(historical)}
                  onClick={act(b.command)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {currentCard.ref && currentCard.buys.length > 0 && (
        <CustomBuy
          tokenRef={currentCard.ref}
          disabled={
            Boolean(historical) || currentCard.buys.every((b) => b.disabled)
          }
          onBuy={
            historical
              ? undefined
              : (cmd) => (onSend ?? onPrompt)(cmd)
          }
        />
      )}
    </div>
  );
}

/**
 * Renders the frames Luca uses to present data instead of stating it in prose.
 *
 * Cards render *inside* Luca's turn in the transcript, never as app chrome — so
 * attribution is the turn they sit in, not something the card itself carries.
 * That is load-bearing: a model-emitted card can say anything, exactly as a
 * model-emitted sentence can. What cards add is structured space for the
 * numbers that matter, not verification of the numbers themselves.
 *
 * The one interactive kind, `actions`, prefills the prompt box. That is the
 * whole permitted reach: the worst a hostile card can do is type a visible
 * sentence into a box you then choose to send or not. No card kind can hold a
 * link, call a function, or emit an intent — the frames are display only.
 */

interface Props {
  cards: AgentCard[];
  onPrompt: (text: string) => void;
  /**
   * Sends a command as if typed and submitted. Only the local-only `token`
   * card uses it (its buttons act; see TokenCard). Absent → those buttons fall
   * back to prefilling via `onPrompt`, which is always safe.
   */
  onSend?: (text: string) => void;
  /** Opens a wallet connector — only the local-only `connect` card uses it. */
  onConnect?: (wallet: "agw") => void;
  /** True once the Abstract Global Wallet is connected on Abstract — the
   *  connect card then shows that instead of its button. */
  agwConnected?: boolean;
  /**
   * Set for cards restored from storage — a past turn's data, not a reading of
   * now. Present makes the group dimmed and captioned so a balance from earlier
   * cannot be mistaken for the current one; `at` is when the turn was written.
   */
  historical?: { at?: number };
}

/** "earlier", or a coarse "Nm/Nh/Nd ago", for a restored card group's caption. */
function whenLabel(at?: number): string {
  if (!at) return "from earlier";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "from moments ago";
  if (mins < 60) return `from ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `from ${hrs}h ago`;
  return `from ${Math.round(hrs / 24)}d ago`;
}

export default function AgentCards({
  cards,
  onPrompt,
  onSend,
  onConnect,
  agwConnected,
  historical,
}: Props) {
  if (!cards.length) return null;

  return (
    <div className={historical ? `${s.wrap} ${s.past}` : s.wrap}>
      {historical && (
        <div className={s.pastNote}>Snapshot {whenLabel(historical.at)}</div>
      )}
      {cards.map((card, i) => {
        switch (card.kind) {
          case "metric":
            return (
              <div key={i} className={s.card}>
                <div className={s.mLabel}>{card.label}</div>
                <div className={s.mValue}>
                  <span className="tabular">{card.value}</span>
                  {card.unit && <span className={s.mUnit}>{card.unit}</span>}
                  {card.delta && (
                    <span
                      className={`${s.mDelta} ${s[card.delta.tone]} tabular`}
                    >
                      {card.delta.value}
                    </span>
                  )}
                </div>
                {card.note && <div className={s.mNote}>{card.note}</div>}
              </div>
            );

          case "gauge": {
            /* Percent for the fill width and the meter's value. The card's
               `fraction` is geometry in [0,1]; the value the reader reads is the
               string beside it, not this. */
            const pct = Math.max(0, Math.min(1, card.fraction)) * 100;
            return (
              <div key={i} className={s.card}>
                <div className={s.mLabel}>{card.label}</div>
                <div className={s.mValue}>
                  <span className="tabular">{card.value}</span>
                  {card.unit && <span className={s.mUnit}>{card.unit}</span>}
                </div>
                <div
                  className={s.gauge}
                  role="meter"
                  aria-label={card.label}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  {/* The fill takes its colour from the tone class (which sets
                      `color`) via `background: currentColor` — the same three
                      readings the rest of the card uses, so a bar and a number
                      never disagree about whether a figure is healthy. */}
                  <div
                    className={`${s.gaugeFill} ${s[card.tone]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {(card.min || card.max) && (
                  <div className={s.gaugeEnds}>
                    <span>{card.min ?? ""}</span>
                    <span>{card.max ?? ""}</span>
                  </div>
                )}
                {card.note && <div className={s.mNote}>{card.note}</div>}
              </div>
            );
          }

          case "stats":
            return (
              <div key={i} className={s.card}>
                {card.title && <div className={s.title}>{card.title}</div>}
                <div className={s.rows}>
                  {card.rows.map((row, j) => (
                    <div key={j} className={s.row}>
                      <span className={s.rLabel}>{row.label}</span>
                      <span
                        className={`${s.rValue} ${s[row.tone ?? "neutral"]} tabular`}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );

          case "steps":
            return (
              <div key={i} className={s.card}>
                {card.title && <div className={s.title}>{card.title}</div>}
                <div className={s.rows}>
                  {card.steps.map((st, j) => (
                    <div key={j} className={`${s.row} ${s.stepRow}`}>
                      <StepIcon
                        status={st.status}
                        className={`${s.stepIcon} ${s[`step_${st.status}`]}`}
                      />
                      <span className={s.stepLabel}>{st.label}</span>
                      {st.detail && (
                        <span className={s.stepDetail}>{st.detail}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );

          case "balance":
            return (
              <div key={i} className={s.card}>
                {card.title && <div className={s.title}>{card.title}</div>}
                <div className={s.rows}>
                  {card.rows.map((row, j) => (
                    <div key={j} className={`${s.row} ${s.rowBalance}`}>
                      <span className={s.bSym}>
                        {/* A build-time logo, keyed on the symbol the card
                            already carries — the renderer supplies the art, the
                            card stays pure data. The slot reserves its width even
                            when a token has no logo, so a mixed list still aligns
                            on the symbol beside it. */}
                        <span className={s.bIcon}>
                          <TokenIcon
                            symbol={row.symbol}
                            size={18}
                            fallback={null}
                          />
                        </span>
                        <span className={s.bSymbol}>{row.symbol}</span>
                      </span>
                      <span className={`${s.rValue} tabular`}>
                        {row.amount}
                        {row.note && (
                          <span className={s.bNote}>{row.note}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );

          case "notice":
            return (
              <div key={i} className={`${s.card} ${s.notice} ${s[card.tone]}`}>
                <div className={s.nHead}>
                  <ToneIcon tone={card.tone} className={s.nIcon} />
                  <div className={s.nTitle}>{card.title}</div>
                </div>
                {card.body && <div className={s.nBody}>{card.body}</div>}
              </div>
            );

          case "connect":
            return (
              <div key={i} className={`${s.card} ${s.notice} ${s.neutral}`}>
                <div className={s.nHead}>
                  <ToneIcon tone="neutral" className={s.nIcon} />
                  <div className={s.nTitle}>{card.title}</div>
                </div>
                {card.body && <div className={s.nBody}>{card.body}</div>}
                {/* A restored card is a snapshot; only a live one connects. */}
                {!historical && agwConnected && (
                  <div className={s.tokBtns}>
                    <span className={`${s.chip} ${s.good}`}>✓ Connected</span>
                  </div>
                )}
                {!historical && !agwConnected && onConnect && (
                  <div className={s.tokBtns}>
                    <button
                      type="button"
                      className={`${s.chip} ${s.tokBuy}`}
                      onClick={() => onConnect(card.wallet)}
                    >
                      {card.label}
                    </button>
                  </div>
                )}
              </div>
            );

          case "token":
            return (
              <TokenCardView
                key={i}
                card={card}
                historical={historical}
                onSend={onSend}
                onPrompt={onPrompt}
              />
            );

          case "actions":
            return (
              <div key={i} className={s.card}>
                {card.title && <div className={s.title}>{card.title}</div>}
                <div className={s.actions}>
                  {card.actions.map((action, j) => (
                    <button
                      key={j}
                      type="button"
                      className={s.chip}
                      onClick={() => onPrompt(action.prompt)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}
