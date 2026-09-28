/**
 * Clases de apoyo para contenido montado sobre una banda `hero-dark`
 * (teal → menta, texto blanco en ambos modos).
 *
 * La píldora primaria del sistema (`cta` / `primary-strong`) es blanca en modo
 * oscuro pero NEGRA en modo claro: sobre el hero necesita ser siempre blanca,
 * por eso existen los tokens `on-hero` / `on-hero-foreground` (iguales en
 * ambos modos). Se pasa como `className` a `<Button>`: `tailwind-merge`
 * resuelve el conflicto con el relleno de la variante.
 */
export const ON_HERO_PILL =
  "bg-on-hero text-on-hero-foreground hover:bg-on-hero hover:text-on-hero-foreground active:bg-on-hero focus-visible:ring-on-hero focus-visible:ring-offset-transparent";

/** Texto secundario sobre `hero-dark`: blanco al 85 %, nunca menos (≥4.5:1 en el peor punto). */
export const ON_HERO_MUTED = "text-white/85";
