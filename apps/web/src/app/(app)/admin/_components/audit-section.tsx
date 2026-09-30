"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { Section } from "@/components/app/section";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { InfoTip } from "@/components/app/info-tip";
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
    header: (
      <span className="inline-flex items-center gap-1">
        Objetivo
        <InfoTip label="Objetivo" text="Registro sobre el que se hizo la acción (cotización, pedido, cliente…). Abre el evento para ir a él." />
      </span>
    ),
    width: "13rem",
    // 11+16+12+13rem de columnas fijas ya suman 832px, más ancho que un
    // tablet en portrait (768px); esta se ve completa al abrir el evento.
    className: "hidden lg:table-cell",
    headerClassName: "hidden lg:table-cell",
    cell: (e) =>
      e.targetType || e.targetId ? (
        <span className="inline-flex items-baseline gap-1.5">
          {e.targetType ? <span className="text-xs">{e.targetType}</span> : null}
          {e.targetId ? (
            <EntityId value={e.targetId} copyable={false} className="text-muted-foreground" />
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

  const audit = usePagedQuery<AuditEvent>({
    key: ["audit"],
    path: "/audit/events",
    urlPrefix: "audit",
    defaultPageSize: 50,
  });

  return (
    <>
      <Section
        title="Auditoría"
        headerIcon={<ScrollText className="h-4 w-4" />}
        description="Eventos registrados en el tenant, del más reciente al más antiguo. Haz clic en uno para ver el detalle."
        padded={false}
      >
        <DataTable
          columns={columns}
          rows={audit.rows}
          isLoading={audit.isLoading}
          isError={audit.isError}
          error={audit.error}
          onRetry={() => void audit.refetch()}
          pagination={audit.paged ? <TablePager {...audit.pagerProps} /> : undefined}
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
