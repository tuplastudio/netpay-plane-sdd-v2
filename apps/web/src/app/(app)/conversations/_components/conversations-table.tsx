"use client";
import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Bot, MessagesSquare, SearchX, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CONVERSATIONS_LIMIT,
  providerLabel,
  useHandoff,
  useReturnToAgent,
  type Conversation,
  type ConversationList,
} from "./use-conversations";

/**
 * Hilos de WhatsApp y su estado de atención. La fila abre el panel del hilo;
 * "Transferir" saca la conversación del agente y la asigna a quien opera el
 * portal; "Devolver" hace lo contrario (con confirmación, porque el bot
 * retoma el hilo al instante). Los filtros viven en la URL y los aplica el
 * API; aquí solo se pinta lo que llega.
 */
export function ConversationsTable({
  query,
  filtered,
  userId,
  onOpenConversation,
  onClearFilters,
}: {
  query: UseQueryResult<ConversationList>;
  /** Hay algún filtro activo: cambia el vacío y ofrece limpiarlos. */
  filtered: boolean;
  /** Id de quien opera el portal; sin él no se puede transferir. */
  userId: string | undefined;
  onOpenConversation: (conversation: Conversation) => void;
  onClearFilters: () => void;
}) {
  const handoff = useHandoff(userId);
  const returnToAgent = useReturnToAgent();
  const [returnTarget, setReturnTarget] = useState<Conversation | null>(null);
  const rows = query.data?.data;
  const capped = (rows?.length ?? 0) >= CONVERSATIONS_LIMIT;

  const columns: Array<DataTableColumn<Conversation>> = [
    {
      key: "phone",
      header: "Cliente",
      cell: (c) => <span className="font-mono text-xs">{c.externalPhone}</span>,
    },
    {
      key: "channel",
      header: "Canal",
      width: "10rem",
      cell: (c) => (
        <span className="text-muted-foreground">{providerLabel(c.connection.provider)}</span>
      ),
    },
    {
      key: "status",
      header: "Atención",
      width: "18rem",
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={c.status} domain="conversation" />
          {c.handoffToHuman ? <Badge variant="warning">Con una persona</Badge> : null}
          {c.unanswered && c.status !== "CLOSED" ? (
            <Badge variant="destructive">Sin responder</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "lastMessageAt",
      header: "Último mensaje",
      width: "12rem",
      cell: (c) => <DateTime value={c.lastMessageAt} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "10rem",
      className: "text-right",
      cell: (c) => (
        <div className="flex justify-end">
          {c.handoffToHuman ? (
            <Button
              variant="outline"
              size="sm"
              loading={returnToAgent.isPending && returnToAgent.variables === c.id}
              onClick={() => setReturnTarget(c)}
              aria-label={`Devolver conversación con ${c.externalPhone} al agente`}
            >
              <Bot aria-hidden className="h-3.5 w-3.5" />
              Devolver
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={!userId}
              loading={handoff.isPending && handoff.variables === c.id}
              onClick={() => handoff.mutate(c.id)}
              aria-label={`Transferir conversación con ${c.externalPhone} a una persona`}
            >
              <UserCog aria-hidden className="h-3.5 w-3.5" />
              Transferir
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Section
        title="Conversaciones"
        description="Abre un hilo para leerlo y contestar, o transfiérelo a una persona."
        padded={false}
        footer={
          capped ? (
            <p className="text-xs text-muted-foreground">
              Se muestran las {CONVERSATIONS_LIMIT} más recientes. Afina los filtros para
              encontrar otras.
            </p>
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={onOpenConversation}
          getRowActionLabel={(c) => `Ver conversación con ${c.externalPhone}`}
          caption="Conversaciones de WhatsApp"
          skeletonRows={4}
          empty={
            filtered
              ? {
                  icon: <SearchX className="h-6 w-6" />,
                  title: "Ninguna conversación coincide",
                  description: "Cambia o quita los filtros para ver el resto de los hilos.",
                  action: (
                    <Button variant="outline" size="sm" onClick={onClearFilters}>
                      Limpiar filtros
                    </Button>
                  ),
                }
              : {
                  icon: <MessagesSquare className="h-6 w-6" />,
                  title: "Sin conversaciones todavía",
                  description:
                    "En cuanto alguien escriba al número conectado, el hilo aparecerá aquí y podrás transferirlo a una persona.",
                }
          }
        />
      </Section>
      <ConfirmDialog
        open={returnTarget !== null}
        onOpenChange={(open) => !open && setReturnTarget(null)}
        title="¿Devolver la conversación al agente?"
        description={
          returnTarget
            ? `El agente volverá a contestar a ${returnTarget.externalPhone}. Podrás transferirla de nuevo cuando quieras.`
            : undefined
        }
        confirmLabel="Devolver al agente"
        variant="default"
        pending={returnToAgent.isPending}
        onConfirm={() => {
          if (!returnTarget) return;
          returnToAgent.mutate(returnTarget.id, { onSuccess: () => setReturnTarget(null) });
        }}
      />
    </>
  );
}
