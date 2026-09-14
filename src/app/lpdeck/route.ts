// Standalone liquidity-partner deck served at /lpdeck.
// A route handler (not a page) so it bypasses the marketing layout and
// theme entirely and renders as its own self-contained document - the
// same markup published as the Claude artifact, now on our own domain.
export const dynamic = "force-static";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Kaleido Liquidity Partnership</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;1,500&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{
    --ink:#0b1411; --panel:#111d18; --panel2:#16241d;
    --sand:#d9c5a2; --sand-dim:#b6a179; --green:#2fd08a;
    --t1:#f4ece0; --t2:#9fb0a6; --t3:#6d7d73;
    --line:rgba(217,197,162,.14); --line2:rgba(217,197,162,.24);
    --serif:'Lora',Georgia,'Times New Roman',serif;
    --sans:'Hanken Grotesk',system-ui,-apple-system,sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
    --wrap:980px;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ink); color:var(--t1);
    font-family:var(--sans); font-size:16px; line-height:1.6;
    -webkit-font-smoothing:antialiased;
    background-image:radial-gradient(rgba(217,197,162,.05) .6px, transparent .9px);
    background-size:5px 5px;
  }
  .wrap{max-width:var(--wrap); margin:0 auto; padding-inline:24px}
  section{padding-block:76px; border-top:1px solid var(--line)}
  section:first-of-type{border-top:0}

  .eyebrow{
    font-family:var(--mono); font-size:12px; letter-spacing:.18em;
    text-transform:uppercase; color:var(--sand-dim); margin:0 0 18px;
  }
  h1,h2,h3{font-family:var(--serif); font-weight:600; text-wrap:balance; margin:0}
  h1{font-size:clamp(2.4rem,1.4rem+3.6vw,4rem); line-height:1.05; letter-spacing:-.01em}
  h2{font-size:clamp(1.7rem,1.2rem+1.8vw,2.5rem); line-height:1.12; letter-spacing:-.01em}
  h3{font-size:1.12rem; font-weight:600}
  p{margin:0; color:var(--t2); max-width:64ch}
  p.lead{font-size:clamp(1.05rem,1rem+.5vw,1.3rem); color:var(--t1); line-height:1.5}
  strong{color:var(--t1); font-weight:600}
  .sand{color:var(--sand)}

  /* cover */
  .cover{padding-block:96px 84px}
  .brand{display:flex; align-items:center; gap:10px; font-family:var(--serif);
    font-size:1.35rem; font-weight:600; letter-spacing:-.01em; margin-bottom:56px}
  .brand b{color:var(--sand)}
  .glyph{width:26px;height:26px;border-radius:7px;
    background:linear-gradient(135deg,var(--sand),var(--green)); flex:none}
  .cover h1{margin-bottom:22px}
  .cover .lead{max-width:40ch}
  .chips{display:flex; flex-wrap:wrap; gap:10px; margin-top:40px}
  .chip{display:inline-flex; align-items:center; gap:8px; font-family:var(--mono);
    font-size:12.5px; letter-spacing:.02em; color:var(--t1);
    padding:8px 14px; border:1px solid var(--line2); border-radius:999px; background:var(--panel)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--green);
    box-shadow:0 0 9px var(--green); flex:none}

  /* generic grids */
  .grid{display:grid; gap:16px; margin-top:36px}
  .g2{grid-template-columns:repeat(2,1fr)}
  .g3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:720px){.g2,.g3{grid-template-columns:1fr}}
  .card{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px}
  .card h3{margin-bottom:8px}
  .card p{font-size:.94rem}
  .num{font-family:var(--mono); font-size:12px; color:var(--sand-dim); letter-spacing:.1em}

  /* stack row */
  .stack{display:flex; flex-wrap:wrap; gap:10px; margin-top:32px}
  .pill{font-family:var(--mono); font-size:13px; color:var(--t1);
    padding:9px 14px; border:1px solid var(--line2); border-radius:8px; background:var(--panel2)}
  .pill b{color:var(--sand); font-weight:500}

  /* pair tables */
  .chaincol{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:24px}
  .chaincol .head{display:flex; align-items:baseline; justify-content:space-between; gap:12px;
    padding-bottom:14px; margin-bottom:8px; border-bottom:1px solid var(--line)}
  .chaincol .head h3{font-size:1.25rem}
  .chaincol .when{font-family:var(--mono); font-size:12px; color:var(--sand-dim)}
  table{width:100%; border-collapse:collapse; font-family:var(--mono); font-size:13.5px}
  td{padding:11px 0; border-bottom:1px solid var(--line); color:var(--t1)}
  tr:last-child td{border-bottom:0}
  td.q{color:var(--t2); text-align:right; white-space:nowrap}
  .quote{color:var(--sand)}
  .foot-note{font-family:var(--mono); font-size:11.5px; color:var(--t3); margin-top:14px}

  /* get list */
  .gets{list-style:none; padding:0; margin:36px 0 0; display:grid; gap:2px}
  .gets li{display:grid; grid-template-columns:180px 1fr; gap:20px;
    padding:18px 0; border-top:1px solid var(--line); align-items:baseline}
  .gets li:first-child{border-top:0}
  .gets .k{font-family:var(--mono); font-size:12.5px; letter-spacing:.04em; color:var(--sand)}
  .gets .v{color:var(--t2); font-size:.96rem}
  @media(max-width:600px){.gets li{grid-template-columns:1fr; gap:4px}}

  /* cta */
  .cta{background:var(--panel2); border:1px solid var(--line2); border-radius:18px;
    padding:44px; text-align:center; margin-top:8px}
  .cta h2{margin-bottom:14px}
  .cta p{margin:0 auto}
  .actions{display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top:28px}
  .btn{font-family:var(--sans); font-weight:600; font-size:15px; text-decoration:none;
    padding:13px 26px; border-radius:999px}
  .btn.primary{background:var(--sand); color:#17130c}
  .btn.ghost{border:1px solid var(--line2); color:var(--t1)}

  footer{border-top:1px solid var(--line); padding-block:32px; color:var(--t3);
    font-family:var(--mono); font-size:12px; display:flex; flex-wrap:wrap; gap:8px 24px; justify-content:space-between}
  footer a{color:var(--sand-dim); text-decoration:none}
  a:focus-visible,.btn:focus-visible{outline:2px solid var(--sand); outline-offset:3px}
  @media(prefers-reduced-motion:no-preference){.card,.btn{transition:border-color .18s ease, transform .18s ease}}
  .card:hover{border-color:var(--line2)}
</style>
</head>
<body>

<section class="cover">
  <div class="wrap">
    <div class="brand"><span class="glyph"></span>Kaleido<b>fi</b></div>
    <p class="eyebrow">Liquidity partnership · 2026</p>
    <h1>We bring the users and the flow.<br>Partner with us for the depth.</h1>
    <p class="lead">Kaleido is an agentic DeFi operating system going live on new mainnets — with a DEX that needs blue-chip depth from day one, and an agent that routes real volume into it.</p>
    <div class="chips">
      <span class="chip"><span class="dot"></span>Live on Robinhood Chain</span>
      <span class="chip">Arc — live Day&nbsp;1, Sep&nbsp;16</span>
      <span class="chip">Full stack across 5 testnets</span>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Why now</p>
    <h2>New mainnets, near-zero incumbent liquidity.</h2>
    <div class="grid g3">
      <div class="card"><span class="num">01</span><h3>First-mover economics</h3><p>Robinhood Chain and Arc launch with almost no on-chain depth. Early LPs set the price of entry and capture fees before the crowd arrives.</p></div>
      <div class="card"><span class="num">02</span><h3>Real flow, day one</h3><p>Kaleido isn't a testnet toy — the full stack (DEX, lending, liquidity, staking, a native stablecoin) is live at genesis, so swaps land in these pools from the first block.</p></div>
      <div class="card"><span class="num">03</span><h3>An agent that routes to depth</h3><p>Luca, our agent, executes user intent in plain English and routes each swap to the pool with the best depth — your liquidity gets the volume.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">What Kaleido is</p>
    <h2>An operating system for onchain finance, driven by one agent.</h2>
    <p class="lead" style="margin-top:20px">You say what you want; Luca prices it, plans it, and you sign it. Non-custodial throughout, and open source — contracts, interface and agent in one public repository.</p>
    <div class="stack">
      <span class="pill"><b>Agent Trade</b></span>
      <span class="pill"><b>V3 DEX</b></span>
      <span class="pill"><b>Lending</b></span>
      <span class="pill"><b>Liquidity</b></span>
      <span class="pill"><b>Staking</b></span>
      <span class="pill"><b>Stables</b> · kfUSD</span>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">The ask</p>
    <h2>Seed blue-chip depth in the core pairs.</h2>
    <p style="margin-top:18px">We're bootstrapping the DEX's core-pair liquidity ahead of a raise. Each chain's pairs use that chain's own canonical assets — the depth has to be where the flow is.</p>
    <div class="grid g2">
      <div class="chaincol">
        <div class="head"><h3>Robinhood Chain</h3><span class="when">chain 4663 · live</span></div>
        <table>
          <tr><td>WETH</td><td class="q"><span class="quote">USDG</span></td></tr>
          <tr><td>ETH</td><td class="q"><span class="quote">USDG</span></td></tr>
          <tr><td>Bridged BTC</td><td class="q"><span class="quote">USDG</span></td></tr>
        </table>
        <p class="foot-note">Quote assets are WETH (0x0bd7…) and USDG, the Global Dollar (0x5fc5…, 6dp) — the canonical pair on Robinhood, not USDC. Bridged-BTC asset to be confirmed.</p>
      </div>
      <div class="chaincol">
        <div class="head"><h3>Arc</h3><span class="when">live Day 1 · Sep 16</span></div>
        <table>
          <tr><td>ETH</td><td class="q"><span class="quote">USDC</span></td></tr>
          <tr><td>Bridged BTC</td><td class="q"><span class="quote">USDC</span></td></tr>
          <tr><td>WUSDC</td><td class="q"><span class="quote">USDC</span></td></tr>
        </table>
        <p class="foot-note">Arc is USDC-native (USDC is the gas token, 18dp); WUSDC (0x911b…) is what pools hold. USDC pairs are the natural core here.</p>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">What partners get</p>
    <h2>Aligned upside, not a fee we can't yet pay.</h2>
    <ul class="gets">
      <li><span class="k">Token allocation</span><span class="v">A KLD allocation on a loan / call-option basis at TGE (late September) — the standard early-stage structure, aligned to the pairs you seed.</span></li>
      <li><span class="k">LP incentives</span><span class="v">KLD emissions plus our live points &amp; leaderboard program directed at the core pairs, on top of native trading fees.</span></li>
      <li><span class="k">Agent-routed volume</span><span class="v">Luca routes user swaps to the deepest pool — depth you provide is depth that earns.</span></li>
      <li><span class="k">Co-marketing</span><span class="v">Named partner in the Day-1 launch across both chains, with the chains' own ecosystem teams co-promoting.</span></li>
      <li><span class="k">First-mover fees</span><span class="v">Fee capture on chains with no incumbent AMM depth, at the entry price you set.</span></li>
    </ul>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Ways to engage</p>
    <h2>Pick the structure that fits your book.</h2>
    <div class="grid g2">
      <div class="card"><h3 class="sand">Liquidity mining</h3><p>Bring blue-chip pairs, earn KLD emissions + points + fees. Fastest to stand up; no principal from us.</p></div>
      <div class="card"><h3 class="sand">Token loan + option</h3><p>For market makers: we lend KLD against two-sided depth in the core pairs; you hold a call option. Activated at TGE.</p></div>
      <div class="card"><h3 class="sand">Managed V3 (LaaS)</h3><p>Run concentrated positions on our V3 pools — Arrakis / Gamma-style — so a smaller balance goes further. Fee or token terms.</p></div>
      <div class="card"><h3 class="sand">Chain co-incentive</h3><p>We're securing matched incentives from the Robinhood and Arc ecosystem funds — your rewards on these pairs can be doubled.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="cta">
      <p class="eyebrow" style="margin-bottom:14px">Let's talk</p>
      <h2>Depth on the 14th, and again on the 16th.</h2>
      <p>Robinhood is live now and Arc is Day 1 on Sep 16 — the earliest liquidity captures the launch. Twenty minutes to scope pairs, size and structure?</p>
      <div class="actions">
        <a class="btn primary" href="mailto:official@kaleidofi.xyz">official@kaleidofi.xyz</a>
        <a class="btn ghost" href="https://kaleidofi.xyz">kaleidofi.xyz</a>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap" style="display:flex; flex-wrap:wrap; gap:8px 24px; justify-content:space-between; width:100%; padding:0 24px; margin:0 auto; max-width:var(--wrap)">
    <span>Kaleido · agentic DeFi OS</span>
    <span>Prepared for prospective liquidity partners. Figures are targets, not historical performance.</span>
  </div>
</footer>

</body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
