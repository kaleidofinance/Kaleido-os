import Image from "next/image";
import s from "./PartnerMarquee.module.css";

interface Partner {
  id: string;
  name: string;
  tag: string;
  badge: string;
  desc: string;
  logoSrc?: string;
  svg?: "circle" | "synthra" | "lifi";
}

const PARTNERS: readonly Partner[] = [
  {
    id: "arc",
    name: "Arc Network",
    tag: "Flagship L1",
    badge: "Native USDC Gas",
    desc: "Circle's institutional stablecoin blockchain with sub-second finality.",
    logoSrc: "/arc-mark.png",
  },
  {
    id: "circle",
    name: "Circle",
    tag: "Circle Alliance",
    badge: "StableFX & CCTP V2",
    desc: "24/7 institutional RFQ stablecoin pricing and native cross-chain minting.",
    svg: "circle",
  },
  {
    id: "tower",
    name: "Tower Exchange",
    tag: "Regional Liquidity",
    badge: "EURC · MXNB · BRLA",
    desc: "DEX liquidity aggregator for local and global stablecoin pairs on Arc.",
    logoSrc: "/tower-favicon.svg",
  },
  {
    id: "synthra",
    name: "Synthra",
    tag: "LaunchPad",
    badge: "SynRoute Execution",
    desc: "Launchpad-native discovery routed seamlessly by Luca on Kaleido.",
    svg: "synthra",
  },
  {
    id: "peach",
    name: "Peach",
    tag: "Arc Launchpad",
    badge: "Instant Trading",
    desc: "Autonomous discovery and execution for tokens launched natively on Arc.",
    logoSrc: "/peach-logo.png",
  },
  {
    id: "lifi",
    name: "LI.FI · KyberSwap",
    tag: "Aggregation",
    badge: "Single-Tx Swaps",
    desc: "Institutional multi-venue liquidity and unified cross-chain routing.",
    svg: "lifi",
  },
];

function PartnerIcon({ p }: { p: Partner }) {
  if (p.logoSrc) {
    return (
      <div className={s.iconWrap}>
        <Image
          src={p.logoSrc}
          alt={p.name}
          width={36}
          height={36}
          className={s.iconImg}
          unoptimized
        />
      </div>
    );
  }

  if (p.svg === "circle") {
    return (
      <div className={`${s.iconWrap} ${s.circleWrap}`}>
        <svg viewBox="0 0 32 32" fill="none" className={s.svgIcon}>
          <circle cx="16" cy="16" r="14" stroke="#00D2FF" strokeWidth="2.5" strokeOpacity="0.4" />
          <path
            d="M16 6C10.4772 6 6 10.4772 6 16C6 21.5228 10.4772 26 16 26C20.5 26 24.3 23 25.5 19H21.5C20.5 21 18.5 22.5 16 22.5C12.4101 22.5 9.5 19.5899 9.5 16C9.5 12.4101 12.4101 9.5 16 9.5C18.5 9.5 20.5 11 21.5 13H25.5C24.3 9 20.5 6 16 6Z"
            fill="#00D2FF"
          />
        </svg>
      </div>
    );
  }

  if (p.svg === "synthra") {
    return (
      <div className={`${s.iconWrap} ${s.synthraWrap}`}>
        <svg viewBox="0 0 32 32" fill="none" className={s.svgIcon}>
          <rect width="32" height="32" rx="8" fill="#180b2a" />
          <path d="M9 23L16 9L23 23H18.5L16 17.5L13.5 23H9Z" fill="#B366FF" />
          <path d="M16 9L23 23H18.5L16 17.5" stroke="#E0B3FF" strokeWidth="1.5" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`${s.iconWrap} ${s.lifiWrap}`}>
      <svg viewBox="0 0 32 32" fill="none" className={s.svgIcon}>
        <rect width="32" height="32" rx="8" fill="#1b1c10" />
        <path d="M8 16L16 8L24 16L16 24L8 16Z" fill="#F0B90B" />
        <circle cx="16" cy="16" r="3.5" fill="#0A1512" />
      </svg>
    </div>
  );
}

export default function PartnerMarquee() {
  return (
    <section className={s.marqueeSection} aria-label="Ecosystem and Strategic Partners">
      <div className={s.plinthHead}>
        <span className={s.archBeacon} aria-hidden="true" />
        <span className={s.eyebrow}>ECOSYSTEM &amp; STRATEGIC PARTNERS</span>
        <h2 className={s.title}>Built with the leaders powering Arc</h2>
        <p className={s.sub}>
          Direct liquidity routing, launchpad discovery, and RFQ pricing from the primary infrastructure on Arc.
        </p>
      </div>

      <div className={s.grid}>
        {PARTNERS.map((p) => (
          <div key={p.id} className={s.partnerCard}>
            <div className={s.cardTop}>
              <PartnerIcon p={p} />
              <div className={s.titleBlock}>
                <div className={s.nameRow}>
                  <span className={s.name}>{p.name}</span>
                  <span className={s.tag}>{p.tag}</span>
                </div>
                <span className={s.badge}>{p.badge}</span>
              </div>
            </div>
            <p className={s.cardDesc}>{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
