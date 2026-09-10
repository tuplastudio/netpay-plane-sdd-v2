"use client";
import type { UseQueryResult } from "@tanstack/react-query";
import { CalendarDays, Inbox, MessagesSquare, UserCog } from "lucide-react";
import { StatTile } from "@/components/app/stat-tile";
import type { ConversationList } from "./use-conversations";

/**
 * KPIs de la bandeja. Vienen en la misma respuesta que el listado pero el API
 * los calcula para el tenant completo, así que no cambian al filtrar.
 */
export function ConversationsSummary({ query }: { query: UseQueryResult<ConversationList> }) {
  const stats = query.data?.stats;
  const open = stats?.open ?? 0;
  const handedOff = stats?.handedOff ?? 0;
  const unanswered = stats?.unanswered ?? 0;
  const today = stats?.today ?? 0;
  const state = {
    isLoading: query.isLoading,
    isError: query.isError,
    onRetry: () => void query.refetch(),
  };

  return (
    <div aria-label="Resumen de conversaciones" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatTile
        size="compact"
        label="Abiertas"
        value={open}
        tone="info"
        icon={<MessagesSquare className="h-4 w-4" />}
        hint="Hilos en curso, con el agente o con una persona"
        {...state}
      />
      <StatTile
        size="compact"
        label="Con una persona"
        value={handedOff}
        tone={handedOff > 0 ? "warning" : "neutral"}
        icon={<UserCog className="h-4 w-4" />}
        hint={handedOff > 0 ? "Transferidas: el agente no contesta" : "Ninguna transferida"}
        {...state}
      />
      <StatTile
        size="compact"
        label="Sin responder"
        value={unanswered}
        tone={unanswered > 0 ? "destructive" : "neutral"}
        icon={<Inbox className="h-4 w-4" />}
        hint="El último mensaje es del cliente y nadie ha contestado"
        {...state}
      />
      <StatTile
        size="compact"
        label="Hoy"
        value={today}
        icon={<CalendarDays className="h-4 w-4" />}
        hint="Conversaciones con actividad hoy"
        {...state}
      />
    </div>
  );
}
