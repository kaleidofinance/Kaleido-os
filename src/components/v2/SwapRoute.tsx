import {
  feeLabel,
  routePath,
  swapRoute,
  type SwapRoute as Route,
} from "@/lib/v2/agentTurn";
import type { Intent } from "@/lib/v2/intents";
import s from "./SwapRoute.module.css";

/**
 * The route a plan's swaps take, drawn above the steps.
 *
 * A swap step already says what it does — "Swap 500 USDC for KLD", "Minimum
 * received 16400 KLD" — and that is a sentence about one transaction. The route
 * is the thing the sentence cannot show: which pool the trade goes through, and,
 * when a plan holds more than one swap, that the legs are one path rather than
 * two trades that happen to be in the same plan.
 *
 * It renders in both places a plan appears — inside the turn that proposed it and
 * inside PlanReview while you sign it — because those are the same plan and the
 * route is a property of it, not of either surface. Both call it with the
 * intents, so neither has to derive anything.
 *
 * Returns null when there is no swap, which is most plans. A route strip over a
 * lending plan would be a heading for nothing.
 */
export default function SwapRoute({ intents }: { intents: Intent[] }) {
  const route = swapRoute(intents);
  if (!route) return null;

  return (
    <div className={s.wrap}>
      <span className={s.label}>Route</span>
      {route.chained ? <Path route={route} /> : <Legs route={route} />}
    </div>
  );
}

/**
 * One path: the tokens in order, with each pool's fee tier between the two
 * tokens it sits between.
 *
 * The amount rides the first token rather than sitting on a line of its own —
 * "500 USDC → KLD" is the trade, and splitting the number off it costs a line to
 * say the same thing twice.
 */
function Path({ route }: { route: Route }) {
  const tokens = routePath(route);
  return (
    <div className={s.body}>
      <div className={s.path}>
        {tokens.map((t, i) => (
          <span key={i} className={s.node}>
            {i > 0 && (
              <span
                className={s.hop}
                title={`${feeLabel(route.hops[i - 1].fee)} pool`}
              >
                <span className={s.arrow} aria-hidden>
                  →
                </span>
                {feeLabel(route.hops[i - 1].fee)}
              </span>
            )}
            <span className={s.token}>
              {i === 0 ? `${route.amountIn} ${t}` : t}
            </span>
          </span>
        ))}
      </div>
      {/* The floor, stated as a floor. It is the argument the router reverts
          below, so "at least" is the literal reading and not a hedge. */}
      <div className={s.meta}>
        At least {route.minOut} {route.symbolOut}
      </div>
    </div>
  );
}

/**
 * Two swaps that are not a path — the model can propose selling two positions in
 * one plan.
 *
 * Each leg gets its own line and there is no summary, because there is no single
 * conversion to summarise: pairing the first leg's input with the last leg's
 * output would state a rate nothing trades at.
 */
function Legs({ route }: { route: Route }) {
  return (
    <div className={s.body}>
      {route.hops.map((h, i) => (
        <div key={i} className={s.path}>
          <span className={s.node}>
            <span className={s.token}>
              {h.amountIn} {h.from}
            </span>
          </span>
          <span className={s.node}>
            <span className={s.hop}>
              <span className={s.arrow} aria-hidden>
                →
              </span>
              {feeLabel(h.fee)}
            </span>
            <span className={s.token}>{h.to}</span>
          </span>
          <span className={s.meta}>at least {h.minOut}</span>
        </div>
      ))}
    </div>
  );
}
