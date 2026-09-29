import { PageHeader } from "@/components/app/page-header";
import { HelpNav } from "./_components/help-nav";

/**
 * Centro de ayuda: wiki estática (contenido en `_content/`, no sale de la
 * API). El layout pone la búsqueda + índice de temas a la izquierda y el
 * artículo (o el índice) a la derecha — mismo patrón de grid que
 * `admin/_components/admin-tabs.tsx`, pero con rutas propias por artículo
 * en vez de `?tab=`, para que cada guía tenga su propio link para compartir.
 */
export default function AyudaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        title="Centro de ayuda"
        description="Guías paso a paso de cada parte de Easy Sell: qué hace cada botón, ejemplos reales y qué hacer si algo sale mal."
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <HelpNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
