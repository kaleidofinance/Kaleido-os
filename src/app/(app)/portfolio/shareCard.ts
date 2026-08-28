"use client";

/**
 * Draws the portfolio share card — the PNG the Share button hands to the OS.
 *
 * A link is the wrong thing to share and a sentence is only half right. /portfolio
 * renders whichever wallet is connected in the *reader's* browser, so the URL shows
 * a recipient their own empty page; the text fallback fixed that but still arrives
 * as a line of prose in a feed of pictures. Trading apps post an image, and the
 * reason is not decoration: the figures are the message, and an image is the only
 * form of it that survives being reposted, screenshotted and read at thumbnail
 * size.
 *
 * WHY A CANVAS AND NOT AN OG ROUTE
 *
 * The obvious alternative is `next/og` — an `/api/share/portfolio?net=…&hf=…` route
 * returning a PNG, which would also unfurl as a rich preview. It is rejected on
 * privacy: those query strings are somebody's balance and health factor, and a
 * serverless request log is the last place they should be. Drawing on the device
 * keeps a wallet's position on the device, and the card is shared as a file rather
 * than as a URL anyone else can refetch.
 *
 * 1080×1350 is 4:5 — the tallest portrait ratio the major timelines show uncropped,
 * and the shape the trading-app cards this imitates already use. No devicePixelRatio
 * scaling: this canvas is never displayed, so its pixels are the export's pixels and
 * 1080 wide is already retina for any feed.
 *
 * EVERY COLOUR IS READ FROM THE LIVE TOKENS, NOT HARDCODED. Two reasons. The card
 * then matches whichever theme the user is looking at, so the image they share is
 * the page they saw; and the hexes cannot drift from tokens.css the way a copied
 * palette always eventually does. They must be read off a `.kaleido-v2` element —
 * that is the scope the tokens are declared in (tokens.css:29 and :273), not
 * `:root`, so `getComputedStyle(document.documentElement)` returns empty strings
 * for all of them.
 *
 * The address is deliberately NOT on the card. The network is context; the account
 * is not, and a share button that quietly publishes your address to a timeline is
 * a doxxing tool. Trading apps show the position and never the account number.
 */

/** One label/figure pair, pre-formatted by the caller. */
export interface ShareStat {
  label: string;
  value: string;
}

export interface ShareCardData {
  /** The hero figure, already formatted — e.g. "$12,345.67". */
  netValue: string;
  /** Rendered as a 2×2 grid, so four is the number that fits. */
  stats: ShareStat[];
  /** Chain name, or null when there is none to name. */
  network: string | null;
}

const W = 1080;
const H = 1350;
const PAD = 80;
/** Usable width between the margins — every fitText call measures against it. */
const INNER = W - PAD * 2;

/**
 * Reads a design token off the app's own scope.
 *
 * The fallback is not decoration: an empty `fillStyle` assignment is silently
 * ignored by canvas, so a missing token paints the previous colour rather than
 * failing, and a card can come out as one flat rectangle with no visible error.
 */
function token(host: Element, name: string, fallback: string): string {
  const v = getComputedStyle(host).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Sets the largest size at or below `px` that keeps `text` inside `maxW`.
 *
 * The hero figure is the case that needs it: "$1,234,567.89" at the display size
 * is wider than the card, and a share image that clips its own headline number is
 * worse than one whose number is set a little smaller. Steps down by 4px rather
 * than solving for the ratio because measureText is not linear in font size once
 * hinting and kerning are involved.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  px: number,
  weight: number,
  family: string,
  maxW: number,
): void {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 24 && ctx.measureText(text).width > maxW) {
    size -= 4;
    ctx.font = `${weight} ${size}px ${family}`;
  }
}

/** roundRect is Chrome 99 / Safari 16.4 / Firefox 112. Square corners where it
    is missing beat no card at all, and the app already requires newer than that
    for backdrop-filter. */
