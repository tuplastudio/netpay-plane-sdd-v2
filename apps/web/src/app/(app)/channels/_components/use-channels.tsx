"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CHANNEL_LABELS } from "@/components/ui/status-badge";

// ---------------------------------------------------------------------------
// Tipos que devuelve apps/commerce-api/src/whatsapp (solo los campos que usa
// la pantalla; el API manda la fila completa sin `webhookSecretHash`).
// Lo relativo a conversaciones vive en `conversations/_components/use-conversations`.
// ---------------------------------------------------------------------------

export type Provider = "META" | "EVOLUTION";

export interface Connection {
  id: string;
  provider: Provider;
  phoneNumber: string | null;
  /** WhatsAppStatus: PENDING | ACTIVE | DISABLED | ERROR */
  status: string;
  /** URL pública del webhook. La única forma de que un mensaje entrante
   *  llegue al bot es que el operador de Evolution apunte a esta URL. */
  webhookUrl: string | null;
  /** Versión optimista del registro (PATCH envía `expectedVersion`). */
  version: number;
  connectedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface Me {
  id: string;
  tenantSlug: string | null;
}

export function providerLabel(provider: string): string {
  return CHANNEL_LABELS[provider.toUpperCase()] ?? provider;
}

/** Nombre corto de una conexión para títulos y confirmaciones. */
export function connectionName(c: Pick<Connection, "provider" | "phoneNumber">): string {
  return c.phoneNumber ? `${providerLabel(c.provider)} · ${c.phoneNumber}` : providerLabel(c.provider);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const res = await api.get<{ data: Me }>("/auth/me");
      return res.data.data;
    },
  });
}

export function useConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: async () => {
      const res = await api.get<{ data: Connection[] }>("/whatsapp/connections");
      return res.data.data;
    },
    // Consumido también fuera de /channels (ver sidebar-nav.tsx) para saber si
    // hay al menos un canal configurado; ahí se apaga cuando no hay tenant
    // (super-admin sin impersonar) para no pegarle al endpoint sin contexto.
    enabled: options?.enabled ?? true,
  });
}

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

export function useDisconnect(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/whatsapp/${id}/disconnect`);
    },
    onSuccess: async () => {
      toast.success("Canal desconectado");
      onDone?.();
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
    },
    onError: () => toast.error("No se pudo desconectar"),
  });
}

export function useCheckHealth() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ data: { ok: boolean; latencyMs: number; error?: string } }>(
        `/whatsapp/${id}/health`,
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      if (data.ok) toast.success(`Canal en línea (${data.latencyMs} ms)`);
      else toast.error(data.error ?? "El canal no responde");
    },
    onError: () => toast.error("No se pudo verificar el canal"),
  });
}

/**
 * Cambia la URL pública del webhook sin tocar el `webhookSecret` (útil cuando
 * se levanta un túnel nuevo y solo queremos reapuntar Evolution).
 *
 * Devuelve la conexión entera con `version` actualizado — el operador ve el
 * cambio inmediatamente en la lista.
 */
export function useUpdateWebhookUrl(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; webhookUrl: string }) => {
      const res = await api.patch<{ data: Connection }>(
        `/whatsapp/${input.id}/webhook-url`,
        { webhookUrl: input.webhookUrl },
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("URL del webhook actualizada");
      onDone?.();
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-connections"] });
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const message = (error as { response?: { data?: { message?: string } } })?.response
        ?.data?.message;
      if (status === 400) {
        toast.error(message ?? "La URL no es válida: debe ser http(s).");
      } else if (status === 404) {
        toast.error("Canal no encontrado en este comercio.");
      } else {
        toast.error(message ?? "No se pudo actualizar la URL del webhook");
      }
    },
  });
}
