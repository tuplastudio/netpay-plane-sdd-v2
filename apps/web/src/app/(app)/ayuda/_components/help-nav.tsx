"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { HELP_CATEGORIES } from "../_content";

/**
 * Nav lateral del centro de ayuda: categorías con sus artículos, con un
 * filtro de texto simple (cliente, sin llamada a red — todo el contenido ya
 * está en el bundle). Coincide en título O resumen, no distingue mayúsculas.
 */
export function HelpNav() {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const categories = useMemo(() => {
    if (!query) return HELP_CATEGORIES;
    return HELP_CATEGORIES.map((cat) => ({
      ...cat,
      articles: cat.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.summary.toLowerCase().includes(query) ||
          (a.keywords ?? []).some((k) => k.toLowerCase().includes(query)),
      ),
    })).filter((cat) => cat.articles.length > 0);
  }, [query]);

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

      <div className="max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto pr-1">
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin resultados para “{q}”.</p>
        ) : (
          categories.map((cat) => (
            <div key={cat.slug}>
              <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                          "block rounded-md px-3 py-1.5 text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
                          isActive
                            ? "bg-primary-subtle font-medium text-primary-strong"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
