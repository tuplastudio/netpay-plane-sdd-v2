"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, FileQuestion, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/app/section";
import { HelpBlocks } from "../_components/help-blocks";
import { articlesBySlug, findHelpArticle } from "../_content";

const AUDIENCE_LABEL = {
  owner: null,
  super_admin: "Solo super-admin",
  both: null,
} as const;

export default function AyudaArticlePage() {
  const params = useParams<{ slug: string }>();
  const article = findHelpArticle(params.slug);

  if (!article) {
    return (
      <Section>
        <EmptyState
          icon={<FileQuestion className="h-6 w-6" />}
          title="No encontramos esa guía"
          description="Puede que el link esté mal escrito o la guía haya cambiado de nombre. Prueba el buscador de la izquierda."
          action={
            <Link href="/ayuda" className="text-sm font-medium text-primary-strong hover:underline">
              Volver al índice de ayuda
            </Link>
          }
        />
      </Section>
    );
  }

  const audienceLabel = AUDIENCE_LABEL[article.audience];
  const related = article.related ? articlesBySlug(article.related) : [];

  return (
    <div className="space-y-4">
      <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
        <Link href="/ayuda" className="hover:text-foreground hover:underline">
          Ayuda
        </Link>
        <span aria-hidden>/</span>
        <span>{article.categoryTitle}</span>
      </nav>

      <Section
        title={
          <span className="flex flex-wrap items-center gap-2">
            {article.title}
            {audienceLabel ? (
              <Badge variant="info" size="sm">
                {audienceLabel}
              </Badge>
            ) : null}
          </span>
        }
        description={article.summary}
      >
        <HelpBlocks blocks={article.body} />
      </Section>

      {related.length > 0 ? (
        <Section title="Sigue leyendo" density="compact">
          <ul className="grid gap-2 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/ayuda/${r.slug}`}
                  className="flex h-full items-center justify-between gap-3 rounded-[15px] border bg-card p-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {r.title}
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section density="compact">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            ¿No resolviste tu duda? Escríbenos y te ayudamos.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/soporte"
              className="inline-flex min-h-[40px] items-center rounded-full bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
            >
              Ir a Soporte
            </Link>
            <a
              href="mailto:hola@tupla.dev"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-medium text-primary-strong hover:underline"
            >
              <Mail aria-hidden className="h-4 w-4" />
              hola@tupla.dev
            </a>
          </div>
        </div>
      </Section>
    </div>
  );
}
