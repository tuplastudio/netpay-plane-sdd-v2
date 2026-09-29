"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, FileText, MessageCircle, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { StatTile } from "@/components/app/stat-tile";
import { Money } from "@/components/app/money";
import { DateTime, formatDate } from "@/components/app/date-time";
import type { CustomerSummary } from "./customer-types";

export function useCustomerSummary(customerId: string) {
  return useQuery({
    queryKey: ["customer-summary", customerId],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerSummary }>(`/customers/${customerId}/summary`);
      return res.data.data;
    },
  });
}

/**
 * Tira de KPIs de por vida del cliente. Seis mosaicos: total
 * pagado, pedidos, ticket promedio, última compra, cotizaciones abiertas y
 * cobros pendientes. Cero es un dato; la pista da el contexto.
 */
export function CustomerSummaryTiles({ customerId }: { customerId: string }) {
  const q = useCustomerSummary(customerId);
  const s = q.data;
  const state = {
    isLoading: q.isLoading,
    isError: q.isError,
    onRetry: () => void q.refetch(),
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Total pagado"
        value={<Money value={s?.totalPaid ?? "0"} />}
        tone={s && Number(s.totalPaid) > 0 ? "success" : "neutral"}
        icon={<Wallet className="h-4 w-4" />}
        hint={s ? `${s.paidOrdersCount} pedidos pagados` : undefined}
        {...state}
      />
      <StatTile
        label="Pedidos"
        value={s?.ordersCount ?? 0}
        icon={<ShoppingBag className="h-4 w-4" />}
        hint={
          s && s.refundedOrdersCount > 0 ? `${s.refundedOrdersCount} reembolsados` : "Incluye todos los estados"
        }
        {...state}
      />
      <StatTile
        label="Ticket promedio"
        value={<Money value={s?.averageTicket ?? "0"} />}
        icon={<Receipt className="h-4 w-4" />}
        hint="Sobre pedidos pagados"
        {...state}
      />
      <StatTile
        label="Última compra"
        value={
          s?.lastPurchaseAt ? (
            <DateTime value={s.lastPurchaseAt} withTime={false} />
          ) : (
            <span className="text-muted-foreground">Sin compras</span>
          )
        }
        icon={<Clock className="h-4 w-4" />}
        hint={s?.firstPurchaseAt ? `Primera: ${formatDate(s.firstPurchaseAt)}` : undefined}
        {...state}
      />
      <StatTile
        label="Cotizaciones abiertas"
        value={s?.openQuotesCount ?? 0}
        tone={s && s.openQuotesCount > 0 ? "info" : "neutral"}
        icon={<FileText className="h-4 w-4" />}
        hint={s ? `${s.quotesCount} en total` : undefined}
        {...state}
      />
      <StatTile
        label="Cobros pendientes"
        value={s?.pendingPaymentsCount ?? 0}
        tone={s && s.pendingPaymentsCount > 0 ? "warning" : "neutral"}
        icon={<MessageCircle className="h-4 w-4" />}
        hint={
          s && s.pendingPaymentsCount > 0 ? (
            <>
              <Money value={s.pendingPaymentsAmount} /> por cobrar
            </>
          ) : (
            "Nada por cobrar"
          )
        }
        {...state}
      />
    </div>
  );
}
