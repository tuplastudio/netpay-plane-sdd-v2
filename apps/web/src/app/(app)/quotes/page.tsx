"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePlus, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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

  // El Sheet del cotizador se controla desde la página (no desde el
  // componente del form) para que el botón "Nueva cotización" viva en el
  // `PageHeader` y no se duplique el título "Cotizaciones" entre
  // encabezado, sección del cotizador y sección del listado.
  const [newQuoteOpen, setNewQuoteOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Cotizaciones"
        description="Cotiza varios productos y variantes en una sola cotización, emítela y comparte el link público."
        actions={
          <Button onClick={() => setNewQuoteOpen(true)}>
            <CirclePlus aria-hidden className="h-4 w-4" />
            Nueva cotización
          </Button>
        }
      />

      {/* El listado vive sin `title=` para no repetir "Cotizaciones" arriba dos
          veces: el `caption` del `DataTable` ya describe el contenido y el
          PageHeader ya dio el nombre de la pantalla. */}
      <Section padded={false}>
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
              "Pulsa «Nueva cotización» arriba a la derecha para abrir el cotizador. Elige cliente, agrega variantes y emítela para compartir el link público.",
          }}
        />
      </Section>

      <NewQuoteForm open={newQuoteOpen} onOpenChange={setNewQuoteOpen} />
    </div>
  );
}
