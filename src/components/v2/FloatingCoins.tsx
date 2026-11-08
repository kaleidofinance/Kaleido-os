import s from "./FloatingCoins.module.css";

const COINS = [
  ["/USDC.svg", s.coinUsdc],
  ["/eth.svg", s.coinEth],
  ["/tokens/robinhood-chain.svg", s.coinRobinhood],
  ["/usdt.svg", s.coinUsdt],
  ["/newklogo2.png", s.coinKaleido],
  ["/arc-mark.png", s.coinArc],
] as const;

/** Decorative token marks that sit behind every Kaleido surface. */
export default function FloatingCoins() {
  return (
    <div className={s.ambientCoins} aria-hidden="true">
      {COINS.map(([src, className]) => (
        <span key={src} className={`${s.coin} ${className}`}>
          <img src={src} alt="" />
        </span>
      ))}
    </div>
  );
}
