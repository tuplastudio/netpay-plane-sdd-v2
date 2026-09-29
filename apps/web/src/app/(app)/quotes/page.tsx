"use client";
import { useState } from "react";
import { CirclePlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { NewQuoteForm } from "./_components/new-quote-form";
import { usePermissions } from "@/components/app/use-permissions";

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
  const list = usePagedQuery<Quote>({ key: ["quotes"], path: "/quotes" });

  // El Sheet del cotizador se controla desde la página (no desde el
  // componente del form) para que el botón "Nueva cotización" viva en el
  // `PageHeader` y no se duplique el título "Cotizaciones" entre
  // encabezado, sección del cotizador y sección del listado.
  const [newQuoteOpen, setNewQuoteOpen] = useState(false);
  const canWrite = usePermissions().can("quotes.write");

  return (
    <div>
      <PageHeader
        title="Cotizaciones"
        description="Cotiza varios productos y variantes en una sola cotización, emítela y comparte el link público."
        actions={
          canWrite ? (
            <Button onClick={() => setNewQuoteOpen(true)}>
              <CirclePlus aria-hidden className="h-4 w-4" />
              Nueva cotización
            </Button>
          ) : undefined
        }
      />

      {/* El listado vive sin `title=` para no repetir "Cotizaciones" arriba dos
          veces: el `caption` del `DataTable` ya describe el contenido y el
          PageHeader ya dio el nombre de la pantalla. */}
      <Section padded={false}>
        <DataTable
          columns={columns}
          rows={list.rows}
          isLoading={list.isLoading}
          isError={list.isError}
          error={list.error}
          onRetry={() => void list.refetch()}
          pagination={list.paged ? <TablePager {...list.pagerProps} /> : undefined}
          getRowHref={(q) => `/quotes/${q.id}`}
          caption="Cotizaciones del comercio"
          empty={{
            icon: <FileText className="h-6 w-6" />,
            title: "Sin cotizaciones",
            description: canWrite
              ? "Pulsa «Nueva cotización» arriba a la derecha para abrir el cotizador. Elige cliente, agrega variantes y emítela para compartir el link público."
              : "Cuando el equipo de ventas emita cotizaciones, aparecerán aquí.",
          }}
        />
      </Section>

      {canWrite ? <NewQuoteForm open={newQuoteOpen} onOpenChange={setNewQuoteOpen} /> : null}
    </div>
  );
}
