import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "sov-blue": "#6cb2ff",
        "sov-orange": "#f97316",
      },
    },
  },
  plugins: [],
} satisfies Config;



