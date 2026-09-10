"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge, TENANT_STATUS_LABELS } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { CreateTenantSheet } from "../create-tenant-sheet";
import { SA_ROOT_KEY, SA_TENANTS_KEY, type TenantRow, formatInt } from "../_shared";

const columns: Array<DataTableColumn<TenantRow>> = [
  { key: "name", header: "Empresa", cell: (t) => <span className="font-medium">{t.name}</span> },
  { key: "slug", header: "Slug", className: "font-mono text-xs", cell: (t) => t.slug },
  {
    key: "status",
    header: "Estado",
    width: "8rem",
    cell: (t) => <StatusBadge status={t.status} domain="tenant" />,
  },
  {
    key: "members",
    header: "Usuarios",
    numeric: true,
    width: "6rem",
    cell: (t) => formatInt(t._count.memberships),
  },
  {
    key: "products",
    header: "Productos",
    numeric: true,
    width: "7rem",
    cell: (t) => formatInt(t._count.products),
  },
  {
    key: "orders",
    header: "Pedidos",
    numeric: true,
    width: "6rem",
    cell: (t) => formatInt(t._count.orders),
  },
  {
    key: "cost",
    header: "Gasto mes (USD)",
    numeric: true,
    width: "9rem",
    cell: (t) => <Money value={t.usageMtd?.costUsd} currency="USD" />,
  },
  {
    key: "createdAt",
    header: "Creada",
    width: "9rem",
    cell: (t) => <DateTime value={t.createdAt} withTime={false} className="text-muted-foreground" />,
  },
];

export default function SuperAdminTenantsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const tenants = useQuery({
    queryKey: SA_TENANTS_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: TenantRow[] }>("/super-admin/tenants");
      return res.data.data;
    },
  });

  const rows = useMemo(() => {
    if (!tenants.data) return undefined;
    const q = search.trim().toLowerCase();
    return tenants.data.filter((t) => {
      if (status && t.status !== status) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    });
  }, [tenants.data, search, status]);

  const filtering = search.trim() !== "" || status !== "";
  const total = tenants.data?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Empresas"
        description="Alta, estado y consumo de cada empresa (tenant) de la plataforma."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Crear empresa
          </Button>
        }
      />

      <div className="space-y-6">
        <Section title="Filtros" density="compact">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor="tenants-search">Buscar</Label>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="tenants-search"
                  type="search"
                  placeholder="Nombre o slug"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenants-status">Estado</Label>
              <Select
                id="tenants-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(TENANT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="Listado"
          description={
            tenants.data
              ? filtering
                ? `${formatInt(rows?.length)} de ${formatInt(total)} empresas`
                : `${formatInt(total)} ${total === 1 ? "empresa" : "empresas"}`
              : undefined
          }
          padded={false}
        >
          <DataTable
            columns={columns}
            rows={rows}
            isLoading={tenants.isLoading}
            isError={tenants.isError}
            error={tenants.error}
            onRetry={() => void tenants.refetch()}
            getRowHref={(t) => `/super-admin/${t.id}`}
            getRowActionLabel={(t) => `Ver ${t.name}`}
            caption="Empresas de la plataforma"
            empty={
              filtering
                ? {
                    icon: <Search className="h-6 w-6" />,
                    title: "Sin coincidencias",
                    description: "Ninguna empresa coincide con la búsqueda o el estado elegido.",
                    action: (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch("");
                          setStatus("");
                        }}
                      >
                        Limpiar filtros
                      </Button>
                    ),
                  }
                : {
                    icon: <Building2 className="h-6 w-6" />,
                    title: "Sin empresas",
                    description:
                      "Crea la primera empresa para empezar a operar su catálogo y su bot.",
                    action: (
                      <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4" />
                        Crear empresa
                      </Button>
                    ),
                  }
            }
          />
        </Section>
      </div>

      <CreateTenantSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: SA_ROOT_KEY })}
      />
    </div>
  );
}
