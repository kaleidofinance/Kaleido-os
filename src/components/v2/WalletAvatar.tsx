"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import s from "./WalletAvatar.module.css";

/**
 * The wallet's avatar: art generated from its own address.
 *
 * What was here before was a grey disc — `.pav` on /portfolio and `.avatar` in
 * WalletMenu, two placeholders for the same idea. A disc is worse than nothing at
 * profile size, because it looks like an image that failed to load.
 *
 * WHY GENERATED AND NOT FETCHED
 *
 * The alternative is an avatar service (`https://…/avatar/0x28b7…`), and the
 * objection is the one TokenIcon's header already makes about `logoURI`: a
 * third-party request per render, which tells whoever hosts it which addresses
 * this browser is looking at, 404s into a broken-image glyph, and does not work
 * offline. An address is 40 hex characters of entropy — everything needed to draw
 * something distinct is already in hand, and drawing it locally leaks nothing.
 *
 * The seed is the lowercased address, so a checksummed and an unchecksummed
 * spelling of one wallet are one avatar. Nothing about the art is stored: the same
 * address always draws the same thing, on any device, with no migration to run.
 *
 * SIX STYLES, ONE PALETTE
 *
 * `AVATAR_STYLES` are six different geometries over the same seed. The colours
 * come off the first draws of the sequence, before any renderer runs, so switching
 * style keeps the wallet's colours and changes only its shape — the identity stays
 * recognisable while the taste is the user's. The choice lives in localStorage
 * (per browser, not per wallet) and is published through `useSyncExternalStore`,
 * so the nav pill and the profile header change together without a page reload.
 *
 * WHERE THIS GOES NEXT
 *
 * A Genesis NFT collection is planned; when it ships, a holder will be able to
 * point their profile at a token they own and this becomes the fallback rather
 * than the only option. That is why the choice is a named style resolved at render
 * time instead of a blob written somewhere: adding a `genesis:<tokenId>` case
 * later is one more branch, not a data migration. Nothing in the UI should
 * advertise the collection before it exists.
 */

export const AVATAR_STYLES = [
  "blocks",
  "rings",
  "orbit",
  "prism",
  "bloom",
  "wave",
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/** Human names, for the picker's tooltip and its accessible label. */
export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  blocks: "Blocks",
  rings: "Rings",
  orbit: "Orbit",
  prism: "Prism",
  bloom: "Bloom",
  wave: "Wave",
};

const DEFAULT_STYLE: AvatarStyle = "blocks";
const STORAGE_KEY = "kaleido.avatar.style";

// --- the stored choice ---------------------------------------------------

/*
 * A module-level store rather than component state, because two components render
 * the avatar at once (the nav pill and the profile header) and they have no
 * ancestor in common worth putting a context provider on. `useSyncExternalStore`
 * is also the one hook that gets hydration right here without a mounted flag: the
 * server render takes `getServerSnapshot`, and React re-reads the client store
 * after hydration rather than during it.
 */
let cached: AvatarStyle | null = null;
const listeners = new Set<() => void>();

const isStyle = (v: unknown): v is AvatarStyle =>
  typeof v === "string" && (AVATAR_STYLES as readonly string[]).includes(v);

const readStored = (): AvatarStyle => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isStyle(raw) ? raw : DEFAULT_STYLE;
  } catch {
    /* Storage is throwable, not just absent: Safari's private mode and a
       third-party-cookie-blocked iframe both raise on access. The default is a
       complete answer, so this is a fall-through and not an error path. */
    return DEFAULT_STYLE;
  }
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  /* Another tab's write arrives as a `storage` event. Rare, and one line. */
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    cached = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
};

const getSnapshot = (): AvatarStyle => {
  if (cached === null) cached = readStored();
  return cached;
};

/* Must be referentially stable across renders — returning a fresh value here is
   the classic useSyncExternalStore infinite loop. A literal is stable. */
const getServerSnapshot = (): AvatarStyle => DEFAULT_STYLE;

export const useAvatarStyle = (): AvatarStyle =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export const setAvatarStyle = (next: AvatarStyle): void => {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Unwritable storage costs the choice on the next visit, not this one — so
       the store is updated first and the notify below still runs. */
  }
  for (const fn of listeners) fn();
};

// --- the art ------------------------------------------------------------

