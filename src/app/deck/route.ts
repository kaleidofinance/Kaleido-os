/**
 * kaleidofi.xyz/deck — the public pitch deck, published from the Kaleido Slides
 * artifact (12 slides, speaker notes stripped). Static: images in public/deck.
 */
export const dynamic = "force-static";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kaleido — Agentic DeFi on Arc</title>
<meta name="description" content="Kaleido pitch deck: an AI agent that turns plain-language requests into audited on-chain transactions, live on Arc mainnet.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kaleido">
<meta property="og:title" content="Kaleido — Agentic DeFi on Arc">
<meta property="og:description" content="Say what you want, and Luca does it on-chain. Live on Arc mainnet.">
<meta property="og:url" content="https://kaleidofi.xyz/deck">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400..700&family=DM+Sans:wght@400..700&display=swap">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;background:#0b0b0a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .deck{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 16px 48px}
  .frame{width:min(100%,1280px);aspect-ratio:16/9;position:relative;overflow:hidden;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
  .slide{position:absolute;top:0;left:0;width:1920px;height:1080px;transform-origin:0 0;transform:scale(var(--s,0.6667))}
  .slide>section{position:relative;width:1920px;height:1080px;overflow:hidden;box-sizing:border-box}
  .slide h1,.slide h2,.slide h3,.slide p,.slide table{margin:0}
  .slide table{border-collapse:collapse}
  .slide th,.slide td{padding:.35em .6em;border-bottom:1px solid rgba(20,20,19,.15);text-align:left}
  .slide th{font-weight:700}
  .slide img{display:block;object-fit:cover}
  @media print{.deck{gap:0;padding:0}.frame{width:1920px;border-radius:0;box-shadow:none;break-after:page}.slide{transform:none}}
</style>
</head>
<body>
<main class="deck">
<div class="frame"><div class="slide"><section id="cover" style="background:radial-gradient(circle at 80% 20%, #0f3a2b 0%, #141413 55%)">
  <p id="e2-1ftwghs" style="position:absolute; bottom:64px; left:128px; width:1200px; font-family:'DM Sans', Arial, sans-serif; font-size:28px; color:#a8a49b">kaleidofi.xyz · mac@kaleidofi.xyz</p>
  <div id="c8f37627" style="clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);position:absolute; top:0; left:calc(50% + 414.33px); width:835.37px; height:699.37px; background:#141413; opacity:0.39; transform:translateX(-50%); filter:blur(4px)"></div>
  <div id="445bd3ee" style="clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);position:absolute; top:277.43px; left:calc(50% + 597.45px); width:835.37px; height:699.37px; background:#141413; opacity:0.39; transform:translateX(-50%); filter:blur(4px)"></div>
  <div id="4311b36d" style="clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);position:absolute; top:699.36px; left:calc(50% + 218.96px); width:835.37px; height:699.37px; background:#141413; opacity:0.39; transform:translateX(-50%); filter:blur(4px)"></div>
  <div id="28084e6f" style="clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);position:absolute; top:220.31px; left:calc(50% - 232.01px); width:835.37px; height:699.37px; background:#141413; opacity:0.39; transform:translateX(-50%); filter:blur(4px)"></div>
  <div id="b394f91a" style="clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);position:absolute; top:56.16px; left:calc(50% + 1201.24px); width:835.37px; height:699.37px; background:#141413; opacity:0.39; transform:translateX(-50%); filter:blur(4px)"></div>
  <p id="2996c1e1" style="position:absolute; top:566px; left:128px; width:1300px; font-family:'Source Serif 4', Georgia, serif; font-size:64px; line-height:1.15; color:#f3efe6">Agentic DeFi: say what you want, and Luca does it on-chain.</p>
  <h1 id="406f0ce1" style="position:absolute; top:406.01px; left:50%; width:1664px; font-family:'Source Serif 4', Georgia, serif; font-size:160px; font-weight:600; line-height:1; color:#f3efe6; transform:translateX(-50%)">Kaleido<span style="color:#00b383">fi</span></h1>
  <img src="/deck/colosseum-1.webp" alt="kaleidocolosseum.png" id="eccc896e" style="position:absolute; top:50%; left:50%; width:1920.02px; height:1080.01px; opacity:0.09; transform:translate(-50%, -50%); mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="problem" style="display:flex; flex-direction:column; gap:64px; padding:128px; background:#f3efe6">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#0b7a4b">The problem</p>
  <h2 style="width:1500px; font-family:'Source Serif 4', Georgia, serif; font-size:88px; font-weight:600; line-height:1.1; color:#141413">DeFi still asks users to be their own engineer.</h2>
  <div style="display:flex; flex-direction:row; gap:32px">
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#141413">Too many steps</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.4; color:#5f5d56">Approve, route, bridge, swap, supply — each a separate app, tab and signature.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#141413">Easy to get wrong</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.4; color:#5f5d56">One wrong token, chain or slippage setting and funds are lost.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#141413">Agents you can't trust</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.4; color:#5f5d56">AI agents that move money give users no way to check what they'll sign.</p>
    </div>
  </div>
  <img src="/deck/colosseum-2.webp" alt="colosseum2.png" id="f896bd27" style="position:absolute; top:calc(50% + 0.01px); left:calc(50% + 0.01px); width:1920.02px; height:1080px; opacity:0.18; transform:translate(-50%, -50%)">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="solution" style="display:flex; flex-direction:column; gap:56px; justify-content:center; padding:128px; background:#141413">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">The solution · Luca</p>
  <h2 style="width:1560px; font-family:'Source Serif 4', Georgia, serif; font-size:96px; font-weight:600; line-height:1.08; color:#f3efe6">One sentence in. One audited transaction out.</h2>
  <div style="width:1400px; display:flex; flex-direction:column; gap:20px; padding:48px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
    <p style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; color:#a8a49b">You</p>
    <p style="font-family:'Source Serif 4', Georgia, serif; font-size:52px; color:#f3efe6">“Bridge my USDC from BNB into Arc and swap half to EURC.”</p>
    <p style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:600; color:#00b383">Luca → plan · independent audit · simulation · one signature</p>
  </div>
  <img src="/deck/texture.webp" alt="bg-3.webp" id="c2464dae" style="position:absolute; bottom:0; left:0; width:1920.01px; height:1080px; opacity:0.4; mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="how" style="display:flex; flex-direction:column; gap:72px; padding:128px; background:#f3efe6">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#0b7a4b">How it works</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#141413">Safety is built into every step.</h2>
  <div style="display:flex; flex-direction:row; gap:24px">
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#141413; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:64px; color:#00b383">01</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#f3efe6">Understand</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">Luca parses intent, from plain language or one of 40+ supported actions.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#141413; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:64px; color:#00b383">02</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#f3efe6">Build</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">A deterministic builder routes across our DEX, KyberSwap and LI.FI for best price.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#141413; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:64px; color:#00b383">03</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#f3efe6">Audit</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">An independent auditor checks slippage, limits and targets, then simulates.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:40px; background:#00b383; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:64px; color:#0b0b0a">04</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:40px; font-weight:700; color:#0b0b0a">Sign</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#0b2a1e">The user reviews the plan and signs, so their keys never leave their wallet.</p>
    </div>
  </div>
  <img src="/deck/colosseum-2.webp" alt="colosseum2.png" id="4abaef86" style="position:absolute; top:calc(50% + 0.01px); left:calc(50% + 0.01px); width:1920.02px; height:1080px; opacity:0.18; transform:translate(-50%, -50%)">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="product" style="display:flex; flex-direction:column; gap:56px; padding:128px; background:#f3efe6">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#0b7a4b">The product</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#141413">A full DeFi stack, owned end to end.</h2>
  <div style="display:grid; gap:24px; grid-template-columns:1fr 1fr 1fr">
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#141413">V3 DEX</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#5f5d56">Concentrated liquidity on Arc, aggregator routing for best execution.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#141413">Lending</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#5f5d56">Over-collateralized markets, Chainlink oracles, automated liquidations.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#141413">Limit orders</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#5f5d56">EIP-712 signed orders, filled by our keeper via pools or aggregators.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#141413">Bridging</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#5f5d56">Into and out of Arc from BNB, Base, Ethereum and Robinhood Chain.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#141413">kfUSD stablecoin</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#5f5d56">Collateral-backed, with yield-bearing kafUSD and an on-chain treasury.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; padding:36px; background:#141413; border-radius:24px">
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#00b383">Luca on top</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; line-height:1.4; color:#c9c4b8">Every product above is one plain-language request away.</p>
    </div>
  </div>
  <img src="/deck/colosseum-2.webp" alt="colosseum2.png" id="c392e1c3" style="position:absolute; top:calc(50% + 0.01px); left:calc(50% + 0.01px); width:1920.02px; height:1080px; opacity:0.18; transform:translate(-50%, -50%)">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="testnet" style="display:flex; flex-direction:column; gap:56px; padding:128px 128px 160px; background:#141413">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">Traction · testnet</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#f3efe6">Battle-tested across 5 chains before mainnet.</h2>
  <div style="display:grid; gap:24px; grid-template-columns:1fr 1fr 1fr">
    <div style="display:flex; flex-direction:column; gap:8px; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:96px; font-weight:600; line-height:1.05; color:#00b383">$30.8M</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; color:#c9c4b8">testnet TVL: $29.7M DEX + $1.09M lending</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:96px; font-weight:600; line-height:1.05; color:#00b383">$4.9M+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; color:#c9c4b8">swap volume, 4,100+ swaps on Base Sepolia alone</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:96px; font-weight:600; line-height:1.05; color:#00b383">3,000+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; color:#c9c4b8">private-beta testers, 5,000+ Luca requests</p>
    </div>
  </div>
  <p style="position:absolute; bottom:64px; left:128px; width:1664px; font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#8f8a80">Testnet tokens valued at market prices · Sepolia, Base Sepolia, BNB, Arc and Robinhood testnets · TVL read on-chain, Oct 2026</p>
  <img src="/deck/texture.webp" alt="bg-3.webp" id="aaf543a1" style="position:absolute; bottom:0; left:0; width:1920.01px; height:1080px; opacity:0.4; mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="mainnet" style="display:flex; flex-direction:column; gap:56px; padding:128px 128px 160px; background:#f3efe6">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#0b7a4b">Traction · Arc mainnet</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#141413">A community that's already on-chain.</h2>
  <div style="display:grid; gap:24px; grid-template-columns:1fr 1fr">
    <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; color:#0b7a4b">10.7K+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; color:#5f5d56">waitlist sign-ups</p>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; color:#0b7a4b">7,000+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; color:#5f5d56">wallets on the Season 1 leaderboard</p>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; color:#0b7a4b">1,000+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; color:#5f5d56">wallets activated on Arc</p>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:36px; background:#fbf9f4; border:1px solid #e2dccd; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; color:#0b7a4b">1,000+</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; color:#5f5d56">daily check-in wallets in 3 days</p>
    </div>
  </div>
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:32px; color:#141413"><b>4,900+</b> users linked X · <b>2.79M+</b> $kPoint earned · <b>1,100+</b> mainnet swaps · listed on <b>DefiLlama</b></p>
  <p style="position:absolute; bottom:64px; left:128px; width:1664px; font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#7a776e">Source: Kaleido production database and Arc mainnet, Oct 2026</p>
  <img src="/deck/colosseum-3.webp" alt="colosseum3.png" id="98b3ed37" style="position:absolute; top:50%; left:calc(50% + 8.01px); width:1920.02px; height:1080px; opacity:0.12; transform:translate(-50%, -50%); mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="model" style="display:flex; flex-direction:column; gap:64px; padding:128px; background:#141413">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">Business model</p>
  <h2 style="width:1500px; font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#f3efe6">Revenue on every action Luca executes.</h2>
  <div style="display:flex; flex-direction:row; gap:24px">
    <div style="display:flex; flex-direction:column; gap:12px; flex:1; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:72px; font-weight:600; color:#00b383">0.2%</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Routing fee</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">On aggregator swaps and bridges routed by Kaleido. Live today.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; flex:1; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:72px; font-weight:600; color:#00b383">Pools</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">DEX fees</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">Protocol share of swap fees on our own V3 pools.</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px; flex:1; padding:40px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <p style="font-family:'Source Serif 4', Georgia, serif; font-size:72px; font-weight:600; color:#00b383">Spread</p>
      <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Lending</h3>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; line-height:1.4; color:#c9c4b8">Interest spread and liquidation fees on lending markets.</p>
    </div>
  </div>
  <img src="/deck/texture.webp" alt="bg-3.webp" id="13a324e4" style="position:absolute; bottom:0; left:0; width:1920.01px; height:1080px; opacity:0.4; mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="ecosystem" style="display:flex; flex-direction:column; gap:56px; padding:128px; background:#f3efe6">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#0b7a4b">Ecosystem</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#141413">Built on Circle's stack, plugged into the best of DeFi.</h2>
  <table style="width:1664px; font-family:'DM Sans', Arial, sans-serif; font-size:30px; color:#141413">
    <tr><th style="width:30%">Partner</th><th style="width:70%">How Kaleido uses it</th></tr>
    <tr><td>Arc · Circle</td><td>Primary chain; USDC, EURC and cirBTC markets; CCTP integration</td></tr>
    <tr><td>KyberSwap · LI.FI</td><td>Best-price routing and cross-chain bridging for Luca</td></tr>
    <tr><td>Chainlink</td><td>Price oracles securing Arc mainnet lending</td></tr>
    <tr><td>DefiLlama</td><td>Listed: TVL and volume tracked publicly</td></tr>
    <tr><td>Argus launchpad</td><td>Luca trades new Arc launches in one request</td></tr>
  </table>
  <img src="/deck/colosseum-2.webp" alt="colosseum2.png" id="9aa1334b" style="position:absolute; top:calc(50% + 0.01px); left:calc(50% + 0.01px); width:1920.02px; height:1080px; opacity:0.18; transform:translate(-50%, -50%); mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="roadmap" style="display:flex; flex-direction:column; gap:64px; padding:128px; background:#141413">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">Roadmap</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#f3efe6">From one chain to the agent layer of DeFi.</h2>
  <div style="display:flex; flex-direction:row; gap:24px">
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:32px 8px 0 0; border-top:6px solid #00b383">
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:700; color:#00b383">Now · Q4 2026</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.45; color:#e8e3d8">Arc mainnet growth, security audit, Season 1 points, strategic round</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:32px 8px 0 0; border-top:6px solid #3d6b57">
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:700; color:#8fd9bd">Next</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.45; color:#e8e3d8">$KLD TGE, staking on Arc, kfUSD on mainnet, CEX listing</p>
    </div>
    <div style="display:flex; flex-direction:column; gap:16px; flex:1; padding:32px 8px 0 0; border-top:6px solid #33312c">
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:700; color:#c9c4b8">Then</p>
      <p style="font-family:'DM Sans', Arial, sans-serif; font-size:30px; line-height:1.45; color:#e8e3d8">Multi-chain expansion, autonomous strategies within user-set limits</p>
    </div>
  </div>
  <img src="/deck/colosseum-1.webp" alt="kaleidocolosseum.png" id="238329bc" style="position:absolute; top:50%; left:50%; width:1920.02px; height:1080.01px; opacity:0.09; transform:translate(-50%, -50%)">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="team" style="display:flex; flex-direction:column; gap:48px; padding:128px; background:#141413">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">The team</p>
  <h2 style="font-family:'Source Serif 4', Georgia, serif; font-size:80px; font-weight:600; line-height:1.1; color:#f3efe6">Builders who ship.</h2>
  <div style="display:grid; gap:24px; grid-template-columns:1fr 1fr">
    <div style="display:flex; flex-direction:row; gap:28px; align-items:center; padding:28px; background:#1d1c1a; border:1px solid #00b383; border-radius:24px">
      <img src="/deck/team-mac.webp" alt="Mac King" style="width:150px; height:150px; border-radius:75px">
      <div style="display:flex; flex-direction:column; gap:6px">
        <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Mac King (I.Q)</h3>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; font-weight:600; color:#00b383">Founder &amp; CEO</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; line-height:1.35; color:#c9c4b8">4x founder; DeFi protocols, smart-contract security, modular architecture.</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#00b383"><a href="https://www.linkedin.com/in/mac-king/" style="color:#00b383;text-decoration:underline">LinkedIn</a> · <a href="https://x.com/0xmacking" style="color:#00b383;text-decoration:underline">X</a></p>
      </div>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:center; padding:28px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <img src="/deck/team-eniola.webp" alt="Eniola Araokanmi" style="width:150px; height:150px; border-radius:75px">
      <div style="display:flex; flex-direction:column; gap:6px">
        <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Eniola Araokanmi</h3>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; font-weight:600; color:#00b383">Co-Founder &amp; CMO</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; line-height:1.35; color:#c9c4b8">Web3 growth strategist; community, branding and go-to-market.</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#00b383"><a href="https://www.linkedin.com/in/eniola-araokanmi-a34125369/" style="color:#00b383;text-decoration:underline">LinkedIn</a></p>
      </div>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:center; padding:28px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <img src="/deck/team-anointing.webp" alt="Anointing Babajide" style="width:150px; height:150px; border-radius:75px">
      <div style="display:flex; flex-direction:column; gap:6px">
        <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Anointing Babajide</h3>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; font-weight:600; color:#00b383">Protocol Lead &amp; CTO</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; line-height:1.35; color:#c9c4b8">Senior blockchain engineer; Solidity, backend and smart contracts.</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#00b383"><a href="https://www.linkedin.com/in/mojowlekaz" style="color:#00b383;text-decoration:underline">LinkedIn</a> · <a href="https://x.com/anointingmlabs" style="color:#00b383;text-decoration:underline">X</a></p>
      </div>
    </div>
    <div style="display:flex; flex-direction:row; gap:28px; align-items:center; padding:28px; background:#1d1c1a; border:1px solid #33312c; border-radius:24px">
      <img src="/deck/team-dauda.webp" alt="Dauda Mustapha" style="width:150px; height:150px; border-radius:75px">
      <div style="display:flex; flex-direction:column; gap:6px">
        <h3 style="font-family:'DM Sans', Arial, sans-serif; font-size:36px; font-weight:700; color:#f3efe6">Dauda Mustapha</h3>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:26px; font-weight:600; color:#00b383">Lead Software Architect &amp; COO</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; line-height:1.35; color:#c9c4b8">Full-stack; React/Next.js and Web3 integrations, technical design.</p>
        <p style="font-family:'DM Sans', Arial, sans-serif; font-size:24px; color:#00b383"><a href="https://www.linkedin.com/in/mustapha-dauda-05370822a" style="color:#00b383;text-decoration:underline">LinkedIn</a></p>
      </div>
    </div>
  </div>
  <img src="/deck/texture.webp" alt="bg-3.webp" id="10f53cf4" style="position:absolute; bottom:0; left:0; width:1920.01px; height:1080px; opacity:0.4; mix-blend-mode:screen">
  
</section></div></div>
<div class="frame"><div class="slide"><section id="ask" style="display:flex; flex-direction:column; gap:48px; justify-content:center; padding:128px; background:radial-gradient(circle at 20% 80%, #0f3a2b 0%, #141413 60%)">
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:28px; font-weight:600; letter-spacing:6px; text-transform:uppercase; color:#00b383">Let's build together</p>
  <h2 style="width:1500px; font-family:'Source Serif 4', Georgia, serif; font-size:104px; font-weight:600; line-height:1.05; color:#f3efe6">Raising <span style="color:#00b383">$1M</span> to scale agentic DeFi.</h2>
  <p style="width:1400px; font-family:'DM Sans', Arial, sans-serif; font-size:36px; line-height:1.45; color:#c9c4b8">Seeking strategic partners who bring liquidity, distribution and ecosystem reach: security, liquidity, AI infrastructure and multi-chain expansion.</p>
  <p style="font-family:'DM Sans', Arial, sans-serif; font-size:32px; color:#f3efe6">mac@kaleidofi.xyz · kaleidofi.xyz · Telegram @macrew15</p>
  <img src="/deck/texture.webp" alt="bg-3.webp" id="da70e45e" style="position:absolute; bottom:0; left:0; width:1920.01px; height:1080px; opacity:0.4; mix-blend-mode:screen">
  
</section></div></div>
</main>
<script>
  function fit(){var f=document.querySelector('.frame');if(!f)return;var s=f.clientWidth/1920;document.documentElement.style.setProperty('--s',s)}
  addEventListener('resize',fit);fit();
</script>
</body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
