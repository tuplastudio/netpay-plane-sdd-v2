"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { AuditEventSheet, auditActorLabel, type AuditEvent } from "./audit-event-sheet";

const columns: Array<DataTableColumn<AuditEvent>> = [
  {
    key: "createdAt",
    header: "Fecha",
    width: "11rem",
    cell: (e) => <DateTime value={e.createdAt} className="text-muted-foreground" />,
  },
  {
    key: "action",
    header: "Acción",
    width: "16rem",
    cell: (e) => <span className="font-mono text-xs font-medium">{e.action}</span>,
  },
  {
    key: "actor",
    header: "Actor",
    width: "12rem",
    cell: (e) =>
      e.actor ? (
        <span className="block truncate" title={e.actor.email}>
          {auditActorLabel(e.actor)}
        </span>
      ) : (
        <span className="text-muted-foreground">Sistema</span>
      ),
  },
  {
    key: "target",
    header: "Objetivo",
    width: "13rem",
    cell: (e) =>
      e.targetType || e.targetId ? (
        <span className="inline-flex items-baseline gap-1.5">
          {e.targetType ? <span className="text-xs">{e.targetType}</span> : null}
          {e.targetId ? (
            <span className="font-mono text-xs text-muted-foreground" title={e.targetId}>
              {e.targetId.slice(0, 8)}…
            </span>
          ) : null}
        </span>
      ) : (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">Sin objetivo</span>
        </>
      ),
  },
  {
    key: "metadata",
    header: "Detalle",
    cell: (e) =>
      e.metadata ? (
        // Una sola línea: el detalle completo vive en el sheet al hacer clic.
        <code className="block max-w-[28rem] truncate font-mono text-xs text-muted-foreground">
          {JSON.stringify(e.metadata)}
        </code>
      ) : (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">Sin detalle</span>
        </>
      ),
  },
];

export function AuditSection() {
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const res = await api.get<{ data: AuditEvent[] }>("/audit/events");
      return res.data.data;
    },
  });

  return (
    <>
      <Section
        title="Auditoría"
        headerIcon={<ScrollText className="h-4 w-4" />}
        description="Últimos eventos registrados en el tenant. Haz clic en uno para ver el detalle."
        padded={false}
      >
        <DataTable
          columns={columns}
          rows={audit.data}
          isLoading={audit.isLoading}
          isError={audit.isError}
          error={audit.error}
          onRetry={() => void audit.refetch()}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row)}
          getRowActionLabel={(row) => `Ver detalle de ${row.action}`}
          caption="Bitácora de auditoría"
          empty={{
            icon: <ScrollText className="h-6 w-6" />,
            title: "Sin eventos de auditoría",
            description:
              "En cuanto alguien cree, edite o cobre algo, la acción quedará registrada aquí con su fecha y su autor.",
          }}
        />
      </Section>

      <AuditEventSheet
        event={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
