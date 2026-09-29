"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";
import { FIELD_HELP, FieldHelp } from "./field-help";
import { RFC_RE } from "./customer-types";

/**
 * Subconjunto de `GET /customers/:id` que edita este Sheet. Los datos
 * fiscales completos (razón social, CP, régimen, uso CFDI) viven en la
 * pestaña "Datos fiscales"; aquí solo el RFC por ser identidad básica.
 */
interface EditableCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  tags: string[];
  /** Versión actual del cliente (optimistic concurrency del backend). */
  version: number;
}

const schema = z.object({
  fullName: z.string().trim().min(1, "El nombre es obligatorio").max(200, "Máximo 200 caracteres"),
  email: z.string().trim().email("Correo no válido").max(254).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s().-]{6,31}$/, "Teléfono no válido; usa dígitos, con lada (+52…)")
    .optional()
    .or(z.literal("")),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(RFC_RE, "RFC inválido: 12 o 13 caracteres, ej. XAXX010101000")
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000, "Máximo 2000 caracteres").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);
}

/**
 * Editar cliente: `PATCH /customers/:id` exige `expectedVersion` para
 * detectar conflictos (otra persona guardó mientras tanto). El backend
 * contesta `409 CONFLICT` si la versión local no coincide; se recarga la
 * ficha para que el operador vea qué cambió y pueda reintentar.
 */
export function CustomerEditSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: EditableCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", phone: "", taxId: "", notes: "" },
  });

  // Sincroniza el formulario al abrir o al cambiar de cliente: sin esto,
  // editar uno y abrir otro mostraría los valores del primero.
  useEffect(() => {
    if (!customer || !open) return;
    reset({
      fullName: customer.fullName,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      taxId: customer.taxId ?? "",
      notes: customer.notes ?? "",
    });
    setTags(customer.tags ?? []);
    setTagDraft("");
  }, [customer, open, reset]);

  const addTag = () => {
    const t = normalizeTag(tagDraft);
    if (!t) return;
    if (tags.includes(t)) {
      setTagDraft("");
      return;
    }
    if (tags.length >= 20) {
      toast.error("Máximo 20 etiquetas");
      return;
    }
    setTags([...tags, t]);
    setTagDraft("");
  };

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      if (!customer) throw new Error("No hay cliente");
      const payload: Record<string, unknown> = {
        expectedVersion: customer.version,
        fullName: v.fullName,
        tags,
      };
      // El DTO no acepta null: un campo vaciado simplemente no se manda y
      // conserva su valor. Para borrar un dato hoy hay que sobreescribirlo.
      if (v.email) payload.email = v.email;
      if (v.phone) payload.phone = v.phone;
      if (v.taxId) payload.taxId = v.taxId;
      if (v.notes) payload.notes = v.notes;
      const res = await api.patch<{ data: EditableCustomer }>(`/customers/${customer.id}`, payload);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cliente actualizado");
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer", customer?.id] }),
        queryClient.invalidateQueries({ queryKey: ["customer-tags"] }),
      ]);
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error("Alguien más guardó este cliente. Recarga la ficha para reintentar.");
      } else {
        toast.error(apiErrorMessage(error, "No se pudo guardar"));
      }
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Identidad, contacto y etiquetas. Direcciones y datos fiscales se editan en sus pestañas.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-fullName">Nombre completo</Label>
              <Input
                id="edit-customer-fullName"
                placeholder="Nombre y apellidos"
                autoFocus
                aria-invalid={!!errors.fullName}
                aria-describedby={errors.fullName ? "edit-customer-fullName-error" : undefined}
                {...register("fullName")}
              />
              {errors.fullName ? (
                <p id="edit-customer-fullName-error" className="text-xs text-destructive">
                  {errors.fullName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-email">Correo</Label>
              <Input
                id="edit-customer-email"
                type="email"
                placeholder="cliente@ejemplo.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "edit-customer-email-error" : undefined}
                {...register("email")}
              />
              {errors.email ? (
                <p id="edit-customer-email-error" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-phone">Teléfono</Label>
              <Input
                id="edit-customer-phone"
                inputMode="tel"
                placeholder="+52 1 55 …"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "edit-customer-phone-error" : "edit-customer-phone-hint"}
                {...register("phone")}
              />
              {errors.phone ? (
                <p id="edit-customer-phone-error" className="text-xs text-destructive">
                  {errors.phone.message}
                </p>
              ) : (
                <p id="edit-customer-phone-hint" className="text-xs text-muted-foreground">
                  Con lada de país para que «Abrir WhatsApp» funcione.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1">
                <Label htmlFor="edit-customer-taxId">RFC</Label>
                <FieldHelp text={FIELD_HELP.rfc} />
              </span>
              <Input
                id="edit-customer-taxId"
                placeholder="XAXX010101000"
                maxLength={13}
                className="font-mono uppercase"
                aria-invalid={!!errors.taxId}
                aria-describedby={errors.taxId ? "edit-customer-taxId-error" : undefined}
                {...register("taxId")}
              />
              {errors.taxId ? (
                <p id="edit-customer-taxId-error" className="text-xs text-destructive">
                  {errors.taxId.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1">
                <Label htmlFor="edit-customer-tag">Etiquetas</Label>
                <FieldHelp text={FIELD_HELP.tags} />
              </span>
              <div className="flex gap-2">
                <Input
                  id="edit-customer-tag"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="vip, mayoreo… (Enter para agregar)"
                  maxLength={30}
                />
                <Button type="button" variant="outline" onClick={addTag} disabled={!tagDraft.trim()}>
                  Agregar
                </Button>
              </div>
              {tags.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Etiquetas del cliente">
                  {tags.map((t) => (
                    <li key={t}>
                      <Badge variant="info" className="gap-1 pr-1">
                        {t}
                        <button
                          type="button"
                          aria-label={`Quitar etiqueta ${t}`}
                          className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setTags(tags.filter((x) => x !== t))}
                        >
                          <X aria-hidden className="h-3 w-3" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer-notes">Notas de la ficha</Label>
              <Textarea
                id="edit-customer-notes"
                placeholder="Preferencias, acuerdos especiales, contexto para otros vendedores…"
                rows={3}
                aria-invalid={!!errors.notes}
                {...register("notes")}
              />
              {errors.notes ? <p className="text-xs text-destructive">{errors.notes.message}</p> : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={save.isPending}>
              <Save aria-hidden className="h-3.5 w-3.5" />
              Guardar cambios
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
