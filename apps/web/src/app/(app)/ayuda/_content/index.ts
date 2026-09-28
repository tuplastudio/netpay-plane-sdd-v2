import type { HelpArticle, HelpBlock, HelpCategory } from "./types";
import { primerosPasos } from "./primeros-pasos";
import { catalogo } from "./catalogo";
import { clientes } from "./clientes";
import { cotizacionesPedidos } from "./cotizaciones-pedidos";
import { pagos } from "./pagos";
import { envios } from "./envios";
import { whatsapp } from "./whatsapp";
import { agente } from "./agente";
import { notificaciones } from "./notificaciones";
import { empresaSeguridad } from "./empresa-seguridad";
import { apiKeysMcp } from "./api-keys-mcp";
import { reportesUso } from "./reportes-uso";
import { glosario } from "./glosario";
import { plataforma } from "./plataforma";

/** Orden en el que aparecen en el nav lateral y en el índice. */
export const HELP_CATEGORIES: HelpCategory[] = [
  primerosPasos,
  catalogo,
  clientes,
  cotizacionesPedidos,
  pagos,
  envios,
  whatsapp,
  agente,
  notificaciones,
  empresaSeguridad,
  apiKeysMcp,
  reportesUso,
  glosario,
  plataforma,
];

export function allHelpArticles(): Array<HelpArticle & { categorySlug: string; categoryTitle: string }> {
  return HELP_CATEGORIES.flatMap((cat) =>
    cat.articles.map((a) => ({ ...a, categorySlug: cat.slug, categoryTitle: cat.title })),
  );
}

export function findHelpArticle(
  slug: string,
): (HelpArticle & { categorySlug: string; categoryTitle: string }) | null {
  return allHelpArticles().find((a) => a.slug === slug) ?? null;
}

export function articlesBySlug(slugs: string[]): HelpArticle[] {
  const all = allHelpArticles();
  return slugs
    .map((s) => all.find((a) => a.slug === s))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
}

function blockText(block: HelpBlock): string {
  switch (block.type) {
    case "p":
    case "h3":
    case "code":
      return block.text;
    case "callout":
      return `${block.title ?? ""} ${block.text}`;
    case "list":
    case "steps":
      return block.items.join(" ");
    case "table":
      return [...block.headers, ...block.rows.flat()].join(" ");
    case "faq":
      return block.items.map((i) => `${i.q} ${i.a}`).join(" ");
    case "glossary":
      return block.items.map((i) => `${i.term} ${i.definition}`).join(" ");
  }
}

/** Quita acentos y pasa a minúsculas, para que "facturacion" encuentre "facturación". */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const searchIndex = new Map<string, { head: string; body: string }>();

/**
 * Texto buscable de un artículo, ya normalizado. `head` (título, resumen,
 * palabras clave) pesa más que `body` (todo el contenido) al ordenar.
 */
export function articleSearchText(article: HelpArticle): { head: string; body: string } {
  const cached = searchIndex.get(article.slug);
  if (cached) return cached;
  const entry = {
    head: normalizeForSearch([article.title, article.summary, ...(article.keywords ?? [])].join(" ")),
    body: normalizeForSearch(article.body.map(blockText).join(" ")),
  };
  searchIndex.set(article.slug, entry);
  return entry;
}
