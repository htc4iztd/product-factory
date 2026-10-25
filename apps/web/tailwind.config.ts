import type { Config } from "tailwindcss";

// 落ち着いた無彩色を土台に、操作できる所だけアクセント色（brand）を使う
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#f1f2fd", 100: "#e3e5fb", 200: "#c9cdf7", 500: "#6366f1", 600: "#5457e0", 700: "#4547c4" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Hiragino Sans",
          "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Meiryo", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        pop: "0 8px 24px rgba(16,24,40,.10), 0 2px 6px rgba(16,24,40,.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
