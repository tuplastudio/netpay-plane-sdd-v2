"use client";
import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { EntityId } from "@/components/app/entity-id";
import { InfoTip } from "@/components/app/info-tip";
import { PageHeader } from "@/components/app/page-header";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { Section } from "@/components/app/section";
import { usePermissions } from "@/components/app/use-permissions";

interface Order {
  id: string;
  status: string;
  total: string;
  customer: { fullName: string };
  source: string;
  paidAt: string | null;
  createdAt: string;
}

const columns: Array<DataTableColumn<Order>> = [
  {
    key: "id",
    header: "ID",
    width: "9rem",
    cell: (o) => <EntityId value={o.id} toastLabel="ID del pedido" />,
  },
  { key: "customer", header: "Cliente", cell: (o) => o.customer.fullName },
  {
    key: "status",
    header: "Estado",
    width: "9rem",
    cell: (o) => <StatusBadge status={o.status} domain="order" />,
  },
  {
    key: "total",
    header: "Total",
    numeric: true,
    width: "8rem",
    cell: (o) => <Money value={o.total} />,
  },
  {
    key: "source",
    header: (
      <span className="inline-flex items-center gap-1">
        Origen
        <InfoTip
          label="Origen"
          text="De dónde nació el pedido: una cotización aceptada, un cobro rápido o el agente de WhatsApp."
        />
      </span>
    ),
    width: "8rem",
    cell: (o) => (
      <span className="text-muted-foreground">{SOURCE_LABELS[o.source] ?? o.source}</span>
    ),
  },
  {
    key: "paidAt",
    header: (
      <span className="inline-flex items-center gap-1">
        Pagado
        <InfoTip label="Pagado" text="Momento en que el gateway confirmó el cobro. Vacío mientras el pedido siga por pagar." />
      </span>
    ),
    width: "11rem",
    cell: (o) => <DateTime value={o.paidAt} className="text-xs text-muted-foreground" />,
  },
];

export default function OrdersPage() {
  const canQuote = usePermissions().can("quotes.write");
  const q = usePagedQuery<Order>({ key: ["orders"], path: "/orders" });

  return (
    <div>
      <PageHeader
        title="Pedidos"
        description="Cada venta desde que se abre el checkout hasta que se cobra, entrega o reembolsa."
      />

      <div className="space-y-6">
        <Section title="Listado" padded={false}>
          <DataTable
            columns={columns}
            rows={q.rows}
            isLoading={q.isLoading}
            isError={q.isError}
            error={q.error}
            onRetry={() => void q.refetch()}
            pagination={q.paged ? <TablePager {...q.pagerProps} /> : undefined}
            getRowHref={(o) => `/orders/${o.id}`}
            caption="Pedidos del comercio"
            empty={{
              icon: <PackageOpen className="h-6 w-6" />,
              title: "Sin pedidos",
              description:
                "Aquí verás cada venta desde que se abre el checkout hasta que se cobra. Empieza cotizando para generar el primer pedido.",
              action: canQuote ? (
                <Button asChild>
                  <Link href="/quotes">Nueva cotización</Link>
                </Button>
              ) : undefined,
            }}
          />
        </Section>
      </div>
    </div>
  );
}
