import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Section } from "@/components/app/section";
import { HELP_CATEGORIES } from "./_content";
import { ON_HERO_MUTED, ON_HERO_PILL } from "@/lib/hero";
import { cn } from "@/lib/utils";

const START_HERE = [
  { slug: "que-es-easy-sell", label: "Qué es Easy Sell" },
  { slug: "lista-de-arranque", label: "Lista de arranque: tu primer día" },
  { slug: "recorrido-del-panel", label: "Recorrido del panel" },
];

export default function AyudaIndexPage() {
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="ayuda-empieza"
        className="hero-dark p-6 sm:p-8"
      >
        <p className={cn("text-caption font-medium", ON_HERO_MUTED)}>Empieza aquí</p>
        <h1
          id="ayuda-empieza"
          className="mt-2 max-w-xl font-display text-display-lg"
        >
          Todo lo que necesitas para vender con Easy Sell.
        </h1>
        <p className={cn("mt-3 max-w-xl text-body", ON_HERO_MUTED)}>
          Guías paso a paso de cada pantalla, con ejemplos y soluciones a los problemas más comunes. Usa el
          buscador de la izquierda si ya sabes lo que buscas.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {START_HERE.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/ayuda/${item.slug}`}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-body-sm-medium transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  ON_HERO_PILL,
                )}
              >
                {item.label}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {HELP_CATEGORIES.map((cat) => (
        <Section
          key={cat.slug}
          title={cat.title}
          description={cat.articles.length === 1 ? "1 guía" : `${cat.articles.length} guías`}
          headerIcon={cat.slug === "plataforma" ? <ShieldCheck className="h-4 w-4" /> : undefined}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {cat.articles.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/ayuda/${a.slug}`}
                  className="block h-full rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-body font-medium text-foreground">{a.title}</span>
                  <span className="mt-1 block text-caption text-muted-foreground">{a.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
