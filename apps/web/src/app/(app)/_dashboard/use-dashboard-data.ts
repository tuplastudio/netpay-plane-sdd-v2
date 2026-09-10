"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Datos del dashboard.
 *
 * Antes esta pantalla pedía seis listados (`/payments/sessions`, `/orders`,
 * `/quotes`, `/catalog/products`, `/whatsapp/conversations`) y agregaba en el
 * cliente. Todos vienen cortados en servidor (50 filas, 100 en catálogo), así
 * que cada cifra describía una ventana y no el negocio, y la interfaz tenía
 * que confesarlo mosaico por mosaico.
 *
 * Ahora el API calcula los agregados en SQL sobre las tablas completas y esto
 * es una sola consulta: `GET /reports/summary`. No queda aritmética de cliente
 * ni ventana que revelar; los importes llegan ya como string decimal y van
 * directos a `<Money>`.
 *
 * "Actividad reciente" sigue siendo `/audit/events`: es una lista de los
 * últimos eventos, no un agregado, y su límite es intencional.
 */

const RECENT_ACTIVITY_LIMIT = 8;

/** Horizonte de vencimiento que aplica el backend en `quotesExpiringWithin7Days`. */
export const NEAR_EXPIRY_DAYS = 7;

/**
 * Respuesta de `GET /reports/summary`, tal cual la define
 * `apps/commerce-api/src/reports/reports.service.ts`.
 *
 * El dinero viaja como string decimal ("12500.75") porque en el backend es
 * `Decimal(12,2)`; convertirlo a `number` en el borde perdería centavos.
 */
export interface ReportSummary {
  /** Σ de lo cobrado, sin descontar reembolsos. */
  capturedGross: string;
  /** Σ de los reembolsos registrados en el ledger. */
  refundedTotal: string;
  /** `capturedGross - refundedTotal`. Lo cobrado que sigue vivo. */
  capturedNet: string;
  /** Σ del total de los pedidos que esperan cobro. */
  outstandingTotal: string;
  outstandingCount: number;
  issuedQuotes: number;
  quotesExpiringWithin7Days: number;
  activeProducts: number;
  draftProducts: number;
  openConversations: number;
  escalatedConversations: number;
}

/** Fila de AuditLog tal cual la devuelve GET /audit/events. */
export interface AuditEvent {
  id: string;
  action: string;
  createdAt: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
}

/**
 * Agregados del comercio. Clave de caché compartida con la pantalla de pagos,
 * que consume el mismo endpoint: navegar entre ambas no repite la petición.
 */
export function useReportSummary() {
  return useQuery({
    queryKey: ["reports-summary"],
    queryFn: async () => {
      const res = await api.get<{ data: ReportSummary }>("/reports/summary");
      return res.data.data;
    },
  });
}

export function useDashboardData() {
  const summary = useReportSummary();

  const activity = useQuery({
    queryKey: ["audit", { limit: RECENT_ACTIVITY_LIMIT }],
    queryFn: async () => {
      const res = await api.get<{ data: AuditEvent[] }>("/audit/events", {
        params: { limit: RECENT_ACTIVITY_LIMIT },
      });
      return res.data.data;
    },
  });

  return { summary, activity, NEAR_EXPIRY_DAYS };
}