/** FNV-1a over the lowercased address. Cheap, and well spread for short keys. */
const seedOf = (address: string): number => {
  let h = 0x811c9dc5;
  const a = address.toLowerCase();
  for (let i = 0; i < a.length; i++) {
    h ^= a.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32. Deterministic, so the avatar survives a reload and a device. */
const prng = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

interface Palette {
  /** Opaque, and mid-dark at every hue: this app ships a light theme as well, and
      a translucent or near-black plate reads as a hole punched in a white page. */
  bg: string;
  a: string;
  b: string;
  c: string;
}

const paletteOf = (rand: () => number): Palette => {
  const hue = Math.floor(rand() * 360);
  /* A second hue far enough away to be a different colour but not the complement,
     which at full saturation vibrates. */
  const spin = 45 + Math.floor(rand() * 70);
  return {
    bg: `hsl(${hue} 58% 22%)`,
    a: `hsl(${hue} 72% 62%)`,
    b: `hsl(${(hue + spin) % 360} 74% 66%)`,
    c: `hsl(${(hue + spin * 2) % 360} 62% 52%)`,
  };
};

/* All six draw into the same 32-unit square, so `size` is the only thing that
   decides how big any of them are. They are pure functions of the sequence: same
   address, same picture. */
type Renderer = (rand: () => number, p: Palette) => ReactNode;

const RENDERERS: Record<AvatarStyle, Renderer> = {
  /* Blockies' shape: a 4x8 field of cells mirrored down the middle. Symmetry is
     what makes a random grid read as a face rather than as noise. */
  blocks: (rand, p) => {
    const fills = [p.bg, p.bg, p.a, p.b, p.c];
    const cells: ReactNode[] = [];
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 8; y++) {
        const fill = fills[Math.floor(rand() * fills.length)];
        if (fill === p.bg) continue;
        cells.push(
          <rect key={`l${x}${y}`} x={x * 4} y={y * 4} width={4} height={4} fill={fill} />,
          <rect key={`r${x}${y}`} x={(7 - x) * 4} y={y * 4} width={4} height={4} fill={fill} />,
        );
      }
    }
    return <>{cells}</>;
  },

  /* Concentric arcs. The dash array is what stops four circles being four
     circles — each ring becomes a different broken band. */
  rings: (rand, p) => {
    const cols = [p.a, p.b, p.c, p.a];
    return (
      <>
        {[13.5, 10, 6.5, 3].map((r, i) => {
          const circ = 2 * Math.PI * r;
          const on = circ * (0.35 + rand() * 0.5);
          return (
            <circle
              key={r}
              cx={16}
              cy={16}
              r={r}
              fill="none"
              stroke={cols[i]}
              strokeWidth={1.6 + rand() * 1.6}
              strokeLinecap="round"
              strokeDasharray={`${on} ${circ - on}`}
              transform={`rotate(${Math.floor(rand() * 360)} 16 16)`}
            />
          );
        })}
      </>
    );
  },

  /* Dots on a ring, plus one at the centre — a system rather than a pattern, so
     it reads as deliberate at 22px where finer art turns to mud. */
  orbit: (rand, p) => {
    const cols = [p.a, p.b, p.c];
    const n = 4 + Math.floor(rand() * 3);
    const dots: ReactNode[] = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + rand() * 0.6;
      const radius = 7 + rand() * 5.5;
      dots.push(
        <circle
          key={i}
          cx={16 + Math.cos(angle) * radius}
          cy={16 + Math.sin(angle) * radius}
          r={1.6 + rand() * 2.4}
          fill={cols[i % cols.length]}
        />,
      );
    }
    return (
      <>
        {dots}
        <circle cx={16} cy={16} r={2.4 + rand() * 2} fill={p.b} />
      </>
    );
  },

  /* A pinwheel of four quadrants at one seeded rotation. The only style whose
     shapes touch the edge on every side, which makes it the one that still looks
     like something at the nav's 22px. */
  prism: (rand, p) => {
    const cols = [p.a, p.b, p.c, p.a];
    const off = Math.floor(rand() * 90);
    return (
      <>
        {[0, 90, 180, 270].map((deg, i) => (
          <path
            key={deg}
            d="M16 16 L32 16 L32 -2 Z"
            fill={cols[i]}
            opacity={0.72 + rand() * 0.28}
            transform={`rotate(${deg + off} 16 16)`}
          />
        ))}
      </>
    );
  },

  /* Three soft overlapping discs. `fill-opacity` rather than `mix-blend-mode`,
     which is the loudest version of this and the one that changes appearance
     depending on what is painted behind the avatar — a nav pill on a scrolled
     page has a blurred backdrop, and art that reacts to it is not an identity. */
  bloom: (rand, p) => {
    const cols = [p.a, p.b, p.c];
    return (
      <>
        {cols.map((col, i) => (
          <circle
            key={i}
            cx={8 + rand() * 16}
            cy={8 + rand() * 16}
            r={7 + rand() * 6}
            fill={col}
            fillOpacity={0.62}
          />
        ))}
      </>
    );
  },

  /* Stacked bands, each one a curve across the face. Reads as a horizon, and it is
     the only style here with a clear top and bottom. */
  wave: (rand, p) => {
    const cols = [p.c, p.a, p.b];
    return (
      <>
        {cols.map((col, i) => {
          const y = 10 + i * 7 + rand() * 3;
          const lift = 4 + rand() * 7;
          return (
            <path
              key={i}
              d={`M0 ${y} Q 8 ${y - lift} 16 ${y} T 32 ${y} L32 32 L0 32 Z`}
              fill={col}
            />
          );
        })}
      </>
    );
  },
};

interface Props {
  /** Null while no wallet is connected — see the plate branch below. */
  address: string | null | undefined;
  /** Rendered size in px. The art is resolution-independent. */
  size?: number;
  /** Overrides the stored choice. Only the picker passes this, to show samples. */
  style?: AvatarStyle;
  className?: string;
}

export default function WalletAvatar({
  address,
  size = 44,
  style,
  className,
}: Props) {
  const stored = useAvatarStyle();
  const chosen = style ?? stored;

  /* No address, no art. Generating from a placeholder seed would draw a stranger's
     face on an empty account, and every wallet would share it. */
  if (!address) {
    return (
      <span
        className={`${s.plate} ${className ?? ""}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  const rand = prng(seedOf(address));
  /* Palette first, before any renderer draws: this is what keeps one wallet's
     colours the same across all six styles. */
  const palette = paletteOf(rand);

  return (
    <svg
      className={`${s.avatar} ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      /* Decorative in both of its homes — the address is rendered next to it in
         the nav pill and on the profile header, and the picker's button carries
         the label for the control. */
      aria-hidden="true"
      focusable="false"
    >
      <rect width={32} height={32} fill={palette.bg} />
      {RENDERERS[chosen](rand, palette)}
    </svg>
  );
}
