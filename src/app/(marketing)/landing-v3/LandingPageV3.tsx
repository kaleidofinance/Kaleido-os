import {
  LuArrowDownUp,
  LuArrowUpRight,
  LuCircleDollarSign,
  LuCode,
  LuCoins,
  LuLandmark,
  LuLayers,
  LuTerminal,
  LuWallet,
} from "react-icons/lu";
import ChainIcon from "@/components/v2/ChainIcon";
import ThemeToggle from "@/components/v2/ThemeToggle";
import Brand from "../_components/Brand";
import { appUrl as app, navigationGroups } from "../landing-v2/navigation";
import LandingNavV3 from "./LandingNavV3";
import LucaActionPreview from "./LucaActionPreview";
import styles from "./page.module.css";

const networks = [
  { id: "arc", name: "Arc" },
  { id: "zero", name: "Zero · Nov 30" },
  { id: "elysium", name: "Elysium" },
  { id: "robinhood", name: "Robinhood Chain" },
  { id: "base", name: "Base" },
  { id: "binance-smart-chain", name: "BNB Chain" },
];

const coreModules = [
  {
    index: "01",
    title: "Trading",
    spec: "Aggregated & V3 routing",
    description:
      "Route across native V3 pools and external aggregators with upfront price impact and guaranteed minimum output.",
    href: "/trade/swap",
    label: "Open Swap",
    Icon: LuArrowDownUp,
  },
  {
    index: "02",
    title: "Lending & Borrowing",
    spec: "Fixed-rate P2P credit",
    description:
      "Publish your own lending terms or borrow directly against collateral at deterministic rates—no variable-curve surprises.",
    href: "/borrow",
    label: "Open Markets",
    Icon: LuLandmark,
  },
  {
    index: "03",
    title: "Liquidity",
    spec: "Concentrated positions",
    description:
      "Deploy capital into custom price ranges, monitor live fee accrual, and rebalance or exit from a single surface.",
    href: "/pool",
    label: "Explore Pools",
    Icon: LuLayers,
  },
];

const utilityModules = [
  {
    title: "Stablecoins",
    description: "Mint, redeem, and deploy stable assets across Kaleido’s yield surfaces.",
    href: "/stable",
    Icon: LuCircleDollarSign,
  },
  {
    title: "Staking",
    description: "Lock KLD to align with protocol governance and long-term participation.",
    href: "/stake",
    Icon: LuCoins,
  },
  {
    title: "Portfolio",
    description: "Track balances, open loans, and LP positions across every connected chain.",
    href: "/portfolio",
    Icon: LuWallet,
  },
];

const lucaSteps = [
  {
    step: "01",
    title: "Intent parsing",
    detail: "Translates swaps, fixed-term loans, LP positions, and cross-chain bridges directly into structured protocol parameters.",
  },
  {
    step: "02",
    title: "Live route & rate discovery",
    detail: "Queries native V3 liquidity, external aggregators, and peer-to-peer credit books simultaneously for optimal pricing.",
  },
  {
    step: "03",
    title: "Deterministic compilation",
    detail: "Assembles exact contract calls, token allowances, and cross-chain settlement paths in one unified flow.",
  },
];

const guarantees = [
  {
    Icon: LuLayers,
    label: "Native V3 & aggregated liquidity",
    detail: "Combines Kaleido’s concentrated pools with external routers for deep, low-impact execution.",
  },
  {
    Icon: LuLandmark,
    label: "Fixed-term P2P credit protocol",
    detail: "Direct lender-to-borrower markets with locked rates, custom durations, and onchain collateral.",
  },
  {
    Icon: LuCode,
    label: "Open & non-custodial rails",
    detail: "Smart contracts, routing logic, and client infrastructure published openly on GitHub.",
  },
];

