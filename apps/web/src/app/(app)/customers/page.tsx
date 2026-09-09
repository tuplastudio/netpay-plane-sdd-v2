"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app/page-header";
import { UserPlus } from "lucide-react";

interface Customer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
}

const schema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
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

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Contactos, identidad fiscal y consentimientos."
        actions={
          <Button onClick={() => setShowForm((s) => !s)}>
            <UserPlus className="h-4 w-4" />
            {showForm ? "Cancelar" : "Nuevo cliente"}
          </Button>
        }
      />

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mb-6 grid grid-cols-1 gap-4 rounded-card border bg-card p-4 md:grid-cols-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Nombre completo</Label>
            <Input id="fullName" {...register("fullName")} />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" {...register("phone")} placeholder="+52 1 55 ..." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="taxId">RFC</Label>
            <Input id="taxId" {...register("taxId")} placeholder="XAXX010101000" />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={isSubmitting || create.isPending}>
              {create.isPending ? "Creando..." : "Crear"}
            </Button>
          </div>
        </form>
      )}

      <div className="rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Nombre</th>
              <th className="p-3">Email</th>
              <th className="p-3">Teléfono</th>
              <th className="p-3">RFC</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="p-3 font-medium">{c.fullName}</td>
                <td className="p-3 text-muted-foreground">{c.email ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{c.phone ?? "—"}</td>
                <td className="p-3 font-mono text-xs">{c.taxId ?? "—"}</td>
                <td className="p-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/quotes?customerId=${c.id}`)}
                  >
                    Cotizar →
                  </Button>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Sin clientes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}