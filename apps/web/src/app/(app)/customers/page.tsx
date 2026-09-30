"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, Download, Search, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateTime } from "@/components/app/date-time";
import { InfoTip } from "@/components/app/info-tip";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { TablePager } from "@/components/app/table-pager";
import { usePagedQuery } from "@/components/app/use-paged-query";
import { useDebouncedValue } from "@/components/app/use-debounced-value";
import { usePermissions } from "@/components/app/use-permissions";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";

/** Fila de `GET /customers`: el registro más `stats` de por vida (ver `CustomerService.list`). */
interface Customer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  tags: string[];
  /** CustomerStatus — el endpoint devuelve el registro completo. */
  status: string;
  stats?: {
    totalPaid: string;
    paidOrdersCount: number;
    lastPurchaseAt: string | null;
    pendingPaymentsCount: number;
  };
}

interface TagCount {
  tag: string;
  count: number;
}

const schema = z.object({
  fullName: z.string().min(1, "El nombre es obligatorio").max(200, "Máximo 200 caracteres"),
  email: z.string().email("Correo no válido").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  taxId: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

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

export default function CustomersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const canWrite = usePermissions().can("customers.write");

  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const filters = { q, tag, hasPendingPayment: pendingOnly ? "true" : undefined };
  const list = usePagedQuery<Customer>({
    key: ["customers"],
    path: "/customers",
    params: filters,
  });
  const filtered = !!(q || tag || pendingOnly);

  const tagsQ = useQuery({
    queryKey: ["customer-tags"],
    queryFn: async () => {
      const res = await api.get<{ data: TagCount[] }>("/customers/tags");
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", phone: "", taxId: "" },
  });

  const create = useMutation({
    mutationFn: async (input: FormValues) => {
      const clean: Record<string, string> = { fullName: input.fullName };
      if (input.email) clean.email = input.email;
      if (input.phone) clean.phone = input.phone;
      if (input.taxId) clean.taxId = input.taxId;
      const res = await api.post("/customers", clean);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cliente creado");
      reset();
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo crear el cliente")),
  });

  /**
   * CSV con los mismos filtros del listado. Se baja por `api` (cookies de
   * sesión) y se dispara la descarga desde un blob; un `<a href>` directo al
   * API no pasaría por el proxy autenticado de Next.
   */
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.get<Blob>("/customers/export.csv", {
        params: filters,
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "clientes.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo exportar")),
  });

  const onSubmit = handleSubmit((v) => create.mutate(v));

  const columns: Array<DataTableColumn<Customer>> = [
    {
      key: "fullName",
      header: "Nombre",
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-medium">{c.fullName}</p>
          {c.tags.length > 0 ? (
            <p className="mt-0.5 flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <Badge key={t} variant="info" size="sm">
                  {t}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contacto",
      cell: (c) =>
        c.phone || c.email ? (
          <div className="min-w-0 text-muted-foreground">
            {c.phone ? <p className="font-mono text-code-sm">{c.phone}</p> : null}
            {c.email ? <p className="truncate text-sm">{c.email}</p> : null}
          </div>
        ) : (
          <Dash label="Sin contacto" />
        ),
    },
    {
      key: "taxId",
      header: "RFC",
      width: "9rem",
      className: "font-mono text-xs",
      cell: (c) => c.taxId ?? <Dash label="Sin RFC" />,
    },
    {
      key: "lastPurchase",
      header: (
        <span className="inline-flex items-center gap-1">
          Última compra
          <InfoTip label="Última compra" text="Fecha del último pedido pagado de este cliente." className="h-4 w-4" />
        </span>
      ),
      width: "9rem",
      cell: (c) =>
        c.stats?.lastPurchaseAt ? (
          <DateTime value={c.stats.lastPurchaseAt} withTime={false} className="text-muted-foreground" />
        ) : (
          <Dash label="Sin compras" />
        ),
    },
    {
      key: "totalPaid",
      header: (
        <span className="inline-flex flex-row-reverse items-center gap-1">
          Total pagado
          <InfoTip
            label="Total pagado"
            text="Suma de por vida de sus pedidos pagados (sin reembolsos). «Por cobrar» son sesiones de pago abiertas."
            className="h-4 w-4"
          />
        </span>
      ),
      numeric: true,
      width: "9rem",
      cell: (c) => (
        <div>
          <Money value={c.stats?.totalPaid ?? "0"} />
          {c.stats && c.stats.pendingPaymentsCount > 0 ? (
            <p className="text-xs text-warning-foreground">
              {c.stats.pendingPaymentsCount} por cobrar
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      width: "7rem",
      cell: (c) => <StatusBadge status={c.status} domain="customer" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      width: "6rem",
      className: "text-right",
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/customers/${c.id}`)}>
          Ver
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Contactos, historial de compra, identidad fiscal y consentimientos."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportCsv.mutate()}
              loading={exportCsv.isPending}
              disabled={list.total === 0}
            >
              <Download className="h-4 w-4" aria-hidden />
              Exportar CSV
            </Button>
            {canWrite ? (
              <Button onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
                <UserPlus className="h-4 w-4" />
                {showForm ? "Cancelar" : "Nuevo cliente"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        {canWrite && showForm && (
          <Section
            title="Nuevo cliente"
            description="Solo el nombre es obligatorio; el resto se puede completar después."
          >
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input
                  id="fullName"
                  placeholder="Ej. Ana Torres Ruiz"
                  aria-invalid={!!errors.fullName}
                  aria-describedby={errors.fullName ? "fullName-error" : undefined}
                  {...register("fullName")}
                />
                {errors.fullName && (
                  <p id="fullName-error" className="text-xs text-destructive">
                    {errors.fullName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="cliente@ejemplo.com"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  {...register("email")}
                />
                {errors.email && (
                  <p id="email-error" className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  placeholder="Ej. 55 1234 5678"
                  {...register("phone")}
                />
                {errors.phone && (
                  <p id="phone-error" className="text-xs text-destructive">
                    {errors.phone.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="taxId">RFC</Label>
                <Input
                  id="taxId"
                  aria-invalid={!!errors.taxId}
                  aria-describedby={errors.taxId ? "taxId-error" : undefined}
                  placeholder="Ej. XAXX010101000"
                  {...register("taxId")}
                />
                {errors.taxId && (
                  <p id="taxId-error" className="text-xs text-destructive">
                    {errors.taxId.message}
                  </p>
                )}
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" loading={isSubmitting || create.isPending}>
                  Crear cliente
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </Section>
        )}

        <Section title="Clientes" padded={false}>
          <div className="flex flex-col gap-3 border-b border-hairline-soft p-4 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, correo, teléfono o RFC…"
                className="pl-9"
                aria-label="Buscar clientes"
              />
            </div>
            <Select
              aria-label="Filtrar por etiqueta"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full sm:w-56"
            >
              <option value="">Todas las etiquetas</option>
              {(tagsQ.data ?? []).map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="customers-pending"
                checked={pendingOnly}
                onChange={(e) => setPendingOnly(e.target.checked)}
              />
              <Label htmlFor="customers-pending">Con cobro pendiente</Label>
              <InfoTip
                label="Con cobro pendiente"
                text="Solo clientes con al menos una sesión de pago abierta (checkout enviado y sin pagar)."
              />
            </div>
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                className="sm:ml-auto"
                onClick={() => {
                  setSearch("");
                  setTag("");
                  setPendingOnly(false);
                }}
              >
                Limpiar filtros
              </Button>
            ) : null}
          </div>
          <DataTable
            columns={columns}
            rows={list.rows}
            isLoading={list.isLoading}
            isError={list.isError}
            error={list.error}
            onRetry={() => void list.refetch()}
            pagination={list.paged ? <TablePager {...list.pagerProps} /> : undefined}
            getRowHref={(c) => `/customers/${c.id}`}
            getRowActionLabel={(c) => `Ver ficha de ${c.fullName}`}
            caption="Clientes del comercio"
            empty={{
              icon: <Users className="h-6 w-6" />,
              title: filtered ? "Ningún cliente coincide" : "Todavía no hay clientes",
              description: filtered
                ? "Prueba con otro nombre, etiqueta o quita el filtro de cobros pendientes."
                : canWrite
                  ? "Registra al primer contacto para poder cotizarle y cobrarle desde el portal."
                  : "Los clientes aparecerán aquí cuando alguien del equipo los registre o escriban por WhatsApp.",
              action:
                canWrite && !filtered ? (
                  <Button onClick={() => setShowForm(true)}>
                    <UserPlus className="h-4 w-4" />
                    Nuevo cliente
                  </Button>
                ) : undefined,
            }}
          />
        </Section>
      </div>
    </div>
  );
}
