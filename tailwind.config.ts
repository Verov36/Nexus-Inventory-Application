import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nexus: {
          navy: "#0F2438",
          navydark: "#0A1826",
          steel: "#5B7286",
          steelfaint: "#8FA1B0",
          amber: "#E8A33D",
          ok: "#1F8A5C",
          warn: "#C4531D",
          danger: "#B4302B",
          paper: "#F4F5F3",
          line: "#E2E5E1",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-body)"],
        mono: ["var(--font-data)"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,36,56,0.06), 0 1px 8px rgba(15,36,56,0.04)",
        cardHover: "0 2px 4px rgba(15,36,56,0.08), 0 4px 16px rgba(15,36,56,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
