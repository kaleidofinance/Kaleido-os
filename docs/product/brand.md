# The mark, the palette, and where to find us

Everything on this page is a value read out of the stylesheet the product actually
uses, not a guideline written alongside it. If a colour here disagrees with the app,
the app is right and this page is stale.

![The Kaleidofi wordmark beside its palette and its two faces: a 24px brand-green circle carrying the mark, the word Kaleido with a smaller fi, the eight colour swatches with their hex values, and a serif display sample set against a sans body sample.](/docs-media/brand.svg "The two greens are 23 degrees of hue apart and never share a zone.")

## The wordmark

**Kaleidofi**, one word. "Kaleido" is set in brand green and "fi" is the same word a
size down — 0.75em — in body ink, so it reads as a name with a domain suffix attached
rather than as one nine-letter green word. The two halves are never separated, never
given a space, and never set in the same size.

The mark beside it is a 24px circle, always circular, filled with brand green with the
source art laid over it at 240% and centred. The art carries its own dark backdrop, so
the zoom is what makes the leftover edges read as part of the ring instead of as a
square photograph. It does not have a square variant.

Its accessible name is "Kaleidofi" — the visible text, exactly. An accessible name
that expands or abbreviates a visible wordmark is what breaks voice control, because
"click Kaleidofi" then matches nothing.

There are two implementations of it in the repository and that is deliberate:
`_components/Brand.tsx` in the marketing route group serves the landing page and these
docs, and the app's nav keeps its own copy, because app chrome must not import from a
marketing route group. Two copies with a reason beats three without one.

## Two greens, and they are never confused

This is the one palette rule that breaks a screen when it is broken.

**Brand green is a fill, and it appears only on chrome** — the logo, and the single
primary action in a view. **Data green is text, and it appears only in numeric
columns.** They sit about 23° of hue apart, and because they never share a zone, a
green button and a green profit figure never read as the same kind of thing.

The second rule follows from the first: the accent is rare. Brand green shows up two
or three times on a page. Status labels are neutral; only a genuine problem earns
orange or red.

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| Brand | `#00b383` | `#12a866` | Fills — the mark, one primary action per view |
| Brand hover | `#0ac795` | `#0e8f57` | That action, hovered |
| Brand foreground | `#04170f` | `#ffffff` | Text sitting on a brand fill |
| Positive | `#4cc46a` | `#4cc46a` | Numeric text only |
| Negative | `#ff5f52` | `#ff5f52` | Numeric text only |
| Accent | `#f0803c` | `#f0803c` | Attention without alarm |
| Danger | `#ff5f52` | `#ff5f52` | Destructive actions and hard failure |

The light-mode brand value is a different colour rather than the same one lightened,
for a plain reason: `#00b383` has no usable contrast on white.

## Surfaces and ink

| Token | Dark | Light |
| --- | --- | --- |
| Page | `#000000` | `#faf9f5` |
| Card | `#1d1c1a` | `#ffffff` |
| Well | `#191817` | — |
| Hairline | `rgba(255,255,255,.075)` | — |
| Text 1 | `#ffffff` | `#141413` |
| Text 2 | `#a8a49b` | `#6d6b63` |
| Text 3 | `#6b6760` | `#9c988e` |

The ground is pure black and the ramp above it is warm — red above green above blue,
by a delta of one to six. That warmth has a ceiling and it is easy to breach: warm grey
next to green is how a screen picks up an olive cast, and a draft of this ramp used a
card colour nearly three times warmer than the current one, which is precisely the
value that muddied. If the app ever does read olive, pull the neutrals toward neutral.
Never desaturate the greens — they are the identity.

Glass — a blur with saturation pushed back up — is for surfaces that float or frame:
nav, modals, dropdowns, stat cards, the swap shell. Never behind dense tables or body
copy, where blur under small text destroys legibility.

## Type

Two faces. **Geist** for everything, falling back through Inter and the system stack.
**Lora** for display titles only, never for data, pinned to weight 400 and never bold,
with -0.02em tracking — negative tracking is the load-bearing half of the effect, since
a serif set at default tracking reads as a word processor rather than as a brand.

Lora specifically because the faces this system takes its cues from are commercially
licensed and cannot be vendored; Lora is the substitute those same public brand
guidelines nominate, which makes it a stated stand-in rather than our guess.

The scale is 13, 14, 16, 19, 22, 30, 52. Spacing steps 4, 8, 12, 16, 20, 26, 34.
Corners are 12px on inputs, 16px on buttons and inner wells, 20px on cards and tables,
24px on the swap and agent cards and on modals, and fully round on pills and chips.

## Assets

| File | What it is |
| --- | --- |
| `public/newklogo2.png` | The source art. Every rendering of the mark draws this file |
| `public/kld.png` | A 300px crop of the same art, used as the KLD token icon |
| `public/email-logo.png` | A 192px square crop of the same art, for email, where CSS cannot crop. Built by `scripts/crop-email-logo.mjs` |
| `public/icon-192.png`, `public/icon-512.png` | Installed-app icons, both `any maskable` |
| `public/apple-icon.png` | The iOS home-screen icon |
| `public/opengraph-image.png` | The link preview |
| `public/docs-media/` | The figures on these pages — SVG, 720 wide, themed by media query |

Installed, the app is **Kaleido Agentic OS**, shortened to **Kaleido**, standalone, on
a black ground.

The figures in `public/docs-media/` are worth one note if you are adding a page: each
one paints its own opaque background rectangle under a `prefers-color-scheme` query
rather than inheriting the page's. The site seeds its theme from local storage and a
toggle can override it, so an SVG that assumed the OS setting would be transparent on
the wrong background about half the time.

## Where we are

| | |
| --- | --- |
| Site | `kaleidofi.xyz` |
| App | `app.kaleidofi.xyz`, which lands on `/trade` |
| Source | [github.com/kaleidofinance/Kaleido-os](https://github.com/kaleidofinance/Kaleido-os) |

Those are the canonical properties. Anything else presenting itself as Kaleido is not
ours, and the source repository above is the only place any of this can be verified
from — every page on this site is a file in it, linked at the top of the page.
