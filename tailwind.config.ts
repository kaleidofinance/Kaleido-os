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
        background: "#111714",
        sidebarBg: "#1a211d",
        borderColor: "#29382f",
        board: "#000000",
        price: "#9eb7a8",
        inputPanel: "#0a0f0a",
        borderline: "#22C55E1A",
        tokenSelector: "#38e07b",
        modal: "#000000",
      },

      fontFamily: {},
    },
  },
  plugins: [],
};
export default config;
