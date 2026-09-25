# Kaleido illustration spec — isometric brand "clay"

The visual language for Kaleido's reference illustrations: the isometric
embossed-tile *technique* from Arc.io / Circle clay diagrams (thin-outline
product icons resting on stacked tiles, faint iso grid, hairline dashed
connectors, soft contact shadows, fine speckle) — but rendered in **Kaleido's
own dark ink / green / sand brand palette**, not pale cream. Authored as crisp
vector SVG so it's brand-controllable and infinitely re-renderable, and it sits
natively on the dark landing page.

Use these as **reference images inside the pitch decks and across the landing
page** (hero band, section dividers, "how it works" panels).

## Where the pieces live

- `brand/kaleido-ecosystem.svg` — the master hub-and-spoke: Luca (agent) at the
  centre, six product tiles around it (swap, kfUSD coin, analytics, staking,
  lending, bridge).
- `brand/gen-illustrations.py` — the generator. Edit the `sats` list / hub
  params and re-run to produce variants (single-product tiles, a wide hero
  band, subsets). `python brand/gen-illustrations.py`.
- Render to PNG: `chrome --headless=new --screenshot=brand/out/x.png
  --window-size=1500,1000 --force-device-scale-factor=2 --default-background-color=0
  file://…/brand/kaleido-ecosystem.svg` (or open the SVG directly — it's
  self-contained, no external assets).

## The rules (so every piece matches)

**Palette — Kaleido brand: dark ink, green, sand.**
- Background: radial `#0e1b16 → #07110e` (deep green-black, the landing ink).
- Tile top: `#1e332a → #132119` (dark green panel, top-lit), rim stroke `#2f4d3f`.
- Tile sides: left `#152720→#0f1c16`, right `#0f1c16→#0a140f` (right darker =
  light from upper-left). Stacked plates: `#16261f` / `#101c16`.
- Grid lines: `#1c2e25` at ~0.8 opacity. Connectors: Kaleido green `#35d18d`,
  `1 7` dash, round caps, ~0.7 opacity, with solid `#35d18d` nodes.
- Icons: single thin stroke in sand `#cbbf9f`, no fill (except tiny dot accents).
- Shadows: `rgba(0,0,0,·)` radial contact shadow.
- **Green is the one accent.** The hub icon is Kaleido green `#35d18d` with a
  soft green glow (`rgba(53,209,141,·)`) behind it — the single focal point.
  Everything else stays ink + sand; never add a second bright color.

**Projection — 2:1 dimetric.**
`sx = OX + (gx−gy)·TW/2`, `sy = OY + (gx+gy)·TH/2 − elev`, with `TW:TH ≈ 178:102`.
Tiles are rhombus tops + two side quads for thickness; stack 3–6 thin plates
under the top for the "stack of tiles" mass. Painter-order by `gx+gy`
(far→near); the hub draws between its back and front satellites.

**Icons — upright, thin, resting on the tile top.**
Draw centred at the tile's top-face centre, nudged up ~10px so they sit *on*
the surface, not floating. Stroke weight ~3.4 (sats) / ~4 (hub). Keep them
simple line glyphs: agent (rounded head + eyes + antenna), swap (two arrows),
lend (%), stake (diamond + chevron), coin ($ ellipse), bridge (arc + 2 nodes),
chart (bars). Hub icon is ~1.5× the satellites.

**Texture & light.**
Fine `feTurbulence` speckle on the tile tops at ~0.5 opacity (paper grain).
Soft radial contact shadow under each tile. No hard edges, no gradients on the
background other than the gentle vignette.

**Composition.**
Scene sits slightly above centre; leave breathing room below so a piece can
double as a hero/background. For a single-product tile, drop the satellites and
scale one tile to hub size. For a wide hero band, spread 3–5 tiles along one
iso row (vary `gx` at constant `gx+gy` bands).

## Do / don't

- **Do** keep it dark, calm, and restrained — ink + sand with a single green
  focal point. It should read "infrastructure," not "crypto neon."
- **Do** re-use the exact brand palette tokens above across every piece.
- **Don't** add glossy highlights, rainbow accents, or a second bright color
  beyond the one green hub.
- **Don't** place icons floating above tiles or overlapping connectors.
