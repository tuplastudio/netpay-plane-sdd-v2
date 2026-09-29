"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";
import { formatAddress, type CustomerAddress } from "./customer-types";
import { Tip } from "@/components/app/info-tip";

const schema = z.object({
  label: z.string().trim().min(1, "Ponle un nombre (Casa, Oficina…)").max(100, "Máximo 100 caracteres"),
  line1: z.string().trim().min(1, "La calle y número son obligatorios").max(200, "Máximo 200 caracteres"),
  line2: z.string().trim().max(200, "Máximo 200 caracteres").optional().or(z.literal("")),
  city: z.string().trim().min(1, "La ciudad es obligatoria").max(100, "Máximo 100 caracteres"),
  state: z.string().trim().min(1, "El estado es obligatorio").max(100, "Máximo 100 caracteres"),
  postalCode: z.string().trim().regex(/^\d{5}$/, "El código postal son 5 dígitos"),
  country: z.string().trim().max(60, "Máximo 60 caracteres").optional().or(z.literal("")),
  isDefault: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "MX",
  isDefault: false,
};

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Direcciones del cliente: varias, una predeterminada. Alta con
 * `POST /customers/:id/addresses`, edición/predeterminada con `PATCH
 * …/addresses/:addressId` y baja con `DELETE`. Máximo 20 (tope del DTO de alta).
 */
export function CustomerAddresses({
  customerId,
  addresses,
  canWrite,
}: {
  customerId: string;
  addresses: CustomerAddress[];
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CustomerAddress | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomerAddress | null>(null);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["customer", customerId] }),
      qc.invalidateQueries({ queryKey: ["customer-summary", customerId] }),
    ]);
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (editing === null) return;
    if (editing === "new") {
      reset({ ...EMPTY, isDefault: addresses.length === 0 });
    } else {
      reset({
        label: editing.label,
        line1: editing.line1,
        line2: editing.line2 ?? "",
        city: editing.city,
        state: editing.state,
        postalCode: editing.postalCode,
        country: editing.country,
        isDefault: editing.isDefault,
      });
    }
  }, [editing, addresses.length, reset]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        label: v.label,
        line1: v.line1,
        line2: v.line2 || undefined,
        city: v.city,
        state: v.state,
        postalCode: v.postalCode,
        country: v.country || "MX",
        isDefault: !!v.isDefault,
      };
      if (editing === "new") {
        await api.post(`/customers/${customerId}/addresses`, payload);
      } else if (editing) {
        await api.patch(`/customers/${customerId}/addresses/${editing.id}`, payload);
      }
    },
    onSuccess: async () => {
      toast.success(editing === "new" ? "Dirección agregada" : "Dirección actualizada");
      setEditing(null);
      await invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo guardar la dirección")),
  });

  const setDefault = useMutation({
    mutationFn: async (addressId: string) => {
      await api.patch(`/customers/${customerId}/addresses/${addressId}`, { isDefault: true });
    },
    onSuccess: async () => {
      toast.success("Dirección predeterminada actualizada");
      await invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo marcar como predeterminada")),
  });

  const remove = useMutation({
    mutationFn: async (addressId: string) => {
      await api.delete(`/customers/${customerId}/addresses/${addressId}`);
    },
    onSuccess: async () => {
      toast.success("Dirección eliminada");
      setDeleting(null);
      await invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "No se pudo eliminar la dirección")),
  });

  const sorted = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return (
    <Section
      title="Direcciones"
      headerIcon={<MapPin className="h-4 w-4" />}
      density="compact"
      actions={
        canWrite && addresses.length < 20 ? (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Agregar
          </Button>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene direcciones registradas.
          {canWrite ? " Agrega la primera para usarla en envíos." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-hairline-soft">
          {sorted.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-0.5">
                <p className="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {a.label}
                  {a.isDefault ? (
                    <Badge variant="info" size="sm">
                      Predeterminada
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">{formatAddress(a)}</p>
              </div>
              {canWrite ? (
                <div className="flex shrink-0 items-center">
                  {!a.isDefault ? (
                    <Tip label={`Marcar ${a.label} como predeterminada`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Marcar ${a.label} como predeterminada`}
                        onClick={() => setDefault.mutate(a.id)}
                        loading={setDefault.isPending && setDefault.variables === a.id}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    </Tip>
                  ) : null}
                  <Tip label={`Editar ${a.label}`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${a.label}`}
                      onClick={() => setEditing(a)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Tip>
                  <Tip label={`Eliminar ${a.label}`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Eliminar ${a.label}`}
                      onClick={() => setDeleting(a)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Tip>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{editing === "new" ? "Nueva dirección" : "Editar dirección"}</SheetTitle>
            <SheetDescription>
              Se usa para envíos y para calcular la zona de entrega.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={handleSubmit((v) => save.mutate(v))}
            className="flex min-h-0 flex-1 flex-col"
            noValidate
          >
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <Field id="addr-label" label="Nombre" error={errors.label?.message}>
                <Input
                  id="addr-label"
                  placeholder="Casa, Oficina, Bodega…"
                  aria-invalid={!!errors.label}
                  aria-describedby={errors.label ? "addr-label-error" : undefined}
                  {...register("label")}
                />
              </Field>
              <Field id="addr-line1" label="Calle y número" error={errors.line1?.message}>
                <Input
                  id="addr-line1"
                  placeholder="Av. Reforma 123"
                  aria-invalid={!!errors.line1}
                  aria-describedby={errors.line1 ? "addr-line1-error" : undefined}
                  {...register("line1")}
                />
              </Field>
              <Field id="addr-line2" label="Colonia / referencias" error={errors.line2?.message}>
                <Input
                  id="addr-line2"
                  placeholder="Col. Centro, entre X y Y"
                  aria-invalid={!!errors.line2}
                  {...register("line2")}
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="addr-postalCode" label="Código postal" error={errors.postalCode?.message}>
                  <Input
                    id="addr-postalCode"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="06600"
                    aria-invalid={!!errors.postalCode}
                    aria-describedby={errors.postalCode ? "addr-postalCode-error" : undefined}
                    {...register("postalCode")}
                  />
                </Field>
                <Field id="addr-city" label="Ciudad" error={errors.city?.message}>
                  <Input
                    id="addr-city"
                    aria-invalid={!!errors.city}
                    aria-describedby={errors.city ? "addr-city-error" : undefined}
                    {...register("city")}
                  />
                </Field>
                <Field id="addr-state" label="Estado" error={errors.state?.message}>
                  <Input
                    id="addr-state"
                    aria-invalid={!!errors.state}
                    aria-describedby={errors.state ? "addr-state-error" : undefined}
                    {...register("state")}
                  />
                </Field>
                <Field id="addr-country" label="País" error={errors.country?.message}>
                  <Input id="addr-country" placeholder="MX" aria-invalid={!!errors.country} {...register("country")} />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="addr-isDefault" {...register("isDefault")} />
                <Label htmlFor="addr-isDefault">Usar como dirección predeterminada</Label>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={save.isPending}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={save.isPending}>
                {editing === "new" ? "Agregar dirección" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `¿Eliminar la dirección «${deleting.label}»?` : "¿Eliminar dirección?"}
        description="Los pedidos ya creados conservan su dirección de envío; solo desaparece de la ficha."
        confirmLabel="Eliminar dirección"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Section>
  );
}
