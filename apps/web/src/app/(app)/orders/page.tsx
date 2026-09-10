"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SOURCE_LABELS, StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";

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
    cell: (o) => (
      <span className="font-mono text-xs" title={o.id}>
        {o.id.slice(0, 8)}…
      </span>
    ),
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
    header: "Origen",
    width: "8rem",
    cell: (o) => (
      <span className="text-muted-foreground">{SOURCE_LABELS[o.source] ?? o.source}</span>
    ),
  },
  {
    key: "paidAt",
    header: "Pagado",
    width: "11rem",
    cell: (o) => <DateTime value={o.paidAt} className="text-xs text-muted-foreground" />,
  },
];

export default function OrdersPage() {
  const q = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const res = await api.get<{ data: Order[] }>("/orders");
      return res.data.data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Pedidos"
        description="Checkout público, pasarela de pruebas y ledger simulado."
      />

      <div className="space-y-6">
        <Section title="Listado" padded={false}>
          <DataTable
            columns={columns}
            rows={q.data}
            isLoading={q.isLoading}
            isError={q.isError}
            error={q.error}
            onRetry={() => void q.refetch()}
            getRowHref={(o) => `/orders/${o.id}`}
            caption="Pedidos del comercio"
            empty={{
              icon: <PackageOpen className="h-6 w-6" />,
              title: "Sin pedidos",
              description:
                "Aquí verás cada venta desde que se abre el checkout hasta que se cobra. Empieza cotizando para generar el primer pedido.",
              action: (
                <Button asChild>
                  <Link href="/quotes">Nueva cotización</Link>
                </Button>
              ),
            }}
          />
        </Section>
      </div>
    </div>
  );
}
