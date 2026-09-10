"use client";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { NewQuoteForm } from "./_components/new-quote-form";

interface Quote {
  id: string;
  status: string;
  total: string;
  customer: { fullName: string };
  expiresAt: string;
}

const columns: Array<DataTableColumn<Quote>> = [
  {
    key: "id",
    header: "ID",
    width: "9rem",
    cell: (q) => (
      <span className="font-mono text-xs" title={q.id}>
        {q.id.slice(0, 8)}…
      </span>
    ),
  },
  { key: "customer", header: "Cliente", cell: (q) => q.customer.fullName },
  {
    key: "status",
    header: "Estado",
    width: "9rem",
    cell: (q) => <StatusBadge status={q.status} domain="quote" />,
  },
  {
    key: "total",
    header: "Total",
    numeric: true,
    width: "8rem",
    cell: (q) => <Money value={q.total} />,
  },
  {
    key: "expiresAt",
    header: "Vence",
    width: "10rem",
    cell: (q) => (
      <DateTime value={q.expiresAt} withTime={false} className="text-muted-foreground" />
    ),
  },
];

export default function QuotesPage() {
  const list = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      const res = await api.get<{ data: Quote[] }>("/quotes");
      return res.data.data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Cotizaciones"
        description="Cotiza varios productos y variantes en una sola cotización, emítela y comparte el link público."
      />

      <div className="space-y-6">
        <NewQuoteForm />

        <Section title="Cotizaciones" padded={false}>
          <DataTable
            columns={columns}
            rows={list.data}
            isLoading={list.isLoading}
            isError={list.isError}
            error={list.error}
            onRetry={() => void list.refetch()}
            getRowHref={(q) => `/quotes/${q.id}`}
            caption="Cotizaciones del comercio"
            empty={{
              icon: <FileText className="h-6 w-6" />,
              title: "Sin cotizaciones",
              description:
                "Arma la primera con el formulario de arriba: elige cliente, agrega variantes y emítela para compartir el link público.",
            }}
          />
        </Section>
      </div>
    </div>
  );
}
