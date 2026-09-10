import { Suspense } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/page-header";
import { AdminTabs } from "./_components/admin-tabs";

/**
 * Administración del tenant. Solo composición: cada pestaña vive en
 * `_components/*-section.tsx` y `AdminTabs` sincroniza la activa con `?tab=`.
 *
 * `useSearchParams` obliga a un límite de `Suspense` para que la ruta pueda
 * prerenderizarse; el fallback es el único skeleton que anuncia en la página.
 */
export default function AdminPage() {
  return (
    <div>
      <PageHeader
        title="Administración"
        description="Empresa, marca, usuarios, API keys, notificaciones y seguridad del tenant."
        actions={
          <Button asChild variant="outline">
            <Link href="/agent">
              <Bot className="h-4 w-4" />
              Consola del agente
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<SkeletonText lines={3} announce label="Cargando la administración…" />}>
        <AdminTabs />
      </Suspense>
    </div>
  );
}
