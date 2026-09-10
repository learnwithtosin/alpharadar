import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

// shadcn/ui standard theme extension (CSS-variable driven), scoped to this
// app. No component files are added yet — configuration only.
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          // <alpha-value> placeholder (not a bare hsl(var(..))) so
          // opacity modifiers work — bg-destructive/10, border-destructive/50 —
          // needed now that this token is reused for HIGH/CRITICAL risk tiles.
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // AlphaRadar's own accent (0014) — distinct from shadcn's `accent`
        // (a plain hover/highlight neutral, untouched above). Reserved for
        // a few big, meaningful moments: the score, the CTA, LOW risk.
        signal: {
          DEFAULT: "hsl(var(--signal) / <alpha-value>)",
          foreground: "hsl(var(--signal-foreground))",
        },
        warn: "hsl(var(--warn) / <alpha-value>)",
        unknown: "hsl(var(--unknown) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
