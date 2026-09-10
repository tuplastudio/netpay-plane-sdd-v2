import { Suspense } from "react";
import Link from "next/link";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/page-header";
import { ConversationsView } from "./_components/conversations-view";

/**
 * Bandeja de conversaciones de WhatsApp. Los filtros van en la URL, así que
 * el cuerpo (que usa `useSearchParams`) cuelga de un `Suspense`; el fallback
 * es el único skeleton que anuncia en la página.
 */
export default function ConversationsPage() {
  return (
    <div>
      <PageHeader
        title="Conversaciones"
        description="Hilos entrantes de WhatsApp: qué atiende el agente, qué atiende una persona y qué falta por contestar."
        actions={
          <Button asChild variant="outline">
            <Link href="/channels">
              <Radio aria-hidden className="h-4 w-4" />
              Canales
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<SkeletonText lines={3} announce label="Cargando las conversaciones…" />}>
        <ConversationsView />
      </Suspense>
    </div>
  );
}
