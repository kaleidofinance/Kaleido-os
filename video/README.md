# Kaleido — launch video

A 30-second cut for the private-testnet announcement, built in
[Remotion](https://remotion.dev) so the timing, copy and brand values live in
source instead of in someone's editor project file.

```bash
cd video
npm install
npm run studio     # preview and scrub at http://localhost:3000
npm run render     # → out/kaleido-private-beta-16x9.mp4
```

## Why this is its own npm project

`video/` has a `package.json` of its own and is **not** part of the Next app's
dependency tree. That is deliberate:

- Remotion pulls in a bundler, a Chrome Headless Shell download and a full second
  React copy. Putting that in the app's `package.json` means every `npm ci` in CI
  and every Vercel build pays for a tool that never runs in production.
- It cannot be imported from `src/`, and `src/` cannot be imported from here.
  The one cost of that is `src/theme.ts`, which **copies** the colour tokens out
  of `src/app/(app)/tokens.css` instead of reading them. If the app's dark theme
  is retuned, that copy is stale until someone updates it — the header comment in
  the file says so. A build step that parsed `tokens.css` would fix it and is more
  machinery than a launch video earns.
- The three `.woff` files in `public/` are copies of the ones in `src/app/fonts/`,
  for the same reason. Same files, so the video is set in the product's actual
  type rather than something that looks close.

## The cut

Six scenes, 900 frames at 30fps. Durations live in one table — `SCENES` in
[`src/theme.ts`](src/theme.ts) — and both `from` and `durationInFrames` are
derived from it, so the scenes cannot sum to anything other than the composition
length.

| # | Scene | Frames | Holds |
|---|-------|--------|-------|
| 1 | `wordmark` | 0–120 | The mark, and "Tell it what you want." |
| 2 | `access` | 120–270 | The real access-code gate, filling and unlocking |
| 3 | `agent` | 270–480 | One typed instruction becoming a three-step plan |
| 4 | `stack` | 480–600 | The six live primitives |
| 5 | `chains` | 600–720 | The five networks, with their chain ids |
| 6 | `cta` | 720–900 | "Join the private testnet." + the domain |

Scene 3 gets the most time because it is the only one that has to show a
mechanism rather than state a fact. Scene 6 gets the second most because it is
the frame people screenshot and the one on screen when the loop restarts.

### The access code is never shown

Scene 2 animates the gate from
[`src/components/v2/BetaGate.tsx`](../src/components/v2/BetaGate.tsx), and its six
boxes fill with **masked dots**. The code goes only to people who complete the
waitlist form, and a video is the most copyable place there is to leak one — a
frame is a screenshot away and X keeps the still on the timeline after playback.
Masked input is also what the product itself renders, so this is accurate as well
as safe. Do not "improve" this scene by typing the real characters into it.

### The chain ids are real

Scene 5 prints `11155111`, `84532`, `97`, `46630` and `5042002` because a chain id
is checkable and a logo is not — anyone watching can paste one into an explorer
and find the deployment. They are the same values as in
[`src/constants/chains.ts`](../src/constants/chains.ts); if a network moves, that
file is the source and this scene is the copy.

## Three aspect ratios, one composition

`Root.tsx` registers `LaunchWide` (1920×1080), `LaunchSquare` (1080×1080) and
`LaunchVertical` (1080×1920). All three render the identical component and nothing
branches on aspect ratio.

Every scene lays out inside a fixed 1200×900 logical canvas, and `Stage` scales
that canvas by `Math.min(width / 1200, height / 900)`. The box therefore always
fits entirely and only the backdrop around it changes. The cheaper approach — one
layout, cropped per ratio — cuts the edges off the chip and chain rows in the
square cut, which is invisible on a desktop preview and fatal in a phone feed.

```bash
npm run render:square      # → out/kaleido-private-beta-1x1.mp4
npm run render:vertical    # → out/kaleido-private-beta-9x16.mp4
npm run still              # → out/poster.png  (frame 870, inside the CTA)
```

## The audio is synthesised, not sourced

[`scripts/gen-audio.mjs`](scripts/gen-audio.mjs) writes `public/bed.wav` — thirty
seconds of ambient pad, a 120 BPM pulse and a handful of accents — from raw
oscillators in plain Node, no dependencies.

Two reasons it is generated rather than licensed:

- A launch post is a commercial use, and every "royalty-free" library track carries
  attribution or licence terms that then have to be honoured and tracked on a file
  that will be reposted. Generating it means the audio is ours outright.
- It hits the picture exactly. Every accent is placed at a frame number taken from
  the same `SCENES` table the visuals use: the six rising blips land on the access
  boxes filling, the three-note motif lands on the plan ticks being drawn, and the
  bloom lands on the cut into the CTA. Cutting a stock track to those marks by ear
  is the part that would take an afternoon.

The generator is deterministic — its noise source is a seeded LCG, not
`Math.random` — so the WAV is byte-identical on every run. That is what makes it
safe to gitignore the 5.5 MB file and regenerate it as a build step;
`npm run render` and `npm run studio` both run `npm run audio` first.

Measured on the current bed: peak −1.0 dBFS, overall RMS −14.9 dBFS, content in
every second, 1.6-second tail so the loop restart on X does not click.

The picture is still built to work in silence — feeds autoplay muted, and no
information is in the audio that is not on screen.

## Editing copy

All of it is in the six files under `src/scenes/`. Two standing constraints apply,
the same ones that apply to the product's own copy:

- No "coming soon", "not live yet", "pre-launch" or demo-banner language. A dated
  milestone is not a disclaimer; a hedge about whether the thing works is.
- Scene 4 lists deployed primitives only. Nothing on a roadmap goes on that list.

`out/` is gitignored. The rendered MP4 is a build artifact — re-render it rather
than committing it.
