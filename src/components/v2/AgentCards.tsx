import type { AgentCard, CardTone } from "@/lib/v2/cards/types";
import TokenIcon from "./TokenIcon";
import s from "./AgentCards.module.css";

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

export default function AgentCards({ cards, onPrompt, onSend, historical }: Props) {
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

          case "token": {
            /* A restored token card is a snapshot: its price and surcharge are
               from then, so its buttons are inert. A live one sends. */
            const act = (command: string) =>
              historical ? undefined : () => (onSend ?? onPrompt)(command);
            return (
              <div key={i} className={s.card}>
                <div className={s.tokHead}>
                  <div className={s.tokId}>
                    <span className={s.tokSym}>{card.symbol}</span>
                    {card.name && <span className={s.tokName}>{card.name}</span>}
                  </div>
                  {card.badge && (
                    <span className={`${s.tokBadge} ${s[card.badge.tone]}`}>
                      {card.badge.text}
                    </span>
                  )}
                </div>
                <div className={`${s.tokAddr} tabular`}>{card.address}</div>
                {card.price && (
                  <div className={s.mValue}>
                    <span className="tabular">{card.price}</span>
                  </div>
                )}
                {card.rows.length > 0 && (
                  /* One header row of labels over one row of values — the
                     facts read across at a glance, like a ticker strip. */
                  <table className={s.tokTable}>
                    <thead>
                      <tr>
                        {card.rows.map((row, j) => (
                          <th key={j} scope="col">
                            {row.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {card.rows.map((row, j) => (
                          <td
                            key={j}
                            className={`${s[row.tone ?? "neutral"]} tabular`}
                          >
                            {row.value}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                )}
                {card.note && <div className={s.mNote}>{card.note}</div>}
                {card.buys.length > 0 && (
                  <div className={s.tokBtns}>
                    <span className={s.tokSide}>Buy</span>
                    {card.buys.map((b, j) => (
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
                )}
                {card.sells.length > 0 && (
                  <div className={s.tokBtns}>
                    <span className={s.tokSide}>Sell</span>
                    {card.sells.map((b, j) => (
                      <button
                        key={j}
                        type="button"
                        className={`${s.chip} ${s.tokSell}`}
                        aria-label={`Sell ${b.label} of your ${card.symbol}`}
                        disabled={Boolean(historical)}
                        onClick={act(b.command)}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

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
