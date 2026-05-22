import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: "#FFFFFF",
        foreground: "#1C2B3A",
        brand: {
          dark: "#1C2B3A",
          red: "#E8202A",
          cta: "#B64B43",
          "cta-hover": "#9E3F38",
          black: "#1a1a1a",
          light: "#F8F9FA",
          muted: "#6B7280",
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
