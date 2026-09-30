import type { MetadataRoute } from "next";
import { allHelpArticles } from "./(app)/ayuda/_content";

/**
 * Sitemap de Easy Sell (Tupla). Solo incluye rutas que tienen sentido para
 * indexación pública:
 *
 * - `/` y `/ayuda`: índice del centro de ayuda.
 * - `/ayuda/[slug]`: cada artículo individual (las 6 categorías × ~3-5
 *   artículos cada una = ~50 URLs). Es lo que los usuarios buscan cuando
 *   googlean "Easy Sell API key" o "MCP Easy Sell", y es la fuente principal
 *   para `llms-full.txt`.
 *
 * Rutas que NO incluimos a propósito:
 * - `/login`, `/recover`, `/reset`, `/accept-invite`, `/mfa/verify`: son
 *   páginas funcionales de auth, no contenido indexable.
 * - `/checkout/[token]`, `/quotes/public/[token]`,
 *   `/orders/public/track/[token]`: páginas con tokens opacos que solo
 *   visita el destinatario del link; indexarlas filtraría URLs con secretos.
 * - `/admin/*`, `/dashboard/*`, `/super-admin/*`, `/customers/*` etc.:
 *   contenido autenticado, no público.
 *
 * El dominio se toma de NEXT_PUBLIC_SITE_URL (default easysell.tupla.dev).
 * En staging/local el sitemap sigue funcionando — Next.js sirve el
 * sitemap relativo al host actual.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://easysell.tupla.dev";
  const now = new Date();

  const articles = allHelpArticles().map((a) => ({
    url: `${base}/ayuda/${a.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: `${base}/ayuda`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: base,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    ...articles,
  ];
}