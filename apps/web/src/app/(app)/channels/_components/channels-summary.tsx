"use client";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Clock, PlugZap } from "lucide-react";
import { StatTile } from "@/components/app/stat-tile";
import type { Connection } from "./use-channels";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Resumen de las conexiones. Todo sale de la lista que la pantalla ya carga
 * (`/whatsapp/connections`): no hay endpoint de métricas, así que los conteos
 * se derivan en el cliente. Las KPIs de conversaciones viven en `/conversations`.
 */
export function ChannelsSummary({ connections }: { connections: UseQueryResult<Connection[]> }) {
  const conns = connections.data ?? [];
  const active = conns.filter((c) => c.status === "ACTIVE").length;
  const pending = conns.filter((c) => c.status === "PENDING").length;
  const withError = conns.filter((c) => c.status === "ERROR").length;
  const state = {
    isLoading: connections.isLoading,
    isError: connections.isError,
    onRetry: () => void connections.refetch(),
  };

  return (
    <div aria-label="Resumen de canales" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <StatTile size="compact"
        label="Canales conectados"
        value={active}
        tone={active > 0 ? "success" : withError > 0 ? "destructive" : "neutral"}
        icon={<PlugZap className="h-4 w-4" />}
        hint={
          conns.length === 0
            ? "Ninguno configurado"
            : `de ${plural(conns.length, "configurado", "configurados")}`
        }
        {...state}
      />
      <StatTile size="compact"
        label="Pendientes"
        value={pending}
        tone={pending > 0 ? "warning" : "neutral"}
        icon={<Clock className="h-4 w-4" />}
        hint={pending > 0 ? "Esperan el primer webhook" : "Ninguno en espera"}
        {...state}
      />
      <StatTile size="compact"
        label="Con error"
        value={withError}
        tone={withError > 0 ? "destructive" : "neutral"}
        icon={<AlertTriangle className="h-4 w-4" />}
        hint={withError > 0 ? "Revisa la conexión y vuelve a verificar" : "Todo en orden"}
        {...state}
      />
    </div>
  );
}
