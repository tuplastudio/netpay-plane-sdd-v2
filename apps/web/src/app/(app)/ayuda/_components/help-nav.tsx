"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { HELP_CATEGORIES, articleSearchText, normalizeForSearch } from "../_content";

/**
 * Nav lateral del centro de ayuda: categorías con sus artículos y un filtro
 * de texto (cliente, sin red — todo el contenido ya está en el bundle).
 * Busca en título, resumen, palabras clave y en el cuerpo completo, sin
 * distinguir mayúsculas ni acentos. Cada palabra tecleada tiene que
 * aparecer; los artículos que la tienen en el título/resumen van primero.
 */
export function HelpNav() {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const terms = useMemo(() => normalizeForSearch(q).split(/\s+/).filter(Boolean), [q]);

  const categories = useMemo(() => {
    if (terms.length === 0) return HELP_CATEGORIES;
    return HELP_CATEGORIES.map((cat) => {
      const scored = cat.articles
        .map((a) => {
          const { head, body } = articleSearchText(a);
          let score = 0;
          for (const t of terms) {
            if (head.includes(t)) score += 2;
            else if (body.includes(t)) score += 1;
            else return null;
          }
          return { a, score };
        })
        .filter((x): x is { a: (typeof cat.articles)[number]; score: number } => x !== null)
        .sort((x, y) => y.score - x.score);
      return { ...cat, articles: scored.map((x) => x.a) };
    }).filter((cat) => cat.articles.length > 0);
  }, [terms]);

  const resultCount = categories.reduce((n, c) => n + c.articles.length, 0);

  return (
    <nav aria-label="Temas de ayuda" className="space-y-4 lg:sticky lg:top-6">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar en la ayuda…"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar en la ayuda"
        />
      </div>
      {terms.length > 0 ? (
        <p className="px-1 text-body-sm text-muted-foreground" aria-live="polite">
          {resultCount === 1 ? "1 guía encontrada" : `${resultCount} guías encontradas`}
        </p>
      ) : null}

      <div className="max-h-[calc(100vh-14rem)] space-y-5 overflow-y-auto pr-1">
        {categories.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            Sin resultados para “{q}”. Prueba con otra palabra, por ejemplo “factura”, “QR” o “reembolso”.
          </p>
        ) : (
          categories.map((cat) => (
            <div key={cat.slug}>
              <p className="mb-1.5 px-1 text-micro-uppercase uppercase text-muted-foreground">
                {cat.title}
              </p>
              <ul className="space-y-0.5">
                {cat.articles.map((a) => {
                  const href = `/ayuda/${a.slug}`;
                  const isActive = pathname === href;
                  return (
                    <li key={a.slug}>
                      <Link
                        href={href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "block rounded-full px-3 py-1.5 text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        {a.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
