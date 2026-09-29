"use client";

import Link from "next/link";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABELS, SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { Money } from "@/components/app/money";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import {
  TIMELINE_KIND_LABELS,
  timelineHref,
  type TimelineItem,
  type TimelineKind,
} from "./customer-types";

type Kind = TimelineKind | "all";

const KIND_BADGE: Record<TimelineKind, "info" | "neutral" | "success" | "warning" | "muted"> = {
  order: "info",
  quote: "neutral",
  payment: "success",
  conversation: "warning",
  note: "muted",
};

function Dash({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

function metaString(item: TimelineItem, key: string): string | null {
  const v = item.meta[key];
  return typeof v === "string" && v ? v : null;
}

/** Descripción en una línea de cada movimiento, para la vista "todo". */
function describe(item: TimelineItem): React.ReactNode {
  switch (item.kind) {
    case "order": {
      const source = metaString(item, "source");
      const desc = metaString(item, "description");
      return desc ?? (source ? SOURCE_LABELS[source] ?? source : "Pedido");
    }
    case "quote": {
      const orderId = metaString(item, "orderId");
      return orderId ? "Cotización convertida en pedido" : "Cotización";
    }
    case "payment": {
      const method = metaString(item, "paymentMethod");
      return method ? `Pago con ${method}` : "Sesión de cobro";
    }
    case "conversation": {
      const phone = metaString(item, "externalPhone");
      const provider = metaString(item, "provider");
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-code-sm">{phone}</span>
          {provider ? (
            <Badge variant="neutral" size="sm">
              {CHANNEL_LABELS[provider] ?? provider}
            </Badge>
          ) : null}
        </span>
      );
    }
    case "note": {
      const body = metaString(item, "body") ?? "";
      const author = item.meta.author as { fullName?: string } | null;
      return (
        <span className="line-clamp-2 whitespace-pre-line">
          {author?.fullName ? <span className="font-medium">{author.fullName}: </span> : null}
          {body}
        </span>
      );
    }
    default:
      return null;
  }
}

function statusCell(item: TimelineItem) {
  if (!item.status) return <Dash label="Sin estado" />;
  const domain =
    item.kind === "note" ? "generic" : item.kind === "conversation" ? "conversation" : item.kind;
  return <StatusBadge status={item.status} domain={domain} withDot />;
}

function buildColumns(kind: Kind): Array<DataTableColumn<TimelineItem>> {
  const cols: Array<DataTableColumn<TimelineItem>> = [];
  if (kind === "all") {
    cols.push({
      key: "kind",
      header: "Tipo",
      width: "8rem",
      cell: (r) => (
        <Badge variant={KIND_BADGE[r.kind]} size="sm">
          {TIMELINE_KIND_LABELS[r.kind]}
        </Badge>
      ),
    });
  }
  cols.push({
    key: "at",
    header: kind === "conversation" ? "Último mensaje" : "Fecha",
    width: "11rem",
    cell: (r) => <DateTime value={r.at} className="text-xs text-muted-foreground" />,
  });
  if (kind !== "note") {
    cols.push({
      key: "id",
      header: kind === "conversation" ? "Hilo" : "Folio",
      width: "10rem",
      cell: (r) => (
        <EntityId value={r.id} copyable={false} toastLabel={`ID de ${TIMELINE_KIND_LABELS[r.kind].toLowerCase()}`} />
      ),
    });
  }
  cols.push({
    key: "detail",
    header: kind === "note" ? "Nota" : "Detalle",
    cell: (r) => describe(r),
  });
  if (kind !== "note") {
    cols.push({
      key: "status",
      header: "Estado",
      width: "10rem",
      cell: (r) => statusCell(r),
    });
  }
  if (kind === "all" || kind === "quote" || kind === "order" || kind === "payment") {
    cols.push({
      key: "amount",
      header: "Importe",
      numeric: true,
      width: "9rem",
      cell: (r) =>
        r.amount === null ? <Dash label="Sin importe" /> : <Money value={r.amount} currency={r.currency} />,
    });
  }
  if (kind === "order") {
    cols.push({
      key: "source",
      header: "Origen",
      width: "9rem",
      cell: (r) => {
        const source = metaString(r, "source");
        return source ? <span className="text-muted-foreground">{SOURCE_LABELS[source] ?? source}</span> : <Dash label="Sin origen" />;
      },
    });
    cols.push({
      key: "invoice",
      header: "Factura",
      width: "8rem",
      cell: (r) =>
        r.meta.requiresInvoice ? (
          <Badge variant="info" size="sm">
            {metaString(r, "invoiceStatus") === "DATA_COMPLETE" ? "Datos completos" : "Solicitada"}
          </Badge>
        ) : (
          <Dash label="Sin factura" />
        ),
    });
  }
  if (kind === "payment") {
    cols.push({
      key: "order",
      header: "Pedido",
      width: "10rem",
      cell: (r) => {
        const orderId = metaString(r, "orderId");
        return orderId ? (
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link href={`/orders/${orderId}`}>
              <EntityId value={orderId} copyable={false} />
            </Link>
          </Button>
        ) : (
          <Dash label="Sin pedido" />
        );
      },
    });
  }
  if (kind === "conversation") {
    cols.push({
      key: "tags",
      header: "Etiquetas",
      cell: (r) => {
        const tags = Array.isArray(r.meta.tags) ? (r.meta.tags as string[]) : [];
        return tags.length ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge key={t} variant="neutral" size="sm">
                {t}
              </Badge>
            ))}
          </span>
        ) : (
          <Dash label="Sin etiquetas" />
        );
      },
    });
  }
  return cols;
}

