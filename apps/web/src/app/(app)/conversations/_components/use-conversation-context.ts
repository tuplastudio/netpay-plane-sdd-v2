"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/app/(app)/admin/_components/api-error";

/**
 * Datos del panel de contexto de la conversación: ficha del cliente, sus
 * compras, sus pagos, las notas del hilo, la línea de tiempo y el cotizador
 * rápido. Vive aparte de `use-conversations.tsx` (que es del hilo de WhatsApp
 * en sí) porque consume otros endpoints — misma separación que ya existe entre
 * `channels` y `conversations`.
 *
 * Todo el contexto viene de UNA sola lectura
 * (`GET /whatsapp/conversations/:id/context`). Antes eran `/customers/:id` +
 * `/customers/:id/history` cosidos aquí, y no había de dónde sacar pagos ni
 * actividad; ahora el API los arma junto con los agregados de gasto en un
 * `Promise.all` de consultas acotadas (ver `conversation-context.service.ts`).
 */

export type TimelineKind = "conversation" | "note" | "quote" | "order" | "payment" | "system";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  status: string | null;
  statusDomain: "order" | "quote" | "payment" | null;
  amount: string | null;
  actor: string | null;
  /** Ruta del portal, cuando el evento apunta a algo que se puede abrir. */
  href: string | null;
}

export interface ConversationContext {
  conversation: {
    id: string;
    externalPhone: string;
    status: string;
    tags: string[];
    createdAt: string;
    lastMessageAt: string | null;
  };
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    legalName: string | null;
    status: string;
    createdAt: string;
  } | null;
  metrics: {
    totalSpend: string;
    paidOrders: number;
    orderCount: number;
    quoteCount: number;
    firstContactAt: string;
  };
  orders: Array<{
    id: string;
    status: string;
    source: string;
    total: string;
    createdAt: string;
    paidAt: string | null;
  }>;
  quotes: Array<{
    id: string;
    status: string;
    total: string;
    createdAt: string;
    issuedAt: string | null;
    expiresAt: string;
  }>;
  payments: Array<{
    id: string;
    orderId: string;
    status: string;
    amount: string;
    refundedTotal: string;
    currency: string;
    createdAt: string;
    capturedAt: string | null;
  }>;
  openOrderId: string | null;
  openQuoteId: string | null;
  notes: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; fullName: string; email: string } | null;
  }>;
  timeline: TimelineEvent[];
}

export function useConversationContext(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: ["whatsapp-context", conversationId],
    queryFn: async () => {
      const res = await api.get<{ data: ConversationContext }>(
        `/whatsapp/conversations/${conversationId!}/context`,
      );
      return res.data.data;
    },
    enabled: !!conversationId,
  });
}

/** Crea una ficha de cliente y de inmediato la vincula al hilo (T-WHA, "Crear cliente"). */
export function useCreateAndLinkCustomer(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fullName: string; phone?: string }) => {
      const created = await api.post<{ data: { id: string } }>("/customers", input);
      const customerId = created.data.data.id;
      await api.patch(`/whatsapp/conversations/${conversationId!}/customer`, { customerId });
      return customerId;
    },
    onSuccess: async () => {
      toast.success("Cliente creado y vinculado");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear el cliente")),
  });
}

// ---------------------------------------------------------------------------
// Cotizar rápido
// ---------------------------------------------------------------------------

export interface QuickQuoteVariant {
  id: string;
  sku: string;
  title: string;
  price: string;
  stock: string | null;
}

export interface QuickQuoteProduct {
  id: string;
  sku: string;
  title: string;
  variants: QuickQuoteVariant[];
}

export function useQuickQuoteProducts(enabled: boolean) {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await api.get<{ data: QuickQuoteProduct[] }>("/catalog/products", {
        params: { status: "ACTIVE" },
      });
      return res.data.data;
    },
    enabled,
  });
}

export function useCreateQuickQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerId: string;
      lines: Array<{ variantId: string; quantity: string }>;
    }) => {
      const res = await api.post<{ data: { id: string } }>("/quotes", {
        customerId: input.customerId,
        lines: input.lines,
        issue: true,
      });
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Cotización creada");
      await queryClient.invalidateQueries({ queryKey: ["quotes"] });
      // El panel de contexto muestra la cotización viva y la línea de tiempo.
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo crear la cotización")),
  });
}

/** Link público de la cotización (mismo mecanismo que `/quotes/[id]`: compartir). */
export function useShareQuote() {
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await api.post<{ data: { token: string } }>(`/quotes/${quoteId}/share`);
      return res.data.data.token;
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo generar el link para compartir")),
  });
}
