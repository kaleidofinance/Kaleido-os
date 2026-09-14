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

  .cover{padding-block:96px 84px}
  .brand{display:flex; align-items:center; gap:10px; font-family:var(--serif);
    font-size:1.35rem; font-weight:600; letter-spacing:-.01em; margin-bottom:56px}
  .brand b{color:var(--sand)}
  .glyph{width:26px;height:26px;border-radius:7px;
    background:linear-gradient(135deg,var(--sand),var(--green)); flex:none}
  .cover h1{margin-bottom:22px}
  .cover .lead{max-width:46ch}
  .chips{display:flex; flex-wrap:wrap; gap:10px; margin-top:40px}
  .chip{display:inline-flex; align-items:center; gap:8px; font-family:var(--mono);
    font-size:12.5px; letter-spacing:.02em; color:var(--t1);
    padding:8px 14px; border:1px solid var(--line2); border-radius:999px; background:var(--panel)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--green);
    box-shadow:0 0 9px var(--green); flex:none}

  .grid{display:grid; gap:16px; margin-top:36px}
  .g2{grid-template-columns:repeat(2,1fr)}
  .g3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:720px){.g2,.g3{grid-template-columns:1fr}}
  .card{background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px}
  .card h3{margin-bottom:8px}
  .card p{font-size:.94rem}
  .num{font-family:var(--mono); font-size:12px; color:var(--sand-dim); letter-spacing:.1em}

  .stack{display:flex; flex-wrap:wrap; gap:10px; margin-top:32px}
  .pill{font-family:var(--mono); font-size:13px; color:var(--t1);
    padding:9px 14px; border:1px solid var(--line2); border-radius:8px; background:var(--panel2)}
  .pill b{color:var(--sand); font-weight:500}

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
  .foot-note{font-family:var(--mono); font-size:11.5px; color:var(--t3); margin-top:14px; line-height:1.5}
  .ltable{display:flex; flex-direction:column; margin-top:6px}
  .lrow{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid var(--line)}
  .lrow:last-child{border-bottom:0}
  .lhead{font-family:var(--mono); font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--t3); padding:0 0 8px}
  .pair{display:flex; align-items:center; gap:12px; font-family:var(--mono); font-size:13.5px; color:var(--t1)}
  .badges{display:inline-flex; flex:none}
  .tok{width:24px; height:24px; border-radius:50%; border:2px solid var(--panel); background:#fff; display:inline-block; vertical-align:middle; object-fit:cover}
  .tokL{background:var(--c,#888); color:var(--fg,#fff); display:inline-flex; align-items:center; justify-content:center; font-family:var(--sans); font-size:11px; font-weight:700; line-height:1}
  .tok + .tok{margin-left:-8px}
  .amt{font-family:var(--mono); font-size:13.5px; color:var(--sand); font-variant-numeric:tabular-nums; white-space:nowrap}
  .ltotal{border-top:1px solid var(--line2)}
  .ltotal .lbl{font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--t3)}
  .ltotal .amt{color:var(--t1)}

  .gets{list-style:none; padding:0; margin:36px 0 0; display:grid; gap:2px}
  .gets li{display:grid; grid-template-columns:180px 1fr; gap:20px;
    padding:18px 0; border-top:1px solid var(--line); align-items:baseline}
  .gets li:first-child{border-top:0}
  .gets .k{font-family:var(--mono); font-size:12.5px; letter-spacing:.04em; color:var(--sand)}
  .gets .v{color:var(--t2); font-size:.96rem}
  @media(max-width:600px){.gets li{grid-template-columns:1fr; gap:4px}}

  .cta{background:var(--panel2); border:1px solid var(--line2); border-radius:18px;
    padding:44px; text-align:center; margin-top:8px}
  .cta h2{margin-bottom:14px}
  .cta p{margin:0 auto}
  .actions{display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top:28px}
  .btn{font-family:var(--sans); font-weight:600; font-size:15px; text-decoration:none;
    padding:13px 26px; border-radius:999px}
  .btn.primary{background:var(--sand); color:#17130c}
  .btn.ghost{border:1px solid var(--line2); color:var(--t1)}

  footer{border-top:1px solid var(--line); padding-block:32px}
  .footrow{max-width:var(--wrap); margin:0 auto; padding-inline:24px; color:var(--t3);
    font-family:var(--mono); font-size:12px; display:flex; flex-wrap:wrap; gap:8px 24px; justify-content:space-between}
  a:focus-visible,.btn:focus-visible{outline:2px solid var(--sand); outline-offset:3px}
  @media(prefers-reduced-motion:no-preference){.card,.btn{transition:border-color .18s ease}}
  .card:hover{border-color:var(--line2)}
</style>
</head>
<body>

<section class="cover">
  <div class="wrap">
    <div class="brand"><span class="glyph"></span>Kaleido<b>fi</b></div>
    <p class="eyebrow">Liquidity partnership · 2026</p>
    <h1>We bring the users and the flow. Partner with us for the depth.</h1>
    <p class="lead">Kaleido is an agentic DeFi operating system launching across new mainnets, starting with Arc on day one. The DEX needs blue-chip depth from the first block, and our agent routes real volume straight into it.</p>
    <div class="chips">
      <span class="chip"><span class="dot"></span>Arc: live day one, Sep 16</span>
      <span class="chip">Robinhood Chain: agentic layer</span>
      <span class="chip">Full stack across 5 testnets</span>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Why now</p>
    <h2>The window is the launch itself.</h2>
    <div class="grid g3">
      <div class="card"><span class="num">01</span><h3>First-mover on Arc</h3><p>Arc opens Sep 16 with no incumbent AMM depth. The earliest LPs set the entry price and capture fees before the crowd, right as Uniswap arrives on the same day.</p></div>
      <div class="card"><span class="num">02</span><h3>Real flow, day one</h3><p>Kaleido ships the full stack at genesis: DEX, lending, liquidity, staking, and a native stablecoin. Swaps land in these pools immediately, not after a growth phase.</p></div>
      <div class="card"><span class="num">03</span><h3>An agent that routes to depth</h3><p>Luca executes user intent in plain English and sends each swap to the deepest pool. The depth you provide is the depth that earns.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">What Kaleido is</p>
    <h2>An operating system for onchain finance, driven by one agent.</h2>
    <p class="lead" style="margin-top:20px">You say what you want; Luca prices it, plans it, and hands it back for you to sign. Non-custodial throughout, and open source: contracts, interface and agent in one public repository.</p>
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
    <p style="margin-top:18px">We are bootstrapping the DEX's core-pair liquidity ahead of a raise. Each chain's pairs use that chain's own canonical assets, and the target is the concentrated V3 depth we are looking for on each.</p>
    <div class="grid g2">
      <div class="chaincol">
        <div class="head"><h3>Arc</h3><span class="when">greenfield &middot; Sep 16</span></div>
        <div class="ltable">
          <div class="lrow lhead"><span>Pair</span><span>Target</span></div>
          <div class="lrow"><span class="pair"><span class="badges"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiNGNzkzMUEiIGQ9Ik0xOC43NjMgMTAuMjM2Yy4yOC0xLjg5NS0xLjE1NS0yLjkwNS0zLjEzMS0zLjU5MWwuNjQtMi41NTMtMS41Ni0uMzg5LS42MjMgMi40OS0xLjI0NS0uMjk3LjYzMS0yLjUwOEwxMS45MTUgM2wtLjY0MSAyLjU2Mi0uOTkyLS4yMzR2LS4wMWwtMi4xNTctLjU0LS40MTUgMS42NjhzMS4xNTUuMjcyIDEuMTM3LjI4Yy42MzEuMTYzLjc0LjU3OC43MjIuOTAzbC0uNzIyIDIuOTIzLjE2Mi4wNTQtLjE3MS0uMDM2LTEuMDIgNC4wODdjLS4wNzIuMTktLjI3LjQ3OC0uNzEyLjM2LjAxOC4wMjgtMS4xMjgtLjI3LTEuMTI4LS4yN2wtLjc3NiAxLjc3OCAyLjAzLjUwNSAxLjExLjI4OS0uNjUgMi41OSAxLjU2LjM4Ny42MzMtMi41NjIgMS4yNTMuMzI0LS42NCAyLjU1NCAxLjU2LjM4OC42NDEtMi41OWMyLjY2Mi41MDUgNC42NjUuMzA4IDUuNTA1LTIuMTAyLjY3Ni0xLjk0LS4wMzctMy4wNS0xLjQzNS0zLjc5IDEuMDItLjIyNSAxLjc4Ni0uOTAyIDEuOTg1LTIuMjgyem0tMy41NjQgNC45OTljLS40NzkgMS45NC0zLjc0NS44ODQtNC44LjYzbC44NTctMy40MzZjMS4wNTUuMjcgNC40NDguNzg0IDMuOTQzIDIuNzk2em0uNDc4LTUuMDI2Yy0uNDMzIDEuNzYtMy4xNTguODY2LTQuMDMzLjY1bC43NzUtMy4xMTNjLjg4NS4yMTcgMy43MTguNjMyIDMuMjU4IDIuNDYzIi8+Cjwvc3ZnPgo=" alt="cirBTC" title="cirBTC"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiMwQjUzQkYiIGQ9Ik0xMiAyMWE5IDkgMCAxIDAgMC0xOCA5IDkgMCAwIDAgMCAxOCIvPgogICAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEzLjYyIDUuNDV2MS4xNTlhNS42NCA1LjY0IDAgMCAxIDQuMDA1IDUuMzk0IDUuNjQgNS42NCAwIDAgMS00LjAwNSA1LjM5NHYxLjE2YTYuNzQgNi43NCAwIDAgMCA1LjEzLTYuNTU0IDYuNzQgNi43NCAwIDAgMC01LjEzLTYuNTUzbS03LjI0NSA2LjU1M2E1LjY0IDUuNjQgMCAwIDEgNC4wMDUtNS4zOTRWNS40NWE2Ljc0IDYuNzQgMCAwIDAtNS4xMyA2LjU1MyA2Ljc0IDYuNzQgMCAwIDAgNS4xMyA2LjU1M3YtMS4xNTlhNS42MyA1LjYzIDAgMCAxLTQuMDA1LTUuMzk0Ii8+CiAgICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTQuNDE5IDEzLjI1OGMwLTIuMzAxLTMuNjA2LTEuMzU2LTMuNjA2LTIuNjI3IDAtLjQ1Ni4zNjYtLjc0OCAxLjA2My0uNzQ4LjgzMyAwIDEuMTIuNDA1IDEuMjEuOTVoMS4xNDdjLS4xMDItMS4wMjQtLjY5LTEuNjctMS42Ny0xLjg2M3YtLjkwNGgtMS4xMjV2Ljg3MmMtMS4wNzUuMTM3LTEuNzUuNzYyLTEuNzUgMS42OTMgMCAyLjMxMiAzLjYxMSAxLjQ0NSAzLjYxMSAyLjY5NCAwIC40NzItLjQ1NS43ODctMS4yMjYuNzg3LTEuMDA3IDAtMS4zMzktLjQ0NC0xLjQ2Mi0xLjA1N0g5LjQ5Yy4wNzMgMS4xMjIuNzY0IDEuODIzIDEuOTQ3IDEuOTk5di44ODZoMS4xMjV2LS44NzVjMS4xNTMtLjE0OSAxLjg1Ni0uODIgMS44NTYtMS44MDciLz4KPC9zdmc+Cg==" alt="USDC" title="USDC"></span>cirBTC / USDC</span><span class="amt">$500k</span></div>
          <div class="lrow"><span class="pair"><span class="badges"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiMwQjUzQkYiIGQ9Ik0xMiAyMWE5IDkgMCAxIDAgMC0xOCA5IDkgMCAwIDAgMCAxOCIvPgogICAgPHBhdGggZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjMEI1M0JGIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS13aWR0aD0iLjAzIiBkPSJNMTMuOTEzIDE0LjE0M2EzLjQgMy40IDAgMCAxLTEuMjMyLjI0OGMtLjgxNCAwLTEuNTgtLjM0Ny0xLjk0Ny0xLjE4MWgxLjc5bC4zNDgtLjg0NGgtMi4zNDZhNCA0IDAgMCAxIDAtLjczMmgyLjY0NGwuMzQ5LS44NDNoLTIuNzg1Yy4zNjctLjgzNSAxLjEzMy0xLjE4MiAxLjk0Ny0xLjE4Mi40MSAwIC44MzguMDkgMS4yMzIuMjQ4bC4zNi0uODU1YTMuNCAzLjQgMCAwIDAtMS41NzUtLjM3N2MtMS4zMTcgMC0yLjY0OS43MzYtMy4xMyAyLjE2NmgtLjg2NHYuODQzaC42OWE0IDQgMCAwIDAgMCAuNzMyaC0uNjl2Ljg0NGguODYzYy40ODIgMS40MjkgMS44MTQgMi4xNjUgMy4xMyAyLjE2NWEzLjQgMy40IDAgMCAwIDEuNTc2LS4zNzd6Ii8+CiAgICA8cGF0aCBmaWxsPSIjZmZmIiBzdHJva2U9IiMwQjUzQkYiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLXdpZHRoPSIuMDMiIGQ9Ik02LjM3NSAxMmE1LjY0IDUuNjQgMCAwIDEgNC4wMDUtNS4zOTR2LTEuMTZBNi43NCA2Ljc0IDAgMCAwIDUuMjUgMTJhNi43NCA2Ljc0IDAgMCAwIDUuMTMgNi41NTN2LTEuMTU5QTUuNjMgNS42MyAwIDAgMSA2LjM3NSAxMlptNy4yNDUtNi41NTN2MS4xNTlBNS42NCA1LjY0IDAgMCAxIDE3LjYyNSAxMmE1LjY0IDUuNjQgMCAwIDEtNC4wMDUgNS4zOTR2MS4xNkE2Ljc0IDYuNzQgMCAwIDAgMTguNzUgMTJhNi43NCA2Ljc0IDAgMCAwLTUuMTMtNi41NTNaIi8+Cjwvc3ZnPgo=" alt="EURC" title="EURC"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiMwQjUzQkYiIGQ9Ik0xMiAyMWE5IDkgMCAxIDAgMC0xOCA5IDkgMCAwIDAgMCAxOCIvPgogICAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEzLjYyIDUuNDV2MS4xNTlhNS42NCA1LjY0IDAgMCAxIDQuMDA1IDUuMzk0IDUuNjQgNS42NCAwIDAgMS00LjAwNSA1LjM5NHYxLjE2YTYuNzQgNi43NCAwIDAgMCA1LjEzLTYuNTU0IDYuNzQgNi43NCAwIDAgMC01LjEzLTYuNTUzbS03LjI0NSA2LjU1M2E1LjY0IDUuNjQgMCAwIDEgNC4wMDUtNS4zOTRWNS40NWE2Ljc0IDYuNzQgMCAwIDAtNS4xMyA2LjU1MyA2Ljc0IDYuNzQgMCAwIDAgNS4xMyA2LjU1M3YtMS4xNTlhNS42MyA1LjYzIDAgMCAxLTQuMDA1LTUuMzk0Ii8+CiAgICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTQuNDE5IDEzLjI1OGMwLTIuMzAxLTMuNjA2LTEuMzU2LTMuNjA2LTIuNjI3IDAtLjQ1Ni4zNjYtLjc0OCAxLjA2My0uNzQ4LjgzMyAwIDEuMTIuNDA1IDEuMjEuOTVoMS4xNDdjLS4xMDItMS4wMjQtLjY5LTEuNjctMS42Ny0xLjg2M3YtLjkwNGgtMS4xMjV2Ljg3MmMtMS4wNzUuMTM3LTEuNzUuNzYyLTEuNzUgMS42OTMgMCAyLjMxMiAzLjYxMSAxLjQ0NSAzLjYxMSAyLjY5NCAwIC40NzItLjQ1NS43ODctMS4yMjYuNzg3LTEuMDA3IDAtMS4zMzktLjQ0NC0xLjQ2Mi0xLjA1N0g5LjQ5Yy4wNzMgMS4xMjIuNzY0IDEuODIzIDEuOTQ3IDEuOTk5di44ODZoMS4xMjV2LS44NzVjMS4xNTMtLjE0OSAxLjg1Ni0uODIgMS44NTYtMS44MDciLz4KPC9zdmc+Cg==" alt="USDC" title="USDC"></span>EURC / USDC</span><span class="amt">$150k</span></div>
          <div class="lrow"><span class="pair"><span class="badges"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiMwQjUzQkYiIGQ9Ik0xMiAyMWE5IDkgMCAxIDAgMC0xOCA5IDkgMCAwIDAgMCAxOCIvPgogICAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEzLjYyIDUuNDV2MS4xNTlhNS42NCA1LjY0IDAgMCAxIDQuMDA1IDUuMzk0IDUuNjQgNS42NCAwIDAgMS00LjAwNSA1LjM5NHYxLjE2YTYuNzQgNi43NCAwIDAgMCA1LjEzLTYuNTU0IDYuNzQgNi43NCAwIDAgMC01LjEzLTYuNTUzbS03LjI0NSA2LjU1M2E1LjY0IDUuNjQgMCAwIDEgNC4wMDUtNS4zOTRWNS40NWE2Ljc0IDYuNzQgMCAwIDAtNS4xMyA2LjU1MyA2Ljc0IDYuNzQgMCAwIDAgNS4xMyA2LjU1M3YtMS4xNTlhNS42MyA1LjYzIDAgMCAxLTQuMDA1LTUuMzk0Ii8+CiAgICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTQuNDE5IDEzLjI1OGMwLTIuMzAxLTMuNjA2LTEuMzU2LTMuNjA2LTIuNjI3IDAtLjQ1Ni4zNjYtLjc0OCAxLjA2My0uNzQ4LjgzMyAwIDEuMTIuNDA1IDEuMjEuOTVoMS4xNDdjLS4xMDItMS4wMjQtLjY5LTEuNjctMS42Ny0xLjg2M3YtLjkwNGgtMS4xMjV2Ljg3MmMtMS4wNzUuMTM3LTEuNzUuNzYyLTEuNzUgMS42OTMgMCAyLjMxMiAzLjYxMSAxLjQ0NSAzLjYxMSAyLjY5NCAwIC40NzItLjQ1NS43ODctMS4yMjYuNzg3LTEuMDA3IDAtMS4zMzktLjQ0NC0xLjQ2Mi0xLjA1N0g5LjQ5Yy4wNzMgMS4xMjIuNzY0IDEuODIzIDEuOTQ3IDEuOTk5di44ODZoMS4xMjV2LS44NzVjMS4xNTMtLjE0OSAxLjg1Ni0uODIgMS44NTYtMS44MDciLz4KPC9zdmc+Cg==" alt="USDC" title="USDC"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiMwQjUzQkYiIGQ9Ik0xMiAyMWE5IDkgMCAxIDAgMC0xOCA5IDkgMCAwIDAgMCAxOCIvPgogICAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEzLjYyIDUuNDV2MS4xNTlhNS42NCA1LjY0IDAgMCAxIDQuMDA1IDUuMzk0IDUuNjQgNS42NCAwIDAgMS00LjAwNSA1LjM5NHYxLjE2YTYuNzQgNi43NCAwIDAgMCA1LjEzLTYuNTU0IDYuNzQgNi43NCAwIDAgMC01LjEzLTYuNTUzbS03LjI0NSA2LjU1M2E1LjY0IDUuNjQgMCAwIDEgNC4wMDUtNS4zOTRWNS40NWE2Ljc0IDYuNzQgMCAwIDAtNS4xMyA2LjU1MyA2Ljc0IDYuNzQgMCAwIDAgNS4xMyA2LjU1M3YtMS4xNTlhNS42MyA1LjYzIDAgMCAxLTQuMDA1LTUuMzk0Ii8+CiAgICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTQuNDE5IDEzLjI1OGMwLTIuMzAxLTMuNjA2LTEuMzU2LTMuNjA2LTIuNjI3IDAtLjQ1Ni4zNjYtLjc0OCAxLjA2My0uNzQ4LjgzMyAwIDEuMTIuNDA1IDEuMjEuOTVoMS4xNDdjLS4xMDItMS4wMjQtLjY5LTEuNjctMS42Ny0xLjg2M3YtLjkwNGgtMS4xMjV2Ljg3MmMtMS4wNzUuMTM3LTEuNzUuNzYyLTEuNzUgMS42OTMgMCAyLjMxMiAzLjYxMSAxLjQ0NSAzLjYxMSAyLjY5NCAwIC40NzItLjQ1NS43ODctMS4yMjYuNzg3LTEuMDA3IDAtMS4zMzktLjQ0NC0xLjQ2Mi0xLjA1N0g5LjQ5Yy4wNzMgMS4xMjIuNzY0IDEuODIzIDEuOTQ3IDEuOTk5di44ODZoMS4xMjV2LS44NzVjMS4xNTMtLjE0OSAxLjg1Ni0uODIgMS44NTYtMS44MDciLz4KPC9zdmc+Cg==" alt="USDC" title="USDC"></span>WUSDC / USDC</span><span class="amt">$100k</span></div>
          <div class="lrow ltotal"><span class="lbl">Target total</span><span class="amt">~$750k</span></div>
        </div>
        <p class="foot-note">USDC-native chain (USDC is the gas token). cirBTC and EURC are Circle's canonical assets on Arc; WUSDC is the wrapped native. No incumbent depth at launch, so these are first-mover pairs. Priority chain.</p>
      </div>
      <div class="chaincol">
        <div class="head"><h3>Robinhood Chain</h3><span class="when">established</span></div>
        <div class="ltable">
          <div class="lrow lhead"><span>Pair</span><span>Target</span></div>
          <div class="lrow"><span class="pair"><span class="badges"><img class="tok" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj4KICAgIDxwYXRoIGZpbGw9IiM4RkZDRjMiIGQ9Ik0xMiAzdjYuNjVsNS42MjUgMi41MTZ6Ii8+CiAgICA8cGF0aCBmaWxsPSIjQ0FCQ0Y4IiBkPSJtMTIgMy01LjYyNSA5LjE2NkwxMiA5LjY1MXoiLz4KICAgIDxwYXRoIGZpbGw9IiNDQkE3RjUiIGQ9Ik0xMiAxNi40Nzd2NC41MjJsNS42MjUtNy43ODR6Ii8+CiAgICA8cGF0aCBmaWxsPSIjNzRBMEYzIiBkPSJNMTIgMjF2LTQuNTIzbC01LjYyNS0zLjI2MnoiLz4KICAgIDxwYXRoIGZpbGw9IiNDQkE3RjUiIGQ9Im0xMiAxNS40MyA1LjYyNS0zLjI2M0wxMiA5LjY1eiIvPgogICAgPHBhdGggZmlsbD0iIzc0QTBGMyIgZD0iTTYuMzc1IDEyLjE2NyAxMiAxNS40MjlWOS42NTF6Ii8+CiAgICA8cGF0aCBmaWxsPSIjMjAyNjk5IiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Im0xMiAxNS40MjktNS42MjUtMy4yNjNMMTIgM2w1LjYyNSA5LjE2NnpNNi43NDkgMTEuOWw1LjE2LTguNDF2Ni4xMTV6bS0uMDc3LjIzIDUuMjM4LTIuMzI3djUuMzY0em01LjQxOC0yLjMyN3Y1LjM2NGw1LjIzMy0zLjAzOHptMC0uMTk4IDUuMTYgMi4yOTUtNS4xNi04LjQxeiIgY2xpcC1ydWxlPSJldmVub2RkIi8+CiAgICA8cGF0aCBmaWxsPSIjMjAyNjk5IiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMiAxNi40MDYgNi4zNzUgMTMuMjEgMTIgMjFsNS42MjUtNy43OXptLTQuOTk1LTIuNjMzIDQuOTA1IDIuNzl2NC4wMDV6bTUuMDg1IDIuNzl2NC4wMDVsNC45MDUtNi43OTV6IiBjbGlwLXJ1bGU9ImV2ZW5vZGQiLz4KPC9zdmc+Cg==" alt="WETH" title="WETH"><span class="tok tokL" style="--c:#16a34a" title="USDG">$</span></span>WETH / USDG</span><span class="amt">$350k</span></div>
          <div class="lrow"><span class="pair"><span class="badges"><img class="tok" src="data:image/png;base64,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" alt="Robinhood token" title="Robinhood token"><span class="tok tokL" style="--c:#16a34a" title="USDG">$</span></span>Equity tokens / USDG</span><span class="amt">$150k</span></div>
          <div class="lrow ltotal"><span class="lbl">Target total</span><span class="amt">~$500k</span></div>
        </div>
        <p class="foot-note">USDG (Global Dollar) is the chain's mainnet stable. WETH/USDG is already deep on incumbents, so our targets add routing depth and the Robinhood-native equity tokens (AAPL, TSLA, NVDA and more), not a head-on fight for WETH/USDG.</p>
      </div>
    </div>
    <p class="foot-note" style="margin-top:18px">All figures are concentrated V3 depth and scale to your book. A partner can take a single pair or a full chain.</p>
  </section>

<section>
  <div class="wrap">
    <p class="eyebrow">What partners get</p>
    <h2>Aligned upside, not a fee we cannot yet pay.</h2>
    <ul class="gets">
      <li><span class="k">Token allocation</span><span class="v">A KLD allocation on a loan or call-option basis at TGE (late September), aligned to the pairs you seed.</span></li>
      <li><span class="k">LP incentives</span><span class="v">KLD emissions plus our live points and leaderboard program directed at the core pairs, on top of native trading fees.</span></li>
      <li><span class="k">Agent-routed volume</span><span class="v">Luca routes user swaps to the deepest pool. Depth you provide is depth that earns.</span></li>
      <li><span class="k">Co-marketing</span><span class="v">Named partner in the launch across both chains, with the chains' own ecosystem teams co-promoting.</span></li>
      <li><span class="k">First-mover fees</span><span class="v">On Arc, fee capture on a chain with no incumbent AMM depth, at the entry price you set.</span></li>
    </ul>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Ways to engage</p>
    <h2>Pick the structure that fits your book.</h2>
    <div class="grid g2">
      <div class="card"><h3 class="sand">Liquidity mining</h3><p>Bring blue-chip pairs, earn KLD emissions, points and fees. Fastest to stand up; no principal from us.</p></div>
      <div class="card"><h3 class="sand">Token loan + option</h3><p>For market makers: we lend KLD against two-sided depth in the core pairs; you hold a call option. Activated at TGE.</p></div>
      <div class="card"><h3 class="sand">Managed V3 (LaaS)</h3><p>Run concentrated positions on our V3 pools (Arrakis or Gamma style) so a smaller balance goes further. Fee or token terms.</p></div>
      <div class="card"><h3 class="sand">Chain co-incentive</h3><p>We are securing matched incentives from the Arc and Robinhood ecosystem funds, so your rewards on these pairs can be doubled.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="cta">
      <p class="eyebrow" style="margin-bottom:14px">Let's talk</p>
      <h2>Depth on Arc for Sep 16.</h2>
      <p>Arc goes live day one on Sep 16, and the earliest liquidity captures the launch. Twenty minutes to scope pairs, size and structure?</p>
      <div class="actions">
        <a class="btn primary" href="mailto:official@kaleidofi.xyz">official@kaleidofi.xyz</a>
        <a class="btn ghost" href="https://kaleidofi.xyz">kaleidofi.xyz</a>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="footrow">
    <span>Kaleido · agentic DeFi OS</span>
    <span>Prepared for prospective liquidity partners. Figures are targets, not historical performance.</span>
  </div>
</footer>

</body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
