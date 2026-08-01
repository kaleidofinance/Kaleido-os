import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/common/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  theme: {
    screens: {
      sm: "1px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },
    keyframes: {
      marquee: {
        "0%": { transform: "translateX(0%)" },
        "100%": { transform: "translateX(-50%)" },
      },
    },
    animation: {
      marquee: "marquee 30s linear infinite",
    },
    extend: {
      colors: {
        // --- Legacy palette. Kept so existing markup keeps working;
        // migrate off these onto the semantic tokens below. ---
        background: "#111714",
        sidebarBg: "#1a211d",
        borderColor: "#29382f",
        board: "#000000",
        price: "#9eb7a8",
        inputPanel: "#0a0f0a",
        borderline: "#22C55E1A",
        tokenSelector: "#38e07b",
        modal: "#000000",

        // --- Semantic tokens. Defined in src/app/tokens.css. ---
        surface: {
          DEFAULT: "var(--surface)",
          base: "var(--surface-base)",
          sunken: "var(--surface-sunken)",
          raised: "var(--surface-raised)",
          hover: "var(--surface-hover)",
        },
        edge: {
          DEFAULT: "var(--border-subtle)",
          strong: "var(--border-strong)",
          accent: "var(--border-accent)",
        },
        content: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          onAccent: "var(--text-on-accent)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          pressed: "var(--accent-pressed)",
          subtle: "var(--accent-subtle)",
          alt: "var(--accent-alt)",
          altHover: "var(--accent-alt-hover)",
          altSubtle: "var(--accent-alt-subtle)",
        },
        positive: {
          DEFAULT: "var(--positive)",
          subtle: "var(--positive-subtle)",
        },
        negative: {
          DEFAULT: "var(--negative)",
          subtle: "var(--negative-subtle)",
        },
        warning: "var(--warning)",
        danger: "var(--danger)",
      },

      fontFamily: {},
    },
  },
  plugins: [],
};
export default config;