const EMPTY: Record<Kind, { title: string; description: string }> = {
  all: {
    title: "Sin movimientos todavía",
    description: "Cuando este cliente reciba una cotización, levante un pedido o escriba por WhatsApp, aparecerá aquí.",
  },
  quote: { title: "Sin cotizaciones", description: "Todavía no se le ha cotizado nada a este cliente." },
  order: { title: "Sin pedidos", description: "Este cliente aún no tiene pedidos." },
  payment: { title: "Sin pagos", description: "No hay sesiones de cobro ligadas a pedidos de este cliente." },
  conversation: {
    title: "Sin conversaciones",
    description: "No hay hilos de WhatsApp vinculados a esta ficha.",
  },
  note: { title: "Sin notas", description: "Deja la primera nota interna desde la pestaña Notas." },
};

/**
 * Línea de tiempo del cliente (`GET /customers/:id/timeline?kind=`), una
 * tabla paginada por tipo. `kind="all"` funde todos los tipos por fecha.
 * Cada pestaña pagina aparte (`urlPrefix`) para que cambiar de página en
 * Pedidos no mueva la de Cotizaciones.
 */
export function CustomerTimeline({
  customerId,
  kind,
  pageSize = 10,
}: {
  customerId: string;
  kind: Kind;
  pageSize?: number;
}) {
  const list = usePagedQuery<TimelineItem>({
    key: ["customer-timeline", customerId, kind],
    path: `/customers/${customerId}/timeline`,
    params: { kind: kind === "all" ? undefined : kind },
    defaultPageSize: pageSize,
    urlPrefix: kind === "all" ? "tl" : kind,
  });

  return (
    <DataTable
      columns={buildColumns(kind)}
      rows={list.rows}
      isLoading={list.isLoading}
      isError={list.isError}
      error={list.error}
      onRetry={() => void list.refetch()}
      pagination={list.paged ? <TablePager {...list.pagerProps} /> : undefined}
      getRowId={(r) => `${r.kind}-${r.id}`}
      getRowHref={timelineHref}
      getRowActionLabel={(r) => `Ver ${TIMELINE_KIND_LABELS[r.kind].toLowerCase()} ${r.id.slice(0, 8)}`}
      caption={kind === "all" ? "Línea de tiempo del cliente" : `${TIMELINE_KIND_LABELS[kind]}: listado del cliente`}
      empty={{ icon: <History className="h-6 w-6" />, ...EMPTY[kind] }}
    />
  );
}
