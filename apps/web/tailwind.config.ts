import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#0F3D3E", teal: { DEFAULT: "#2A8C80", light: "#CFE3E0" },
        amber: { DEFAULT: "#E39B2D", light: "#FBEBD2" }, pale: "#EEF4F3", ink: "#1F2933", muted: "#6B7B83",
      },
    },
  },
  plugins: [],
} satisfies Config;
