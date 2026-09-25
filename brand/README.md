# Kaleido announcement cards

Reusable 1200×630 announcement / OG cards in the Kaleido house style (bright
Colosseum backdrop, serif **Kaleido**fi wordmark, green eyebrow, big serif
headline, footer stats, green URL). Same look as `public/waitlist-og.png`.

**You never edit the template.** You write a small JSON file and render it.

---

## Make a card

1. Write a JSON file (copy `brand/examples/points-milestone.json` and edit it).
2. Render it from the **repo root**:

   ```bash
   node brand/render-card.mjs my-card.json
   ```

   → `brand/out/my-card.png` at 2400×1260 (1200×630 @2x — X / OG card size).

   Other sizes / output path:

   ```bash
   node brand/render-card.mjs my-card.json out.png 1080x1080 2   # 2160² square
   node brand/render-card.mjs my-card.json out.png 1080x1920 2   # story / reel
   ```

Requires Google Chrome or Edge installed (headless). No dev server, no network
for assets — fonts and images come from `../src` and `../public`.

---

## JSON schema

| field       | type                         | notes |
|-------------|------------------------------|-------|
| `eyebrow`   | string                       | small green uppercase kicker, e.g. `"Kaleido Season 1 · Arc mainnet"` |
| `hero`      | string                       | the headline. A short value (≤16 chars) renders huge, like a stat (`"2,321,529"`); a longer string renders as a serif sentence (`"Limit orders are live."`) |
| `heroUnit`  | string (optional)            | green suffix on the hero, e.g. `"$kPoint"` |
| `sub`       | string (optional)            | one–two lines under the hero. `**bold**` is allowed and renders white |
| `stats`     | array (optional)             | footer chips. Each item is either a plain string (`"Live on Arc"`) or `{ "v": "6,920", "k": "wallets earning" }` — `v` renders green, `k` muted |
| `url`       | string (optional)            | green serif URL bottom-left, e.g. `"kaleidofi.xyz/rewards"` |
| `background`| `colosseum-bright` \| `colosseum-dark` \| `colosseum` \| `plain` | default `colosseum-bright`. `plain` is black + green glow (no photo) |
| `arc`       | boolean (optional)           | show the purple Arc mark before the first stat |

Only `hero` is really required; everything else is optional.

### Example — a feature launch

```json
{
  "eyebrow": "Product · Arc mainnet",
  "hero": "Limit orders are live.",
  "sub": "Set a price, sign once, and let **Luca** fill it when the market gets there. Non-custodial — the order is a signature, never a deposit.",
  "stats": ["Live on Arc", { "v": "0", "k": "keeper fee" }, "Fills at your price"],
  "url": "kaleidofi.xyz/trade/limit",
  "background": "colosseum-bright",
  "arc": true
}
```

---

## For an AI agent (e.g. Codex)

When asked to "design a banner/announcement card":

1. Do **not** design from scratch and do **not** edit `brand/announcement-card.html`.
2. Write a JSON file matching the schema above (numbers should be real — pull
   them, don't invent). Keep `hero` to one idea; put detail in `sub`.
3. Run `node brand/render-card.mjs <file>.json` from the repo root.
4. The PNG is at `brand/out/<file>.png`. Hand that back.

House rules that keep it on-brand:

- Numbers use thousands separators (`2,321,529`).
- No "coming soon / demo / not live" copy — state what is true, plainly.
- Foreground the agent (Luca) where it fits — it's the differentiator.
- One hero idea per card. If you're tempted to add a second, make a second card.

## Files

- `announcement-card.html` — the template. Fixed. Don't edit to make a card.
- `render-card.mjs` — the renderer (`node brand/render-card.mjs data.json`).
- `examples/points-milestone.json` — a working reference (the Season 1 card).
- `out/` — rendered PNGs (git-ignored or committed per your preference).

Assets it uses (already in the repo): `public/waitlist-colosseum.webp`,
`public/hero-colosseum.webp`, `public/colosseum.webp`, `public/newklogo2.png`,
`public/arc-mark.png`; fonts `src/app/fonts/lora-var.woff2` + `GeistVF.woff`.
