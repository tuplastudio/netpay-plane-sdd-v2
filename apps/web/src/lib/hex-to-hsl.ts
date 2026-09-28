/**
 * Conversión de color hex (#RGB o #RRGGBB) a la tripleta HSL "H S% L%" que
 * consume el sistema de tokens (definidos en `globals.css` como tripletas HSL
 * y consumidos por Tailwind como `hsl(var(--token))`).
 *
 * El matiz se redondea a entero; saturación y luminosidad se redondean a 0.1%.
 * Suficiente para pintar — los tokens originales también están redondeados.
 */
export function hexToHsl(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const raw = m[1]!;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  const H = Math.round(h * 360);
  const S = Math.round(s * 1000) / 10;
  const L = Math.round(l * 1000) / 10;
  return `${H} ${S}% ${L}%`;
}

/**
 * Ajusta la luminosidad de una tripleta HSL por un delta (positivo = más
 * claro, negativo = más oscuro). Útil para derivar hover/active del color
 * de marca sin tener que parsear el HSL completo.
 */
export function hslShift(hsl: string, deltaL: number): string | null {
  const m = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(hsl);
  if (!m) return null;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  const next = Math.max(0, Math.min(100, l + deltaL));
  return `${h} ${s}% ${Math.round(next * 10) / 10}%`;
}
/**
 * Luminancia relativa WCAG (0 = negro, 1 = blanco) de un hex #RGB/#RRGGBB.
 * `null` si el hex no es válido.
 */
export function relativeLuminance(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const raw = m[1]!;
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Razón de contraste WCAG entre dos hex; `null` si alguno no es válido. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Tinta para texto sobre un relleno del color de marca del tenant: blanco si
 * el color es oscuro (L < 0.4), tinta ink si es claro. Devuelve el valor CSS.
 */
export function onTenantColor(hex: string): string {
  const l = relativeLuminance(hex);
  return l !== null && l < 0.4 ? "#ffffff" : "#0f1211";
}
