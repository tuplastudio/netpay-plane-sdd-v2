"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { EntityId } from "@/components/app/entity-id";
import { Money } from "@/components/app/money";
import { Section } from "@/components/app/section";

/**
 * `GET /customers/:id/history` devuelve **dos** colecciones separadas
 * (`customer.service.ts#history`): cotizaciones y pedidos, cada una con sus
 * 50 registros más recientes. Aquí se funden en una sola línea de tiempo
 * ordenada por fecha, que es como el operador la lee: "qué pasó con este
 * cliente", no "qué cotizaciones tiene y aparte qué pedidos".
 */
interface HistoryQuote {
  id: string;
  status: string;
  total: string;
  createdAt: string;
}

interface HistoryOrder {
  id: string;
  status: string;
  total: string;
  source: string;
  createdAt: string;
}

interface CustomerHistory {
  quotes: HistoryQuote[];
  orders: HistoryOrder[];
}

type HistoryRow = {
  /** Discrimina el dominio del estado y la ruta de detalle. */
  kind: "order" | "quote";
  id: string;
  status: string;
  total: string;
  createdAt: string;
  /** `OrderSource`; las cotizaciones no lo tienen. */
  source: string | null;
};

function toRows(data: CustomerHistory): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...data.orders.map<HistoryRow>((o) => ({
      kind: "order",
      id: o.id,
      status: o.status,
      total: o.total,
      createdAt: o.createdAt,
      source: o.source,
    })),
    ...data.quotes.map<HistoryRow>((q) => ({
      kind: "quote",
      id: q.id,
      status: q.status,
      total: q.total,
      createdAt: q.createdAt,
      source: null,
    })),
  ];
  // Más reciente primero. Una fecha ilegible cae al final en vez de reventar
  // la comparación con NaN.
  return rows.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });
}

const columns: Array<DataTableColumn<HistoryRow>> = [
  {
    key: "kind",
    header: "Tipo",
    width: "8rem",
    cell: (r) => (
      <Badge variant={r.kind === "order" ? "info" : "neutral"} size="sm">
        {r.kind === "order" ? "Pedido" : "Cotización"}
      </Badge>
    ),
  },
  {
    key: "id",
    header: "Folio",
    width: "10rem",
    cell: (r) => (
      <EntityId
        value={r.id}
        copyable={false}
        toastLabel={r.kind === "order" ? "ID del pedido" : "ID de la cotización"}
      />
    ),
  },
  {
    key: "status",
    header: "Estado",
    width: "9rem",
    cell: (r) => <StatusBadge status={r.status} domain={r.kind} withDot />,
  },
  {
    key: "source",
    header: "Origen",
    width: "9rem",
    cell: (r) =>
      r.source ? (
        <span className="text-muted-foreground">{SOURCE_LABELS[r.source] ?? r.source}</span>
      ) : (
        <>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="sr-only">Sin origen</span>
        </>
      ),
  },
  {
    key: "total",
    header: "Total",
    numeric: true,
    width: "9rem",
    cell: (r) => <Money value={r.total} />,
  },
  {
    key: "createdAt",
    header: "Fecha",
    width: "11rem",
    cell: (r) => <DateTime value={r.createdAt} className="text-xs text-muted-foreground" />,
  },
];

export function CustomerHistorySection({ customerId }: { customerId: string }) {
  const historyQ = useQuery({
    queryKey: ["customer-history", customerId],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerHistory }>(`/customers/${customerId}/history`);
      return res.data.data;
    },
  });

  const rows = historyQ.data ? toRows(historyQ.data) : undefined;

  return (
    <Section
      title="Historial"
      description="Cotizaciones y pedidos de este cliente, del más reciente al más antiguo."
      padded={false}
    >
      <DataTable
        columns={columns}
        rows={rows}
        isLoading={historyQ.isLoading}
        isError={historyQ.isError}
        error={historyQ.error}
        onRetry={() => void historyQ.refetch()}
        getRowId={(r) => `${r.kind}-${r.id}`}
        // Ambas rutas de detalle existen: src/app/(app)/orders/[id]/page.tsx y
        // src/app/(app)/quotes/[id]/page.tsx.
        getRowHref={(r) => (r.kind === "order" ? `/orders/${r.id}` : `/quotes/${r.id}`)}
        getRowActionLabel={(r) =>
          `${r.kind === "order" ? "Ver pedido" : "Ver cotización"} ${r.id.slice(0, 8)}`
        }
        caption="Cotizaciones y pedidos del cliente"
        empty={{
          icon: <History className="h-6 w-6" />,
          title: "Sin movimientos todavía",
          description:
            "Cuando este cliente reciba una cotización o se le levante un pedido, aparecerá aquí.",
        }}
      />
    </Section>
  );
}
