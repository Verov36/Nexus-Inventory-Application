import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nexus: {
          navy: "#0F2438",
          navydark: "#0A1826",
          steel: "#3E5266",
          amber: "#E8A33D",
          ok: "#1F8A5C",
          warn: "#C4531D",
          danger: "#B4302B",
          paper: "#F4F5F3",
        },
      },
    },
  },
  plugins: [],
};

export default config;
