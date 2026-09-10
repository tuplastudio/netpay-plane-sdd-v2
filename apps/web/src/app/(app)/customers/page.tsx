"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable, type DataTableColumn } from "@/components/app/data-table";

interface Customer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  /** CustomerStatus — el endpoint devuelve el registro completo. */
  status: string;
}

const schema = z.object({
  fullName: z.string().min(1, "El nombre es obligatorio").max(200, "Máximo 200 caracteres"),
  email: z.string().email("Correo no válido").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  taxId: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function CustomersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const list = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await api.get<{ data: Customer[] }>("/customers");
      return res.data.data;
    },
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
    onError: () => toast.error("No se pudo crear el cliente"),
  });

  const onSubmit = handleSubmit((v) => create.mutate(v));

  const columns: Array<DataTableColumn<Customer>> = [
    {
      key: "fullName",
      header: "Nombre",
      cell: (c) => <span className="font-medium">{c.fullName}</span>,
    },
    {
      key: "email",
      header: "Correo",
      cell: (c) =>
        c.email ? (
          <span className="text-muted-foreground">{c.email}</span>
        ) : (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">Sin correo</span>
          </>
        ),
    },
    {
      key: "phone",
      header: "Teléfono",
      cell: (c) =>
        c.phone ? (
          <span className="text-muted-foreground">{c.phone}</span>
        ) : (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">Sin teléfono</span>
          </>
        ),
    },
    {
      key: "taxId",
      header: "RFC",
      className: "font-mono text-xs",
      cell: (c) =>
        c.taxId ?? (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">Sin RFC</span>
          </>
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
      width: "9rem",
      className: "text-right",
      cell: (c) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/quotes?customerId=${c.id}`)}
        >
          Cotizar
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Contactos, identidad fiscal y consentimientos."
        actions={
          <Button onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
            <UserPlus className="h-4 w-4" />
            {showForm ? "Cancelar" : "Nuevo cliente"}
          </Button>
        }
      />

      <div className="space-y-6">
        {showForm && (
          <Section
            title="Nuevo cliente"
            description="Solo el nombre es obligatorio; el resto se puede completar después."
          >
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input
                  id="fullName"
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
                  placeholder="+52 1 55 ..."
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
                  placeholder="XAXX010101000"
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
          <DataTable
            columns={columns}
            rows={list.data}
            isLoading={list.isLoading}
            isError={list.isError}
            error={list.error}
            onRetry={() => void list.refetch()}
            caption="Clientes del comercio"
            empty={{
              icon: <Users className="h-6 w-6" />,
              title: "Todavía no hay clientes",
              description:
                "Registra al primer contacto para poder cotizarle y cobrarle desde el portal.",
              action: (
                <Button onClick={() => setShowForm(true)}>
                  <UserPlus className="h-4 w-4" />
                  Nuevo cliente
                </Button>
              ),
            }}
          />
        </Section>
      </div>
    </div>
  );
}
