import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * `GET /tenants/me` devuelve el registro completo de `Tenant`
 * (apps/commerce-api/src/tenants/tenants.controller.ts). Los `Decimal` de
 * Prisma llegan serializados como string.
 */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  taxRatePct: string;
  shippingFlat: string;
  quoteValidityHours: number;
  quickPayValidityHours: number;
  checkoutReservationMinutes: number;
  maxSellerDiscountPct: string;
  quoteReminderEnabled: boolean;
  quoteReminderEveryHours: number;
  quoteReminderMaxCount: number;
  /** Plantillas aprobadas por Meta, por clave interna. `null` = ninguna. */
  whatsappTemplates: Record<string, { name: string; language: string } | string> | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

/** Clave compartida entre "Empresa" y "Marca": una sola petición para ambas. */
export const TENANT_QUERY_KEY = ["tenant-me"] as const;

export function useTenantMe() {
  return useQuery({
    queryKey: TENANT_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<{ data: Tenant }>("/tenants/me");
      return res.data.data;
    },
  });
}
