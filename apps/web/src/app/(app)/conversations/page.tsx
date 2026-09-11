import { Suspense } from "react";
import { SkeletonText } from "@/components/ui/skeleton";
import { FullHeightMain } from "@/components/app/app-shell";
import { ConversationsView } from "./_components/conversations-view";

/**
 * Bandeja de conversaciones de WhatsApp: Bandeja / Cola / Por agente y, al abrir
 * un hilo, el detalle con el contexto del cliente.
 *
 * La estructura se homologó a `/payments`: `PageHeader` con título, descripción
 * y contadores en `meta`; el cuerpo cuelga de `FullHeightMain` para que la
 * bandeja y el hilo resuelto a su propio scroll, igual que las sesiones de
 * pago. La página no scrollea de más.
 */
export default function ConversationsPage() {
  return (
    <>
      <FullHeightMain />
      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        <Suspense
          fallback={<SkeletonText lines={3} announce label="Cargando las conversaciones…" />}
        >
          <ConversationsView />
        </Suspense>
      </div>
    </>
  );
}
