"use client";
import { useState } from "react";
import Link from "next/link";
import { Bot, MessagesSquare, Plug, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { ChannelsSummary } from "./_components/channels-summary";
import { ConnectionsTable } from "./_components/connections-table";
import { ConnectSheet } from "./_components/connect-sheet";
import { EvolutionOnboardSheet } from "./_components/evolution-onboard-sheet";
import { useConnections, useMe } from "./_components/use-channels";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CHANNEL_LABELS } from "@/components/ui/status-badge";

export default function ChannelsPage() {
  const me = useMe();
  const connections = useConnections();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [evolutionOpen, setEvolutionOpen] = useState(false);

  function startMeta() {
    setChooserOpen(false);
    setMetaOpen(true);
  }
  function startEvolution() {
    setChooserOpen(false);
    setEvolutionOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Canales"
        description="Conecta WhatsApp (Meta o Evolution). Los hilos que llegan por estos números se atienden en Conversaciones."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/conversations">
                <MessagesSquare aria-hidden className="h-4 w-4" />
                Ver conversaciones
              </Link>
            </Button>
            <Button onClick={() => setChooserOpen(true)}>
              <Plug aria-hidden className="h-4 w-4" />
              Conectar canal
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <ChannelsSummary connections={connections} />
        <ConnectionsTable query={connections} onConnect={() => setChooserOpen(true)} />
      </div>

      <Sheet open={chooserOpen} onOpenChange={setChooserOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>¿Cómo quieres conectar tu WhatsApp?</SheetTitle>
            <SheetDescription>
              Para Evolution puedes dar de alta el número desde aquí mismo, sin entrar al panel
              externo.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={startEvolution}
              className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{CHANNEL_LABELS.EVOLUTION} — Alta con QR</div>
                <p className="text-sm text-muted-foreground">
                  Creamos la instancia en Evolution, configuramos el webhook y te damos un QR
                  para escanear con el WhatsApp del cliente. Sin tocar el panel de Evolution.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={startMeta}
              className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{CHANNEL_LABELS.META} — API oficial</div>
                <p className="text-sm text-muted-foreground">
                  Pegar el token y el ID del número de WhatsApp Business. Requiere una cuenta
                  configurada en Meta.
                </p>
              </div>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <ConnectSheet open={metaOpen} onOpenChange={setMetaOpen} tenantSlug={me.data?.tenantSlug} />
      <EvolutionOnboardSheet open={evolutionOpen} onOpenChange={setEvolutionOpen} />
    </div>
  );
}
