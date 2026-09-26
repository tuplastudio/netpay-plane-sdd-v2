"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FileQuestion } from "lucide-react";
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
          description="Puede que el link esté mal escrito o la guía haya cambiado de nombre."
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
        <Section title="Relacionado" density="compact">
          <ul className="space-y-1">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/ayuda/${r.slug}`} className="text-sm font-medium text-primary-strong hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
