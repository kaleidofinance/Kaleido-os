import type { AgentCard } from "@/lib/v2/cards/types";
import s from "./AgentCards.module.css";

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
}

export default function AgentCards({ cards, onPrompt }: Props) {
  if (!cards.length) return null;

  return (
    <div className={s.wrap}>
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

          case "balance":
            return (
              <div key={i} className={s.card}>
                {card.title && <div className={s.title}>{card.title}</div>}
                <div className={s.rows}>
                  {card.rows.map((row, j) => (
                    <div key={j} className={s.row}>
                      <span className={s.bSymbol}>{row.symbol}</span>
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
                <div className={s.nTitle}>{card.title}</div>
                {card.body && <div className={s.nBody}>{card.body}</div>}
              </div>
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
