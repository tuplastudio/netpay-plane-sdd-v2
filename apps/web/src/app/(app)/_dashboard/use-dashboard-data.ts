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

  const unified = useQuery({
    queryKey: ["reports-dashboard"],
    queryFn: async () => {
      const res = await api.get<{ data: UnifiedDashboard }>("/reports/dashboard");
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  return { summary, activity, unified, NEAR_EXPIRY_DAYS };
}

/**
 * Respuesta de `GET /reports/dashboard`. Concentra KPIs operativos + serie
 * de 7 días + listas cortas de pedidos, conversaciones y bitácora para
 * alimentar la home del portal sin muestrear nada en cliente.
 */
export interface UnifiedDashboard {
  kpis: {
    customers: { total: number; newToday: number };
    orders: { today: number; mtd: number };
    revenue: { today: string; mtd: string };
    captured: { gross: string; refunded: string; net: string };
    outstanding: { total: string; count: number };
    issuedQuotes: number;
    products: { active: number; draft: number };
    conversations: { open: number; escalated: number };
  };
  salesTrend: Array<{ day: string; orders: number; revenueUsd: string }>;
  recentOrders: Array<{
    id: string;
    status: string;
    total: string;
    createdAt: string;
    customer: { id: string; fullName: string | null } | null;
  }>;
  recentConversations: Array<{
    id: string;
    externalPhone: string;
    status: string;
    handoffToHuman: boolean;
    lastMessageAt: string | null;
    customerId: string | null;
  }>;
  recentActivity: Array<AuditEvent & { actor: { id: string; email: string; fullName: string | null } | null }>;
  generatedAt: string;
}
