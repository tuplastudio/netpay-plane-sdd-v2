"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DateTime } from "@/components/app/date-time";
import { apiErrorMessage } from "./api-error";
import { TENANT_QUERY_KEY, useTenantMe, type Tenant } from "./tenant";

/**
 * Ficha de la empresa.
 *
 * La identidad (nombre, slug, zona horaria, alta) es de solo lectura: la fija
 * el alta del tenant. Los parámetros comerciales sí se editan desde aquí con
 * `PATCH /tenants/me/settings` — es el "CMS" del negocio, y lo que más se
 * toca es cuánto dura una cotización, cuánto vive el link de pago y cada
 * cuánto se recuerda una cotización sin pagar.
 *
 * Los rangos son los mismos que valida `UpdateBusinessSettingsDto` en el
 * backend, para que el error salga aquí y no como un 400 después de guardar.
 */
const schema = z.object({
  taxRatePct: z.coerce.number().min(0).max(100),
  shippingFlat: z.coerce.number().min(0),
  quoteValidityHours: z.coerce.number().int().min(1).max(8_760),
  quickPayValidityHours: z.coerce.number().int().min(1).max(8_760),
  checkoutReservationMinutes: z.coerce.number().int().min(5).max(43_200),
  maxSellerDiscountPct: z.coerce.number().min(0).max(100),
  quoteReminderEnabled: z.boolean(),
  quoteReminderEveryHours: z.coerce.number().int().min(1).max(720),
  quoteReminderMaxCount: z.coerce.number().int().min(0).max(10),
});

type FormValues = z.infer<typeof schema>;

function toForm(t: Tenant): FormValues {
  return {
    taxRatePct: Number(t.taxRatePct),
    shippingFlat: Number(t.shippingFlat),
    quoteValidityHours: t.quoteValidityHours,
    quickPayValidityHours: t.quickPayValidityHours,
    checkoutReservationMinutes: t.checkoutReservationMinutes,
    maxSellerDiscountPct: Number(t.maxSellerDiscountPct),
    quoteReminderEnabled: t.quoteReminderEnabled,
    quoteReminderEveryHours: t.quoteReminderEveryHours,
    quoteReminderMaxCount: t.quoteReminderMaxCount,
  };
}

/** "168 h" es ilegible para el dueño: se muestra también en días. */
function humanHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "";
  if (hours < 24) return `${hours} h`;
  const days = hours / 24;
  const rounded = Number.isInteger(days) ? days : Math.round(days * 10) / 10;
  return `${hours} h (${rounded} ${rounded === 1 ? "día" : "días"})`;
}

function humanMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
    return `${minutes} min (${rounded} h)`;
  }
  const days = minutes / (60 * 24);
  const rounded = Number.isInteger(days) ? days : Math.round(days * 10) / 10;
  return `${minutes} min (${rounded} ${rounded === 1 ? "día" : "días"})`;
}

interface NumberFieldProps {
  id: keyof FormValues;
  label: string;
  hint?: string;
  suffix?: string;
  step?: string;
  error?: string;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  disabled?: boolean;
}

