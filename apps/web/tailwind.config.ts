import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  darkMode: ["class"], // <html class="dark"> o "light", lo pone theme-provider antes del primer paint
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        /* Titulares: la misma Inter, en peso 600. `font-display` se conserva
           como alias para no tocar los usos existentes; ya no es otra fuente. */
        display: ["var(--font-inter)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        /* Geist Mono: código, ids, SKUs, firmas. Nunca prosa. */
        mono: ["var(--font-mono)", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      /* Escala tipográfica ÚNICA del portal (DESIGN-SYSTEM.md §1 "Tipografía").
         Siete peldaños de UI + display para páginas públicas:

           h1 24→28 · h2 18 · h3 16 · body 16 · body-sm 14 · caption 13 ·
           micro 12 · micro-uppercase 11 · code-md/sm 14/13 (mono)

         Los alias de Tailwind (`text-xs/sm/base/lg`) se REMAPEAN a esta
         escala para que los cientos de usos existentes caigan en un peldaño
         real: `text-xs` ya no es 12px sino caption (13px) — el 12 se reserva
         a `micro` (chips, contadores). En código nuevo usa el nombre
         semántico (`text-caption`, no `text-xs`).

         Display en 600 con tracking negativo suave (nunca por debajo de
         -0.03em) e interlínea ≥1.05. Cuerpo 16/1.5, nunca comprimido. Los
         `clamp()` escriben primero el valor móvil (<480px). */
      fontSize: {
        /* --- Display: solo páginas públicas y bandas hero. --- */
        "display-xxl": ["clamp(2.25rem, 6vw, 4.5rem)", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "600" }],
        "display-xl": ["clamp(2rem, 5vw, 3.5rem)", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "600" }],
        "display-lg": ["clamp(1.75rem, 4vw, 3rem)", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
        "display-md": ["clamp(1.625rem, 3vw, 2.25rem)", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" }],

        /* --- Encabezados del portal operativo. --- */
        /** h1 de pantalla (`PageHeader`): 24px en móvil, 28px desde ~1024px. */
        h1: ["clamp(1.5rem, 1.25rem + 0.8vw, 1.75rem)", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" }],
        /** h2: título de `Section`, `Card`, `Sheet`, diálogo, estado vacío. */
        h2: ["1.125rem", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "600" }],
        /** h3: sub-bloques dentro de una sección, título de tarjeta chica. */
        h3: ["1rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "600" }],
        /* Alias históricos de titulares; en código nuevo usa h1/h2/h3. */
        headline: ["1.375rem", { lineHeight: "1.3", letterSpacing: "0", fontWeight: "600" }],
        subhead: ["1.125rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "400" }],

        /* --- Cuerpo. --- */
        "body-lg": ["1.125rem", { lineHeight: "1.5", letterSpacing: "0" }],
        /** Prosa, lead bajo el h1, descripciones de ayuda. */
        body: ["1rem", { lineHeight: "1.5", letterSpacing: "0" }],
        /** Tamaño de UI por defecto: nav, celdas, inputs, botones, menús, etiquetas. */
        "body-sm": ["0.875rem", { lineHeight: "1.5", letterSpacing: "0" }],
        "body-sm-medium": ["0.875rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "500" }],
        /** Ayuda, error, pista, tooltip, migas, cabecera de tabla (uppercase). */
        caption: ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0" }],
        /** Chips, contadores, marcas de tiempo. Nunca prosa. */
        micro: ["0.75rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" }],
        /** Rótulos de grupo (sidebar, menús), "REQUERIDO". Mínimo de la escala. */
        "micro-uppercase": ["0.6875rem", { lineHeight: "1.4", letterSpacing: "0.5px", fontWeight: "600" }],
        /* Solo tamaño: la familia la pone `font-mono`. */
        "code-md": ["0.875rem", { lineHeight: "1.5", letterSpacing: "0" }],
        "code-sm": ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0" }],

        /* --- Alias de Tailwind remapeados a la escala (ver nota arriba). --- */
        xs: ["0.8125rem", { lineHeight: "1.4" }], // = caption
        sm: ["0.875rem", { lineHeight: "1.5" }], // = body-sm
        base: ["1rem", { lineHeight: "1.5" }], // = body
        lg: ["1.125rem", { lineHeight: "1.4" }], // = h2 (sin peso)
      },
      letterSpacing: {
        display: "-0.02em",
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
        // Marca: menta. `brand` es el relleno (con `brand-foreground` = tinta
        // oscura), `brand-text` la menta profunda para texto/enlace/foco y
        // `brand-soft` el tinte de fondo (éxito, confirmación).
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
          text: "hsl(var(--brand-text))",
          soft: "hsl(var(--brand-soft))",
        },
        // Píldora blanca sobre bandas hero (`.hero-dark`), igual en ambos modos.
        "on-hero": {
          DEFAULT: "hsl(var(--on-hero))",
          foreground: "hsl(var(--on-hero-foreground))",
        },
        // `primary` = menta profunda: texto de enlace, foco, selección (≥4.5:1).
        // `primary-strong` = píldora de CTA (negra en claro, blanca en oscuro).
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
        // Escala semántica de estado. Un solo acento de marca (brand);
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
        // Píldora dominante (negra en claro / blanca en oscuro). Misma que
        // `primary-strong`: un solo lenguaje de CTA.
        cta: {
          DEFAULT: "hsl(var(--cta))",
          hover: "hsl(var(--cta-hover))",
          active: "hsl(var(--cta-active))",
          foreground: "hsl(var(--cta-foreground))",
        },
        // Coral de resalte (insignias "nuevo", "recomendado"). Siempre con
        // tinta oscura (`highlight-foreground`), nunca texto blanco encima.
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
      // Escala: xs 4 (chips de código) · sm 6 (ítems de nav, insignias) ·
      // md 8 (inputs, búsqueda, código) · lg/card 12 (tarjetas) · xl/spotlight
      // 16 (paneles grandes, hero) · 2xl/xxl 24 (vitrinas) · pill (botones).
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "var(--radius)",
        lg: "var(--radius-card)",
        xl: "16px",
        "2xl": "24px",
        xxl: "24px",
        card: "var(--radius-card)",
        spotlight: "var(--radius-spotlight)",
        pill: "var(--radius-pill)",
      },
      // Elevación: 0 plano (hairline) · 1 tile al hover · 2 menús/tooltips ·
      // 3 diálogos/sheets · brand = tarjeta destacada. `airbnb*` son alias.
      boxShadow: {
        "1": "var(--shadow-1)",
        "2": "var(--shadow-2)",
        "3": "var(--shadow-3)",
        brand: "var(--shadow-brand)",
        airbnb: "var(--shadow-airbnb)",
        "airbnb-lg": "var(--shadow-airbnb-lg)",
        selected: "var(--shadow-selected)",
        "elevation-2": "var(--shadow-2)",
      },
      // Degradados solo para bandas hero. Los `gradient-*` viejos son alias
      // de `hero-dark` mientras se migran los usos.
      backgroundImage: {
        "hero-dark": "var(--gradient-hero-dark)",
        "hero-sky": "var(--gradient-hero-sky)",
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
  plugins: [
    require("tailwindcss-animate"),
    /* `inactive:` = deshabilitado de verdad (no `loading`, que también pone
       `disabled` pero lleva `aria-busy` y debe conservar su color). */
    plugin(({ addVariant }) => {
      addVariant("inactive", '&:disabled:not([aria-busy="true"])');
    }),
  ],
};

export default config;
