import { LuArrowDownUp, LuLayers, LuLandmark, LuShieldCheck, LuWallet } from "react-icons/lu";
import ChainIcon from "@/components/v2/ChainIcon";
import ThemeToggle from "@/components/v2/ThemeToggle";
import Brand from "../_components/Brand";
import LivePlanner from "../_components/LivePlanner";
import LandingNav from "./LandingNav";
import { appUrl as app, navigationGroups } from "./navigation";
import styles from "./page.module.css";

const networks = [
  { id: "arc", name: "Arc" },
  { id: "elysium", name: "Elysium" },
  { id: "robinhood", name: "Robinhood Chain" },
  { id: "base", name: "Base" },
  { id: "binance-smart-chain", name: "BNB Chain" },
];

const products = [
  {
    title: "Trading",
    description: "Compare swap routes and review the price and minimum received before signing.",
    href: "/trade/swap",
    label: "Open Swap",
    Icon: LuArrowDownUp,
  },
  {
    title: "Lending & borrowing",
    description: "Set your rate and term on a peer-to-peer market, or take an existing offer.",
    href: "/borrow",
    label: "Open Markets",
    Icon: LuLandmark,
  },
  {
    title: "Liquidity",
    description: "Explore pools, choose a price range and manage your liquidity positions.",
    href: "/pool",
    label: "Explore Pools",
    Icon: LuLayers,
  },
];

export default function LandingPage() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={`${styles.container} ${styles.header}`}>
        <Brand href="/" />
        <LandingNav />
        <div className={styles.headerActions}>
          <ThemeToggle />
          <a className={`${styles.button} ${styles.headerButton}`} href={app}>Launch app</a>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroArt} aria-hidden="true" />
          <div className={`${styles.container} ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>Kaleido Finance</p>
              <h1 id="landing-title">Onchain finance,<br /> <em>made clear.</em></h1>
              <p className={styles.heroDescription}>
                Trade, lend and manage liquidity across chains. Tell Luca what you want to do,
                review the plan, and sign from your own wallet.
              </p>
              <div className={styles.actions}>
                <a className={`${styles.button} ${styles.primary}`} href={app}>Launch app</a>
                <a className={styles.secondary} href="#luca">Meet Luca</a>
              </div>
            </div>
          </div>
        </section>

        <div className={`${styles.container} ${styles.networks}`}>
          <p>Supported networks</p>
          <ul>
            {networks.map(({ id, name }) => (
              <li key={id}><ChainIcon id={id} size={21} /> {name}</li>
            ))}
          </ul>
        </div>

        <section id="luca" className={`${styles.container} ${styles.luca}`} aria-labelledby="luca-title">
          <div className={styles.lucaCopy}>
            <p className={styles.kicker}>Meet Luca</p>
            <h2 id="luca-title">From a sentence<br /> to a plan.</h2>
            <p>Describe what you want to do in plain English. Luca turns it into steps you can review before you sign.</p>
            <a className={styles.textLink} href={`${app}/trade/agent`}>Open Luca</a>
          </div>
          <div className={styles.demo}>
            <div className={styles.demoHeader}>
              <span className={styles.lucaMark} aria-hidden="true" />
              <strong>Luca</strong>
              <span className={styles.demoLabel}>Wallet-free preview</span>
            </div>
            <LivePlanner />
          </div>
        </section>

        <section id="products" className={`${styles.container} ${styles.products}`} aria-labelledby="products-title">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>The platform</p>
            <h2 id="products-title">Choose how you put<br /> your assets to work.</h2>
          </div>
          <div className={styles.productGrid}>
            {products.map(({ title, description, label, href, Icon }) => (
              <article key={title}>
                <span className={styles.productIcon}><Icon size={21} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{description}</p>
                <a className={styles.textLink} href={`${app}${href}`}>{label}</a>
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles.container} ${styles.close}`} aria-labelledby="close-title">
          <div className={styles.closeContent}>
            <h2 id="close-title">Your wallet. Your call.</h2>
            <p>See every step before it goes onchain. Your assets stay under your control.</p>
            <ul className={styles.principles}>
              <li><LuWallet aria-hidden="true" /> Non-custodial</li>
              <li><LuShieldCheck aria-hidden="true" /> You approve transactions</li>
            </ul>
            <a className={`${styles.button} ${styles.primary}`} href={app}>Launch app</a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <div className={styles.footerBrand}>
            <Brand href="#top" />
            <p>Onchain markets and an AI agent.</p>
            <small>© {new Date().getUTCFullYear()} Kaleido Finance</small>
          </div>
          <nav className={styles.footerNav} aria-label="Footer navigation">
            {navigationGroups.map(({ title, links }) => (
              <div key={title}>
                <h2 className={styles.footerHeading}>{title}</h2>
                <ul>
                  {links.map(({ label, href }) => (
                    <li key={href}><a href={href}>{label}</a></li>
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
