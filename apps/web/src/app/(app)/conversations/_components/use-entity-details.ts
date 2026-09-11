"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";

/**
 * Lecturas de detalle que las hojas de la bandeja abren SOBRE la conversación
 * (pedido, cotización, sesión de pago). No hay endpoints nuevos: son los
 * mismos tres que ya usan `/orders/[id]`, `/quotes/[id]` y `/payments/[id]`, y
 * a propósito comparten su `queryKey` (`["order", id]`, `["quote", id]`,
 * `["payment-session", id]`) para que abrir la hoja y luego "Abrir en su
 * página" no vuelva a pegarle al API.
 *
 * **Se piden al abrir, nunca antes.** El panel de contexto lista decenas de
 * renglones; precargar el detalle de cada uno sería un N+1 contra el API por
 * conversación seleccionada. `enabled: !!id` mantiene la consulta apagada
 * hasta que alguien abre esa fila en concreto.
 */

// ---------------------------------------------------------------------------
// Pedido — GET /orders/:id
// ---------------------------------------------------------------------------

export interface OrderDetailLine {
  variantId: string;
  quantity: string;
  sku: string | null;
  title: string | null;
  productTitle: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface OrderDetailPaymentSession {
  id: string;
  status: string;
  amount: string;
  refundedTotal: string;
  currency: string;
  createdAt: string;
  capturedAt: string | null;
  failedAt: string | null;
}

/** Solo lo que la hoja necesita: el modo de entrega vive en la revisión vigente. */
export interface OrderDetailRevision {
  id: string;
  deliveryMode: string;
}

export interface OrderDetail {
  id: string;
  status: string;
  source: string;
  quoteId: string | null;
  currentRevisionId: string | null;
  description: string | null;
  total: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  createdAt: string;
  placedAt: string | null;
  paidAt: string | null;
  requiresInvoice: boolean;
  invoiceStatus: string;
  invoiceRfc: string | null;
  invoiceLegalName: string | null;
  invoicePostalCode: string | null;
  invoiceCfdiUse: string | null;
  invoiceRequestedAt: string | null;
  customer: { id: string; fullName: string; email: string | null; phone: string | null };
  lines: OrderDetailLine[];
  revisions: OrderDetailRevision[];
  payments: OrderDetailPaymentSession[];
}

export function useOrderDetail(id: string | null) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const res = await api.get<{ data: OrderDetail }>(`/orders/${id!}`);
      return res.data.data;
    },
    enabled: !!id,
  });
}

/**
 * Link de pago del pedido que sigue abierto. Mismo endpoint que usa el botón
 * "Pagar pedido" de `/orders/[id]`: no crea un cobro nuevo, reabre el checkout
 * vigente y devuelve su token.
 */
export function useResumeCheckout(orderId: string | null) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { checkoutToken: string } }>(
        `/orders/${orderId!}/checkout/resume`,
      );
      return `${window.location.origin}/checkout/${res.data.data.checkoutToken}`;
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, "No se pudo generar el link de pago")),
  });
}

// ---------------------------------------------------------------------------
// Cotización — GET /quotes/:id
// ---------------------------------------------------------------------------

export interface QuoteDetailLine {
  id: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  lineSubtotal: string;
}

export interface QuoteDetail {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  expiresAt: string;
  notes: string | null;
  version: number;
  editable: boolean;
  customer: { fullName: string; email: string | null };
  order: { id: string; status: string } | null;
  lines: QuoteDetailLine[];
}

export function useQuoteDetail(id: string | null) {
  return useQuery({
    queryKey: ["quote", id],
    queryFn: async () => {
      const res = await api.get<{ data: QuoteDetail }>(`/quotes/${id!}`);
      return res.data.data;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Sesión de pago — GET /payments/sessions/:id
// ---------------------------------------------------------------------------

export interface PaymentLedgerEntry {
  id: string;
  entryType: string;
  amount: string;
  balanceAfter: string;
  description: string;
  recordedAt: string;
}

export interface PaymentSessionDetail {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: string;
  livemode: boolean;
  expiresAt: string;
  createdAt: string;
  capturedAt: string | null;
  failedAt: string | null;
  refundedTotal: string;
  netTotal: string;
  ledger: PaymentLedgerEntry[];
  order: { id: string; status: string; source: string; total: string };
}

export function usePaymentSessionDetail(id: string | null) {
  return useQuery({
    queryKey: ["payment-session", id],
    queryFn: async () => {
      const res = await api.get<{ data: PaymentSessionDetail }>(`/payments/sessions/${id!}`);
      return res.data.data;
    },
    enabled: !!id,
  });
}
