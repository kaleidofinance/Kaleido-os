"use client";

import { useState } from "react";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";

import s from "../pool.module.css";

/**
 * One half of an overlapping pair disc. Falls back to the three-letter
 * monogram, which is still the right answer for our own undeployed tokens.
 *
 * Extracted because it was byte-identical in two files — the pools table and the
 * positions list — and the detail page made three. The overlap itself is not
 * here: it comes from `.tki + .tki { margin-left: -10px }` in pool.module.css,
 * so two of these inside one `.pair` overlap and one on its own does not.
 *
 * Deliberately imports the section stylesheet rather than taking a className.
 * `.tki` carries the opaque 2px ring that separates the front disc from the one
 * behind it, and a caller free to swap that class could drop the ring and get
 * two marks that merge into each other.
 */
export default function PairIcon({ symbol, logoURI, allowSymbolIcon = true }: {
  symbol: string;
  logoURI?: string;
  /** False for an unregistered external address: a ticker is not an identity. */
  allowSymbolIcon?: boolean;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const remoteLogo = logoURI?.startsWith("https://") && failedLogo !== logoURI ? logoURI : null;
  const localLogo = allowSymbolIcon && hasTokenIcon(symbol);
  return (
    <span className={`${s.tki} ${remoteLogo || localLogo ? s.tkiArt : ""}`}>
      {remoteLogo ? (
        // Metadata can point at arbitrary image hosts; use a bounded native image
        // and fall back on error rather than requiring a Next image allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={remoteLogo} alt="" width={24} height={24} loading="lazy"
          referrerPolicy="no-referrer" onError={() => setFailedLogo(logoURI ?? null)}
          style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "contain" }} />
      ) : localLogo ? (
        <TokenIcon symbol={symbol} size={24} fallback={symbol.slice(0, 3)} />
      ) : symbol.slice(0, 3)}
    </span>
  );
}