function NumberField({ id, label, hint, suffix, step, error, register, disabled }: NumberFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step ?? "1"}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
          {...register(id)}
        />
        {suffix ? (
          <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
      {hint || error ? (
        <p
          id={`${id}-hint`}
          className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function BusinessSettingsSection() {
  const queryClient = useQueryClient();
  const tenant = useTenantMe();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Igual que en Marca: un refetch en segundo plano no debe pisar lo que el
  // usuario está escribiendo.
  useEffect(() => {
    if (tenant.data && !isDirty) reset(toForm(tenant.data));
  }, [tenant.data, isDirty, reset]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await api.patch<{ data: Tenant }>("/tenants/me/settings", values);
      return res.data.data;
    },
    onSuccess: async (saved) => {
      toast.success("Parámetros comerciales actualizados");
      reset(toForm(saved));
      await queryClient.invalidateQueries({ queryKey: TENANT_QUERY_KEY });
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, "No se pudieron actualizar los parámetros")),
  });

  const remindersOn = watch("quoteReminderEnabled");
  const quoteHours = watch("quoteValidityHours");
  const quickPayHours = watch("quickPayValidityHours");
  const checkoutMinutes = watch("checkoutReservationMinutes");
  const saving = save.isPending;

  return (
    <Section
      title="Datos de la empresa"
      headerIcon={<Building2 className="h-4 w-4" />}
      description="Identidad del tenant y los parámetros comerciales que puedes ajustar."
    >
      {tenant.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo cargar la empresa</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void tenant.refetch()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : tenant.isLoading || !tenant.data ? (
        <SkeletonText lines={6} announce label="Cargando los datos de la empresa…" />
      ) : (
        <div className="space-y-8">
          <DescriptionList divided>
            <FieldRow label="Nombre" emphasis>
              {tenant.data.name}
            </FieldRow>
            <FieldRow label="Identificador" mono>
              {tenant.data.slug}
            </FieldRow>
            <FieldRow label="Estado">
              <StatusBadge status={tenant.data.status} domain="tenant" />
            </FieldRow>
            <FieldRow label="Zona horaria" mono>
              {tenant.data.timezone}
            </FieldRow>
            <FieldRow label="Alta">
              <DateTime value={tenant.data.createdAt} withTime={false} />
            </FieldRow>
          </DescriptionList>

          <form
            className="space-y-8"
            onSubmit={handleSubmit((values) => save.mutate(values))}
            noValidate
          >
            <fieldset className="space-y-4" disabled={saving}>
              <legend className="text-sm font-medium">Precios</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <NumberField
                  id="taxRatePct"
                  label="IVA"
                  suffix="%"
                  step="0.01"
                  hint="Se aplica al calcular cotizaciones y pedidos nuevos."
                  error={errors.taxRatePct?.message}
                  register={register}
                />
                <NumberField
                  id="shippingFlat"
                  label="Envío fijo"
                  suffix="MXN"
                  step="0.01"
                  hint="Se cobra cuando la dirección no cae en ninguna zona de envío."
                  error={errors.shippingFlat?.message}
                  register={register}
                />
                <NumberField
                  id="maxSellerDiscountPct"
                  label="Descuento máximo del vendedor"
                  suffix="%"
                  step="0.01"
                  hint="Tope que un vendedor puede aplicar sin autorización."
                  error={errors.maxSellerDiscountPct?.message}
                  register={register}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4" disabled={saving}>
              <legend className="text-sm font-medium">Vigencias</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <NumberField
                  id="quoteValidityHours"
                  label="Vigencia de cotización"
                  suffix="h"
                  hint={`Cuánto vale la cotización y su link público. ${humanHours(quoteHours)}`}
                  error={errors.quoteValidityHours?.message}
                  register={register}
                />
                <NumberField
                  id="checkoutReservationMinutes"
                  label="Vigencia del link de pago"
                  suffix="min"
                  hint={`Cuánto vive el enlace de pago que recibe el cliente. ${humanMinutes(checkoutMinutes)}`}
                  error={errors.checkoutReservationMinutes?.message}
                  register={register}
                />
                <NumberField
                  id="quickPayValidityHours"
                  label="Vigencia de cobro rápido"
                  suffix="h"
                  hint={`Cobros sin cotización previa. ${humanHours(quickPayHours)}`}
                  error={errors.quickPayValidityHours?.message}
                  register={register}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4" disabled={saving}>
              <legend className="text-sm font-medium">Recordatorios de pago</legend>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="quoteReminderEnabled"
                  className="mt-0.5"
                  {...register("quoteReminderEnabled")}
                />
                <div>
                  <Label htmlFor="quoteReminderEnabled">
                    Recordar al cliente una cotización sin pagar
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Se manda por el mismo canal del cliente, respetando su baja, el horario
                    09-19 local y la ventana de 24 h de WhatsApp.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <NumberField
                  id="quoteReminderEveryHours"
                  label="Cada"
                  suffix="h"
                  hint="Tiempo mínimo entre un recordatorio y el siguiente."
                  error={errors.quoteReminderEveryHours?.message}
                  register={register}
                  disabled={!remindersOn}
                />
                <NumberField
                  id="quoteReminderMaxCount"
                  label="Máximo por cotización"
                  hint="0 apaga los recordatorios de esta cotización en adelante."
                  error={errors.quoteReminderMaxCount?.message}
                  register={register}
                  disabled={!remindersOn}
                />
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!isDirty || saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </Button>
              {isDirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => tenant.data && reset(toForm(tenant.data))}
                >
                  Descartar
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      )}
    </Section>
  );
}
