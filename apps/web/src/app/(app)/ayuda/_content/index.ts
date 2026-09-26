import type { HelpArticle, HelpCategory } from "./types";
import { primerosPasos } from "./primeros-pasos";
import { catalogo } from "./catalogo";
import { clientes } from "./clientes";
import { cotizacionesPedidos } from "./cotizaciones-pedidos";
import { pagos } from "./pagos";
import { envios } from "./envios";
import { whatsapp } from "./whatsapp";
import { notificaciones } from "./notificaciones";
import { empresaSeguridad } from "./empresa-seguridad";
import { apiKeysMcp } from "./api-keys-mcp";
import { reportesUso } from "./reportes-uso";
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
  notificaciones,
  empresaSeguridad,
  apiKeysMcp,
  reportesUso,
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