export default function LandingPageV3() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.headerBar}>
        <div className={`${styles.rail} ${styles.headerInner}`}>
          <div className={styles.brandCell}>
            <Brand href="/" />
          </div>
          <LandingNavV3 />
          <div className={styles.headerActions}>
            <ThemeToggle />
            <a className={`${styles.btn} ${styles.btnHeader}`} href={app}>
              Launch app
              <LuArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* HERO — LUCA AI AGENT FRONT & CENTER */}
        <section className={styles.heroBand} aria-labelledby="v3-hero-title">
          <div className={styles.heroBackdrop} aria-hidden="true" />
          <div className={`${styles.rail} ${styles.heroFrame}`}>
            <div className={styles.heroContent}>
              <div className={styles.statusPill}>
                <span className={styles.statusDot} aria-hidden="true" />
                <span>Luca AI Agent · Multi-Chain DeFi</span>
              </div>

              <h1 id="v3-hero-title" className={styles.heroTitle}>
                Meet Luca, the AI agent
                <br />
                <span className={styles.heroTitleMuted}>for multi-chain DeFi.</span>
              </h1>

              <p className={styles.heroLead}>
                Turn natural language into live swaps, fixed-rate P2P loans,
                concentrated LP positions, and cross-chain bridges across five
                networks—powered by Kaleido’s native V3 liquidity and deterministic
                routing engine.
              </p>

              <div className={styles.heroActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={`${app}/trade/agent`}>
                  <LuTerminal size={15} aria-hidden="true" />
                  Open Luca
                  <LuArrowUpRight size={16} aria-hidden="true" />
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href={`${app}/trade/bridge`}>
                  <ChainIcon id="zero" size={16} />
                  Bridge to Zero
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href={app}>
                  Launch markets
                </a>
              </div>
            </div>

            <div className={styles.datumStrip} aria-label="Protocol specifications">
              <div className={styles.datumCell}>
                <span className={styles.datumKey}>AI Engine</span>
                <span className={styles.datumVal}>Luca Execution Agent</span>
              </div>
              <div className={styles.datumCell}>
                <span className={styles.datumKey}>Capabilities</span>
                <span className={styles.datumVal}>Swap · Lend · LP · Bridge</span>
              </div>
              <div className={styles.datumCell}>
                <span className={styles.datumKey}>Networks</span>
                <span className={styles.datumVal}>5 live + Zero (Nov 30)</span>
              </div>
              <div className={styles.datumCell}>
                <span className={styles.datumKey}>Liquidity</span>
                <span className={styles.datumVal}>
                  <span className={styles.inlineDot} aria-hidden="true" />
                  Native V3 &amp; Aggregated
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SUPPORTED NETWORKS */}
        <section className={styles.band} aria-label="Supported networks">
          <div className={`${styles.rail} ${styles.networksWrap}`}>
            <p className={`${styles.monoLabel} ${styles.networksLabel}`}>Supported networks</p>
            <div className={styles.marqueeViewport}>
              <div className={styles.marqueeTrack}>
                <ul className={styles.marqueeGroup}>
                  {networks.map(({ id, name }) => (
                    <li key={id} className={styles.networkItem}>
                      <ChainIcon id={id} size={20} />
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
                <ul className={styles.marqueeGroup} aria-hidden="true">
                  {networks.map(({ id, name }) => (
                    <li key={`dup-${id}`} className={styles.networkItem}>
                      <ChainIcon id={id} size={20} />
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 01 / LUCA */}
        <section id="luca" className={styles.band} aria-labelledby="v3-luca-title">
          <div className={`${styles.rail} ${styles.sectionPad}`}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIndex}>01 · Luca</span>
              <a className={styles.headerLink} href={`${app}/trade/agent`}>
                Open Luca
                <LuArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>

            <div className={styles.lucaSplit}>
              <div className={styles.lucaInfo}>
                <h2 id="v3-luca-title" className={styles.sectionTitle}>
                  Natural language to
                  <br />
                  multi-chain calldata.
                </h2>
                <p className={styles.sectionDesc}>
                  Luca bridges human intent and onchain protocols—parsing requests
                  locally, quoting native V3 pools and aggregators in real time, and
                  compiling multi-hop execution across chains.
                </p>

                <ol className={styles.stepList}>
                  {lucaSteps.map(({ step, title, detail }) => (
                    <li key={step} className={styles.stepItem}>
                      <span className={styles.stepNum}>{step}</span>
                      <div>
                        <h3>{title}</h3>
                        <p>{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className={styles.chassis}>
                <div className={styles.chassisBar}>
                  <div className={styles.chassisTitle}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span>Luca AI Agent</span>
                  </div>
                  <span className={styles.chassisTag}>Live execution preview</span>
                </div>
                <div className={styles.chassisBody}>
                  <LucaActionPreview />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 / PLATFORM MODULES */}
        <section id="products" className={styles.band} aria-labelledby="v3-products-title">
          <div className={`${styles.rail} ${styles.sectionPad}`}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIndex}>02 · Markets</span>
              <span className={styles.monoLabel}>Direct protocol access</span>
            </div>

            <div className={styles.productsIntro}>
              <h2 id="v3-products-title" className={styles.sectionTitle}>
                Core financial primitives,
                <br />
                engineered as one stack.
              </h2>
              <p className={styles.sectionDesc}>
                Every market shares the same routing engine, liquidity layer, and
                portfolio state—accessible directly or through Luca.
              </p>
            </div>

            <div className={styles.moduleMatrix}>
              {coreModules.map(({ index, title, spec, description, href, label, Icon }) => (
                <article key={index} className={styles.moduleCard}>
                  <div className={styles.moduleTop}>
                    <span className={styles.moduleCode}>{index}</span>
                    <span className={styles.moduleSpec}>{spec}</span>
                  </div>
                  <div className={styles.moduleTitleRow}>
                    <div className={styles.moduleIcon}>
                      <Icon size={19} aria-hidden="true" />
                    </div>
                    <h3>{title}</h3>
                  </div>
                  <p>{description}</p>
                  <a className={styles.moduleLink} href={`${app}${href}`}>
                    {label}
                    <LuArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>

            <div className={styles.utilityRail}>
              {utilityModules.map(({ title, description, href, Icon }) => (
                <a key={title} className={styles.utilityCell} href={`${app}${href}`}>
                  <div className={styles.utilityHead}>
                    <span className={styles.utilityIcon}>
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <strong>{title}</strong>
                    <LuArrowUpRight size={14} className={styles.utilityArrow} aria-hidden="true" />
                  </div>
                  <span>{description}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* 03 / ARCHITECTURE */}
        <section className={styles.band} aria-labelledby="v3-custody-title">
          <div className={`${styles.rail} ${styles.custodyPlate}`}>
            <div className={styles.custodyArt} aria-hidden="true" />

            <div className={styles.custodyBody}>
              <span className={styles.sectionIndex}>03 · Architecture</span>
              <h2 id="v3-custody-title" className={styles.sectionTitle}>
                Built on open rails.
                <br />
                Designed to scale.
              </h2>
              <p className={styles.sectionDesc}>
                From native V3 concentrated liquidity and fixed-term credit contracts
                to real-time AI routing, every layer of Kaleido is built for direct
                onchain composability.
              </p>

              <ul className={styles.guaranteeList}>
                {guarantees.map(({ Icon, label, detail }) => (
                  <li key={label} className={styles.guaranteeItem}>
                    <span className={styles.guaranteeIcon}>
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <div>
                      <span className={styles.guaranteeLabel}>{label}</span>
                      <p>{detail}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className={styles.custodyActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={app}>
                  Launch app
                  <LuArrowUpRight size={16} aria-hidden="true" />
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href="/docs/architecture">
                  Read architecture
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.rail} ${styles.footerInner}`}>
          <div className={styles.footerBrand}>
            <Brand href="#top" />
            <p className={styles.footerTagline}>
              Multi-chain liquidity, P2P credit, and AI-powered onchain execution.
            </p>
            <small className={styles.footerCopy}>
              © {new Date().getUTCFullYear()} Kaleido Finance
            </small>
          </div>
          <nav className={styles.footerNav} aria-label="Footer navigation">
            {navigationGroups.map(({ title, links }) => (
              <div key={title}>
                <h2 className={styles.footerHeading}>{title}</h2>
                <ul>
                  {links.map(({ label, href }) => (
                    <li key={href}>
                      <a href={href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
