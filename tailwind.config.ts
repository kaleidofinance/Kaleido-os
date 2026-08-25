import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/common/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  theme: {
    // `sm: 1px` is deliberate-by-accident: it makes `sm:` mean "always"
    // rather than "≥640px". Hundreds of call sites now depend on that
    // reading, so correcting it would silently change every one of them.
    // Left as-is; treat `sm:` as unconditional when writing new markup.
    screens: {
      sm: "1px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },

    extend: {
      // keyframes/animation belong under `extend`. At `theme` root they
      // REPLACE Tailwind's built-ins, which is why `animate-spin` and
      // `animate-pulse` did not exist in this project.
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        marquee: "marquee 30s linear infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};
export default config;
