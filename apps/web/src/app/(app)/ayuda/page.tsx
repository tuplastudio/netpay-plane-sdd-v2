import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Section } from "@/components/app/section";
import { HELP_CATEGORIES } from "./_content";

export default function AyudaIndexPage() {
  return (
    <div className="space-y-6">
      <Section
        title="Empieza aquí"
        description="Si es tu primera vez en el panel, este es el mejor punto de partida."
      >
        <Link
          href="/ayuda/que-es-atiende-ya"
          className="flex items-center justify-between rounded-md border bg-card p-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Qué es Atiende ya
          <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground" />
        </Link>
      </Section>

      {HELP_CATEGORIES.map((cat) => (
        <Section
          key={cat.slug}
          title={cat.title}
          headerIcon={cat.slug === "plataforma" ? <ShieldCheck className="h-4 w-4" /> : undefined}
        >
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {cat.articles.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/ayuda/${a.slug}`}
                  className="block rounded-md border bg-card p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                >
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{a.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
