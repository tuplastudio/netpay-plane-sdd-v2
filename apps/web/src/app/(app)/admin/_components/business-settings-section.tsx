"use client";

import { AlertCircle, Building2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Section } from "@/components/app/section";
import { DescriptionList, FieldRow } from "@/components/app/field-row";
import { DateTime } from "@/components/app/date-time";
import { Money } from "@/components/app/money";
import { useTenantMe } from "./tenant";

/**
 * Ficha de la empresa: identidad y parámetros comerciales del tenant.
 * Solo lectura: el API no expone edición de estos campos desde el portal
 * (únicamente `PATCH /tenants/me/branding`, que vive en la pestaña Marca).
 */
export function BusinessSettingsSection() {
  const tenant = useTenantMe();

  return (
    <Section
      title="Datos de la empresa"
      headerIcon={<Building2 className="h-4 w-4" />}
      description="Identidad y parámetros comerciales del tenant. Solo lectura desde el portal."
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

          <DescriptionList divided>
            <FieldRow label="IVA" numeric>
              {tenant.data.taxRatePct} %
            </FieldRow>
            <FieldRow label="Envío fijo" numeric>
              <Money value={tenant.data.shippingFlat} />
            </FieldRow>
            <FieldRow label="Vigencia de cotización" numeric>
              {tenant.data.quoteValidityHours} h
            </FieldRow>
            <FieldRow label="Vigencia de cobro rápido" numeric>
              {tenant.data.quickPayValidityHours} h
            </FieldRow>
            <FieldRow label="Reserva en checkout" numeric>
              {tenant.data.checkoutReservationMinutes} min
            </FieldRow>
            <FieldRow label="Descuento máximo del vendedor" numeric>
              {tenant.data.maxSellerDiscountPct} %
            </FieldRow>
          </DescriptionList>
        </div>
      )}
    </Section>
  );
}