function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Resolves `p`, or `fallback` if it has not settled within `ms`.
 *
 * Both of the draw's awaits are on promises that are *specified* to settle but
 * do not always: `img.decode()` was observed never settling when the document
 * is not rendering (headless Chrome, while verifying this card — it hung
 * indefinitely rather than rejecting), and `document.fonts.ready` is at the
 * mercy of the font loader. Either one hanging would leave the Share button
 * doing nothing whatsoever — no card, no text fallback, not even an error toast
 * — because the click handler is awaiting this function, and a `try/catch`
 * cannot rescue a promise that never rejects. A card set in a fallback face, or
 * one with no mark on it, is a far cheaper failure than silence.
 */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

/**
 * Loads the nav's own logo mark.
 *
 * Resolves to null rather than throwing: the card is worth shipping without its
 * mark, and a 404 on a decorative PNG should not cost the user their share.
 *
 * The load event rather than `decode()`, which is the tidier API but the one
 * that hangs (see withDeadline) — drawImage on a `complete` image decodes
 * synchronously anyway, and the only thing decode() buys is avoiding a jank
 * this off-screen canvas cannot suffer from.
 */
async function loadMark(): Promise<HTMLImageElement | null> {
  const img = new Image();
  const loaded = new Promise<HTMLImageElement | null>((resolve) => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
  /* After the handlers, so a cache hit still reports. */
  img.src = "/newklogo2.png";
  return withDeadline(loaded, 1500, null);
}

/**
 * Returns the card as a PNG blob, or null if it could not be drawn.
 *
 * Null is a real outcome the caller has to handle, not a defensive gesture:
 * `getContext` returns null when the browser has no 2D backend or has hit its
 * canvas budget, and `toBlob` hands back null on an encoder failure. Both mean
 * "share the sentence instead", which is why the text path stays.
 *
 * `host` is any element inside `.kaleido-v2` — the caller passes one it already
 * has a ref to, so this never has to guess with a querySelector.
 */
export async function drawShareCard(
  host: Element,
  d: ShareCardData,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const bg = token(host, "--k-bg", "#000000");
  const card = token(host, "--k-card", "#1d1c1a");
  const line = token(host, "--k-line", "rgba(255,255,255,0.075)");
  const t1 = token(host, "--k-t1", "#ffffff");
  const t2 = token(host, "--k-t2", "#a8a49b");
  const t3 = token(host, "--k-t3", "#6b6760");
  const brand = token(host, "--k-brand", "#00b383");
  /* The computed stack, not the raw `var(--k-font)` chain: canvas takes a
     font-family list happily, but not an unresolved custom property. */
  const family = getComputedStyle(host).fontFamily || "system-ui, sans-serif";

  /* Webfonts have to be in before the first measureText, or the hero figure is
     fitted against a fallback face and set at the wrong size. Deadlined for the
     reason withDeadline documents; the try/catch is for the browsers where
     document.fonts itself is missing and the property access throws. */
  try {
    await withDeadline(
      document.fonts.ready.then(() => null),
      2000,
      null,
    );
  } catch {
    /* Not implemented everywhere; the fallback face is still legible. */
  }

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* One brand glow, top-right. The app's surfaces get their depth from
     backdrop-filter, which has no canvas equivalent, so this stands in for it —
     enough to keep 1080×1350 of flat ground from reading as a placeholder. */
  const glow = ctx.createRadialGradient(W - 120, 40, 0, W - 120, 40, 620);
  glow.addColorStop(0, brand);
  glow.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  /* ------------------------------------------------------------------ header */
  const mark = await loadMark();
  const markSize = 64;
  if (mark) {
    /* Circle-clipped and drawn at 240%, centred — the same crop .mark uses in the
       nav (Nav.module.css), which is the zoom that frames the whole pinwheel:
       tighter and it turns into an abstract blob, wider and the PNG's own dark
       ground creeps in. What the card adds over the nav is the brand ring: at
       24px the disc reads as a mark-coloured dot, but at 64px on near-black it
       reads as a hole unless something closes its edge. The backing fill is what
       shows through if the PNG ever ships with transparency. */
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      PAD + markSize / 2,
      PAD + markSize / 2,
      markSize / 2,
      0,
      Math.PI * 2,
    );
    ctx.clip();
    ctx.fillStyle = brand;
    ctx.fillRect(PAD, PAD, markSize, markSize);
    const z = markSize * 2.4;
    ctx.drawImage(
      mark,
      PAD + (markSize - z) / 2,
      PAD + (markSize - z) / 2,
      z,
      z,
    );
    ctx.restore();
    ctx.beginPath();
    ctx.arc(
      PAD + markSize / 2,
      PAD + markSize / 2,
      markSize / 2 - 1,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = brand;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const nameX = PAD + (mark ? markSize + 20 : 0);
  const nameY = PAD + markSize / 2 + 16;
  ctx.font = `500 46px ${family}`;
  ctx.fillStyle = brand;
  ctx.fillText("Kaleido", nameX, nameY);
  /* "fi" at 0.75em in --k-t1, exactly as .logoFi splits it. */
  const kw = ctx.measureText("Kaleido").width;
  ctx.font = `500 34px ${family}`;
  ctx.fillStyle = t1;
  ctx.fillText("fi", nameX + kw, nameY);

  /* -------------------------------------------------------------------- hero */
  ctx.letterSpacing = "0.1em";
  ctx.font = `500 26px ${family}`;
  ctx.fillStyle = t3;
  ctx.fillText("NET POSITION", PAD, 360);
  ctx.letterSpacing = "0px";

  fitText(ctx, d.netValue, 148, 500, family, INNER);
  ctx.fillStyle = t1;
  ctx.fillText(d.netValue, PAD, 500);

  /* ------------------------------------------------------------------- stats */
  /* The panel is deep on purpose. 4:5 gives 1350px of height for one figure and
     four stats, and the first pass left ~200px of dead ground between the panel
     and the footer — which reads as a card that ran out of things to say. The
     stats take the space instead: generous cells are what the trading-app cards
     this imitates do with the same ratio. */
  const gridY = 620;
  const gridH = 540;
  ctx.fillStyle = card;
  panel(ctx, PAD, gridY, INNER, gridH, 28);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  panel(ctx, PAD, gridY, INNER, gridH, 28);
  ctx.stroke();

  /* Two columns, two rows, and the loop reads `stats` positionally: the caller
     decides the order, and a fifth stat would be dropped rather than drawn over
     the footer. */
  const colW = INNER / 2;
  const rowH = gridH / 2;
  ctx.beginPath();
  ctx.moveTo(PAD + colW, gridY + 28);
  ctx.lineTo(PAD + colW, gridY + gridH - 28);
  ctx.moveTo(PAD + 36, gridY + rowH);
  ctx.lineTo(PAD + INNER - 36, gridY + rowH);
  ctx.strokeStyle = line;
  ctx.stroke();

  d.stats.slice(0, 4).forEach((st, i) => {
    const cx = PAD + (i % 2) * colW + 48;
    const cy = gridY + Math.floor(i / 2) * rowH;
    ctx.letterSpacing = "0.08em";
    ctx.font = `500 24px ${family}`;
    ctx.fillStyle = t3;
    ctx.fillText(st.label.toUpperCase(), cx, cy + 100);
    ctx.letterSpacing = "0px";
    fitText(ctx, st.value, 58, 500, family, colW - 96);
    ctx.fillStyle = t1;
    ctx.fillText(st.value, cx, cy + 176);
  });

  /* ------------------------------------------------------------------ footer */
  ctx.font = `400 28px ${family}`;
  /* Nothing at all when there is no network to name — the old `?? "Kaleido"`
     printed the wordmark a second time, three inches under the first one. */
  if (d.network) {
    ctx.fillStyle = t2;
    ctx.fillText(d.network, PAD, H - PAD);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = t3;
  ctx.fillText("kaleidofi.xyz", W - PAD, H - PAD);
  ctx.textAlign = "left";

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
