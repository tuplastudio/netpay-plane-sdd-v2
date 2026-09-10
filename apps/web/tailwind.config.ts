import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Circular", "-apple-system", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        canvas: "hsl(var(--canvas))",
        "body-text": "hsl(var(--body-text))",
        "legal-link": "hsl(var(--legal-link))",
        hairline: {
          DEFAULT: "hsl(var(--border))",
          soft: "hsl(var(--border-soft))",
          strong: "hsl(var(--border-strong))",
        },
        // Acento de dos niveles. `primary` es ornamento (3.52:1: pasa 1.4.11,
        // no 1.4.3); `primary-strong` es el nivel que puede llevar texto o ser
        // tinta (5.20:1). Ver el bloque grande de globals.css.
        primary: {
          DEFAULT: "hsl(var(--primary))",
          strong: "hsl(var(--primary-strong))",
          "strong-hover": "hsl(var(--primary-strong-hover))",
          "strong-active": "hsl(var(--primary-strong-active))",
          /** Alias histórico de `strong-active`; no usar en código nuevo. */
          active: "hsl(var(--primary-active))",
          disabled: "hsl(var(--primary-disabled))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          soft: "hsl(var(--muted-soft))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        // Escala semántica de estado. Un solo acento de marca (primary);
        // estos tonos solo comunican estado. Ver globals.css.
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          active: "hsl(var(--destructive-active))",
          foreground: "hsl(var(--destructive-foreground))",
          subtle: "hsl(var(--destructive-subtle))",
          "subtle-foreground": "hsl(var(--destructive-subtle-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          subtle: "hsl(var(--success-subtle))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          subtle: "hsl(var(--warning-subtle))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          subtle: "hsl(var(--info-subtle))",
        },
        neutral: {
          DEFAULT: "hsl(var(--neutral))",
          foreground: "hsl(var(--neutral-foreground))",
          subtle: "hsl(var(--neutral-subtle))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        airbnb: "var(--shadow-airbnb)",
        "airbnb-lg": "var(--shadow-airbnb-lg)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;