/**
 * A dropdown caret.
 *
 * An SVG, not the `▾` (U+25BE) glyph it replaces: that triangle renders as a thin
 * dash in some system fonts, so a "Select token" pill looked like it carried a
 * stray hyphen rather than a dropdown. Drawn with `currentColor`, so the caller's
 * text colour drives it and a `className` (the existing `.cv` / `.caret` classes)
 * still positions it.
 */
export default function Chevron({
  size = 11,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
