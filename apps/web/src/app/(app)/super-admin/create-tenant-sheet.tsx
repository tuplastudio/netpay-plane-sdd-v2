"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, apiErrorMessage } from "../catalog/catalog-shared";

const schema = z.object({
  name: z.string().min(2, "Mínimo 2 caracteres").max(200),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "Minúsculas, números y guion"),
  ownerEmail: z.string().email("Correo inválido"),
  ownerFullName: z.string().min(2, "Mínimo 2 caracteres").max(200),
});
type Values = z.infer<typeof schema>;

interface CreateTenantResult {
  tenantId: string;
  slug: string;
  inviteToken: string;
  inviteExpiresAt: string;
}

export function CreateTenantSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<unknown> | void;
}) {
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "", ownerEmail: "", ownerFullName: "" },
  });

  const create = useMutation({
    mutationFn: async (v: Values) => {
      const res = await api.post<{ data: CreateTenantResult }>("/super-admin/tenants", v);
      return res.data.data;
    },
    onSuccess: async (data) => {
      toast.success("Empresa creada");
      setResult(data);
      form.reset();
      await onCreated();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la empresa")),
  });

  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit((v) => create.mutate(v));

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setResult(null);
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Nueva empresa</SheetTitle>
          <SheetDescription>
            Crea el tenant e invita a su primer propietario. La invitación no envía correo
            todavía: copia el enlace y mándaselo tú.
          </SheetDescription>
        </SheetHeader>

        {result ? (
          <div className="mt-6 space-y-4">
            <Alert variant="info">
              <AlertTitle>Empresa creada: {result.slug}</AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Comparte este enlace con el propietario para que active su cuenta:
                </p>
                <code className="block break-all rounded-md bg-muted p-2 font-mono text-xs">
                  {`${typeof window !== "undefined" ? window.location.origin : ""}/accept-invite?token=${encodeURIComponent(result.inviteToken)}`}
                </code>
              </AlertDescription>
            </Alert>
            <Button variant="outline" className="w-full" onClick={() => close(false)}>
              Cerrar
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            {create.isError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>No se pudo crear la empresa</AlertTitle>
                <AlertDescription>
                  <p>{apiErrorMessage(create.error, "Revisa los campos marcados.")}</p>
                </AlertDescription>
              </Alert>
            ) : null}

            <Field label="Nombre de la empresa" error={errors.name?.message}>
              {(p) => <Input {...p} placeholder="Aglos, S.A." {...form.register("name")} />}
            </Field>
            <Field label="Slug" hint="Identificador único, ej. aglos" error={errors.slug?.message}>
              {(p) => <Input {...p} placeholder="aglos" {...form.register("slug")} />}
            </Field>
            <Field label="Nombre del propietario" error={errors.ownerFullName?.message}>
              {(p) => <Input {...p} placeholder="Nombre completo" {...form.register("ownerFullName")} />}
            </Field>
            <Field label="Correo del propietario" error={errors.ownerEmail?.message}>
              {(p) => <Input type="email" {...p} placeholder="[email protected]" {...form.register("ownerEmail")} />}
            </Field>

            <Button type="submit" className="w-full" loading={create.isPending}>
              {create.isPending ? "Creando…" : "Crear empresa"}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
