import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"], // solo oscuro: <html class="dark"> fijo en layout.tsx
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "system-ui", "sans-serif"],
        /* Titulares (PageHeader, Section, hero de auth). Geist 500 con
           tracking muy negativo: la jerarquía la da el tamaño + tracking, no
           el peso. */
        display: ["var(--font-display)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      /* Escala display: el tracking negativo es proporcional al tamaño
         (~5% en los más grandes, ~1% en cuerpo). Si hace falta achicar,
         se baja el TAMAÑO, no el porcentaje. */
      fontSize: {
        "display-xxl": ["clamp(3rem, 8vw, 6.875rem)", { lineHeight: "0.85", letterSpacing: "-0.05em", fontWeight: "500" }],
        "display-xl": ["clamp(2.5rem, 6vw, 5.3rem)", { lineHeight: "0.95", letterSpacing: "-0.05em", fontWeight: "500" }],
        "display-lg": ["clamp(2rem, 4.5vw, 3.875rem)", { lineHeight: "1", letterSpacing: "-0.05em", fontWeight: "500" }],
        "display-md": ["clamp(1.625rem, 3vw, 2rem)", { lineHeight: "1.13", letterSpacing: "-0.031em", fontWeight: "500" }],
        headline: ["1.375rem", { lineHeight: "1.2", letterSpacing: "-0.036em", fontWeight: "700" }],
        subhead: ["1.5rem", { lineHeight: "1.3", letterSpacing: "0" }],
        "body-lg": ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        body: ["0.9375rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "body-sm": ["0.875rem", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "500" }],
        caption: ["0.8125rem", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "500" }],
        micro: ["0.75rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      },
      letterSpacing: {
        display: "-0.035em",
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
        // Acento de MAYOR intención (emitir cotización, generar pago, entrar).
        // Nunca decoración genérica: para eso sigue mandando `primary`.
        cta: {
          DEFAULT: "hsl(var(--cta))",
          hover: "hsl(var(--cta-hover))",
          active: "hsl(var(--cta-active))",
          foreground: "hsl(var(--cta-foreground))",
        },
        // Acento de resalte (insignias, superficies de feature). Nunca botones
        // de acción — para eso `primary` o `cta`.
        highlight: {
          DEFAULT: "hsl(var(--highlight))",
          strong: "hsl(var(--highlight-strong))",
          foreground: "hsl(var(--highlight-foreground))",
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
      // Escala: xs 4 · sm 6 · md 10 · lg 15 · xl 20 · 2xl/xxl 30 · pill.
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "var(--radius)",
        lg: "15px",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-spotlight)",
        xxl: "var(--radius-spotlight)",
        card: "var(--radius-card)",
        spotlight: "var(--radius-spotlight)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        airbnb: "var(--shadow-airbnb)",
        "airbnb-lg": "var(--shadow-airbnb-lg)",
        selected: "var(--shadow-selected)",
        "elevation-2": "var(--shadow-airbnb)",
      },
      backgroundImage: {
        "gradient-violet": "var(--gradient-violet)",
        "gradient-magenta": "var(--gradient-magenta)",
        "gradient-orange": "var(--gradient-orange)",
        "gradient-coral": "var(--gradient-coral)",
      },
      spacing: {
        hair: "1px",
        section: "96px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;