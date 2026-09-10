"use client";
import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HeartPulse, Plug, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  connectionName,
  providerLabel,
  useCheckHealth,
  useDisconnect,
  type Connection,
} from "./use-channels";

/**
 * Estado del canal con lectura inequívoca: conectado / esperando / con error /
 * desconectado. El API guarda `DISABLED` al desconectar, valor que
 * `CONNECTION_STATUS_LABELS` aún no cubre (caería a "Deshabilitada"), así que
 * se resuelve aquí con los escape hatches documentados `label` + `tone`.
 */
export function ConnectionStatus({ status }: { status: string }) {
  if (status.toUpperCase() === "DISABLED") {
    return <StatusBadge status={status} domain="connection" label="Desconectado" tone="neutral" withDot />;
  }
  return <StatusBadge status={status} domain="connection" withDot />;
}

function PhoneCell({ phone }: { phone: string | null }) {
  if (phone) return <span className="font-mono text-xs">{phone}</span>;
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Sin número</span>
    </>
  );
}

export function ConnectionsTable({
  query,
  onConnect,
}: {
  query: UseQueryResult<Connection[]>;
  /** Abre el panel de conexión (acción del estado vacío y del encabezado). */
  onConnect: () => void;
}) {
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const checkHealth = useCheckHealth();
  const disconnect = useDisconnect(() => setDisconnectTarget(null));

  const columns: Array<DataTableColumn<Connection>> = [
    {
      key: "provider",
      header: "Proveedor",
      cell: (c) => <span className="font-medium">{providerLabel(c.provider)}</span>,
    },
    {
      key: "phone",
      header: "Número",
      cell: (c) => <PhoneCell phone={c.phoneNumber} />,
    },
    {
      key: "status",
      header: "Estado",
      width: "14rem",
      cell: (c) => (
        <div className="space-y-1">
          <ConnectionStatus status={c.status} />
          {c.status === "ERROR" && c.lastError ? (
            <p
              className="max-w-[14rem] truncate text-xs text-muted-foreground"
              title={c.lastError}
            >
              {c.lastError}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "connectedAt",
      header: "Conectado desde",
      width: "12rem",
      cell: (c) => <DateTime value={c.connectedAt} className="text-muted-foreground" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "16rem",
      className: "text-right",
      cell: (c) => {
        const disabled = c.status === "DISABLED";
        return (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={checkHealth.isPending && checkHealth.variables === c.id}
              onClick={() => checkHealth.mutate(c.id)}
              aria-label={`Verificar ${connectionName(c)}`}
            >
              <HeartPulse aria-hidden className="h-3.5 w-3.5" />
              Verificar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setDisconnectTarget(c)}
              aria-label={`Desconectar ${connectionName(c)}`}
            >
              <Unplug aria-hidden className="h-3.5 w-3.5" />
              Desconectar
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Section
        title="Conexiones"
        description="Estado en vivo de cada número de WhatsApp vinculado al comercio."
        padded={false}
        actions={
          query.data && query.data.length > 0 ? (
            <Button variant="outline" size="sm" onClick={onConnect}>
              <Plug aria-hidden className="h-3.5 w-3.5" />
              Conectar canal
            </Button>
          ) : null
        }
      >
        <DataTable
          columns={columns}
          rows={query.data}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => void query.refetch()}
          caption="Conexiones de WhatsApp del comercio"
          skeletonRows={2}
          empty={{
            icon: <PlugZap className="h-6 w-6" />,
            title: "Ningún canal conectado",
            description:
              "Conecta un número de WhatsApp (Meta o Evolution) para que el agente pueda recibir y responder mensajes.",
            action: (
              <Button onClick={onConnect}>
                <Plug aria-hidden className="h-4 w-4" />
                Conectar canal
              </Button>
            ),
          }}
        />
      </Section>

      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title={
          disconnectTarget
            ? `¿Desconectar ${connectionName(disconnectTarget)}?`
            : "¿Desconectar canal?"
        }
        description="El canal deja de enviar y recibir mensajes hasta que lo vuelvas a conectar. Las conversaciones existentes se conservan."
        confirmLabel="Desconectar"
        pending={disconnect.isPending}
        onConfirm={() => disconnectTarget && disconnect.mutate(disconnectTarget.id)}
      />
    </>
  );
}
