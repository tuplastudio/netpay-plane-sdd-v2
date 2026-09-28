import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Section } from "@/components/app/section";
import { HELP_CATEGORIES } from "./_content";

const START_HERE = [
  { slug: "que-es-atiende-ya", label: "Qué es Atiende ya" },
  { slug: "lista-de-arranque", label: "Lista de arranque: tu primer día" },
  { slug: "recorrido-del-panel", label: "Recorrido del panel" },
];

export default function AyudaIndexPage() {
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="ayuda-empieza"
        className="spotlight spotlight-violet p-6 text-white sm:p-8"
      >
        <p className="text-[13px] font-medium text-white/80">Empieza aquí</p>
        <h2
          id="ayuda-empieza"
          className="mt-2 max-w-xl font-display text-[2rem] font-medium leading-[1.05] tracking-[-0.04em] sm:text-[2.5rem]"
        >
          Todo lo que necesitas para vender con Atiende ya.
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-[1.5] text-white/85">
          Guías paso a paso de cada pantalla, con ejemplos y soluciones a los problemas más comunes. Usa el
          buscador de la izquierda si ya sabes lo que buscas.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {START_HERE.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/ayuda/${item.slug}`}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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
                  className="block h-full rounded-[15px] border bg-card p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-[15px] font-medium text-foreground">{a.title}</span>
                  <span className="mt-1 block text-[13px] leading-[1.45] text-muted-foreground">{a.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
