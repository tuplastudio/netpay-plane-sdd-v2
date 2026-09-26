/**
 * Contenido del centro de ayuda: estático, no sale de la API. Cada categoría
 * es un archivo (`_content/<categoria>.ts`) que exporta un `HelpCategory`;
 * `_content/index.ts` los junta en orden. `HelpBlock` es un mini-lenguaje de
 * bloques (no markdown) para no traer una dependencia de render solo por
 * esto — cada bloque usa los mismos componentes visuales del resto del panel
 * (`Alert`, listas, `<code>`), nunca HTML crudo.
 */

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "callout"; tone: "info" | "warning" | "success"; title?: string; text: string }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

export type HelpAudience = "owner" | "super_admin" | "both";

export interface HelpArticle {
  slug: string;
  title: string;
  /** Una línea: aparece en el índice y en resultados de búsqueda. */
  summary: string;
  audience: HelpAudience;
  body: HelpBlock[];
  /** Slugs de artículos relacionados, mostrados al final. */
  related?: string[];
  /**
   * Sinónimos o variantes que alguien podría teclear pero que no aparecen
   * tal cual en el título/resumen (p. ej. "reembolso" para el artículo
   * "Reembolsar un pago" — la búsqueda es texto literal, no entiende que
   * son la misma palabra). Se busca junto con título y resumen.
   */
  keywords?: string[];
}

export interface HelpCategory {
  slug: string;
  title: string;
  articles: HelpArticle[];
}
