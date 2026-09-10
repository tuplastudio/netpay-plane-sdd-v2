"use client";
import { useState } from "react";
import Link from "next/link";
import { MessagesSquare, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { ChannelsSummary } from "./_components/channels-summary";
import { ConnectionsTable } from "./_components/connections-table";
import { ConnectSheet } from "./_components/connect-sheet";
import { useConnections, useMe } from "./_components/use-channels";

export default function ChannelsPage() {
  const me = useMe();
  const connections = useConnections();
  const [connectOpen, setConnectOpen] = useState(false);

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
            <Button onClick={() => setConnectOpen(true)}>
              <Plug aria-hidden className="h-4 w-4" />
              Conectar canal
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <ChannelsSummary connections={connections} />
        <ConnectionsTable query={connections} onConnect={() => setConnectOpen(true)} />
      </div>

      <ConnectSheet
        open={connectOpen}
        onOpenChange={setConnectOpen}
        tenantSlug={me.data?.tenantSlug}
      />
    </div>
  );
}
