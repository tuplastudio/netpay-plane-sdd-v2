"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { providerLabel, useMe } from "../../channels/_components/use-channels";

// Lo que comparten canales y conversaciones se importa de `channels` y se
// reexporta aquí para que esta carpeta no tenga que conocer la otra ruta.
export { providerLabel, useMe };

// ---------------------------------------------------------------------------
// Tipos que devuelve apps/commerce-api/src/whatsapp (solo los campos que usa
// la pantalla).
// ---------------------------------------------------------------------------

export type ConversationStatus = "OPEN" | "HANDED_OFF" | "CLOSED";

export interface Conversation {
  id: string;
  externalPhone: string;
  /** ConversationStatus: OPEN | HANDED_OFF | CLOSED */
  status: string;
  handoffToHuman: boolean;
  lastMessageAt: string | null;
  /** El último mensaje es del cliente y nadie ha contestado. */
  unanswered: boolean;
  /** Última vez que escribió el cliente. */
  lastInboundAt: string | null;
  connection: { provider: string; phoneNumber: string | null };
}

/** KPIs del tenant completo (el API los calcula sin aplicar los filtros). */
export interface ConversationStats {
  open: number;
  handedOff: number;
  unanswered: number;
  today: number;
}

export interface ConversationList {
  data: Conversation[];
  stats: ConversationStats;
}

export type HandoffFilter = "all" | "agent" | "human";
export type RangeFilter = "all" | "today" | "7d" | "30d";

/** Filtros de la bandeja. Viajan en la URL y de ahí al API. */
export interface ConversationFilters {
  q: string;
  handoff: HandoffFilter;
  status: ConversationStatus | "";
  provider: string;
  range: RangeFilter;
}

export const DEFAULT_FILTERS: ConversationFilters = {
  q: "",
  handoff: "all",
  status: "",
  provider: "",
  range: "all",
};

/**
 * Tope del listado. El API no pagina conversaciones por cursor (ordena por
 * `lastMessageAt`, no por `updatedAt`), así que se pide el máximo permitido y
 * los filtros acotan el resto.
 */
export const CONVERSATIONS_LIMIT = 100;

export type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE";

export interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: MessageType;
  body: string;
  mediaUrl: string | null;
  /** MessageStatus: PENDING | SENT | DELIVERED | READ | FAILED */
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

/** Nota interna del hilo: la ve el equipo, nunca el cliente. */
export interface ConversationNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string; email: string } | null;
}

/** Adjunto tal como lo recibe `POST conversations/:id/attachments`. */
export interface AttachmentPayload {
  filename: string;
  mimetype: string;
  base64: string;
  caption?: string;
}

/** Tope del API para adjuntos (decodificado). Se valida también aquí para no subir de balde. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `from` en ISO para el preset de fechas, calculado en el momento de consultar. */
function rangeFrom(range: RangeFilter, now = new Date()): string | undefined {
  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start.toISOString();
    }
    case "7d":
      return new Date(now.getTime() - 7 * DAY_MS).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * DAY_MS).toISOString();
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useConversations(filters: ConversationFilters = DEFAULT_FILTERS) {
  return useQuery({
    queryKey: ["whatsapp-conversations", filters],
    queryFn: async () => {
      const res = await api.get<ConversationList>("/whatsapp/conversations", {
        params: {
          q: filters.q || undefined,
          handoff: filters.handoff === "all" ? undefined : filters.handoff,
          status: filters.status || undefined,
          provider: filters.provider || undefined,
          from: rangeFrom(filters.range),
          limit: CONVERSATIONS_LIMIT,
        },
      });
      return res.data;
    },
    // Al cambiar un filtro la tabla conserva las filas previas en vez de
    // parpadear a skeleton; las KPIs no dependen del filtro y tampoco saltan.
    placeholderData: keepPreviousData,
  });
}

export function useMessages(
  conversationId: string | undefined,
  opts?: { /** Refresca cada 5 s mientras una persona atiende el hilo. */ poll?: boolean },
) {
  return useQuery({
    queryKey: ["whatsapp-messages", conversationId],
    queryFn: async () => {
      const res = await api.get<{ data: Message[] }>(
        `/whatsapp/conversations/${conversationId!}/messages`,
      );
      return res.data.data;
    },
    enabled: !!conversationId,
    refetchInterval: opts?.poll ? 5_000 : false,
  });
}

export function useNotes(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["whatsapp-notes", conversationId],
    queryFn: async () => {
      const res = await api.get<{ data: ConversationNote[] }>(
        `/whatsapp/conversations/${conversationId!}/notes`,
      );
      return res.data.data;
    },
    enabled: !!conversationId,
  });
}

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

/**
 * Transfiere una conversación a la persona que está usando el portal.
 * Se comparte entre la tabla de conversaciones y el panel del hilo para que
 * ambos disparen exactamente la misma llamada.
 */
export function useHandoff(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      await api.post(`/whatsapp/conversations/${conversationId}/handoff`, { userId: userId! });
    },
    onSuccess: async () => {
      toast.success("Conversación transferida a una persona");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: () => toast.error("No se pudo transferir"),
  });
}

/** Mensaje del API cuando la regla o la validación rechazan la acción. */
function apiErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === "string" && msg ? msg : fallback;
}

/** Texto que una persona manda al cliente en un hilo transferido. */
export function useReply(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await api.post<{ data: Message }>(
        `/whatsapp/conversations/${conversationId!}/reply`,
        { body },
      );
      return res.data.data;
    },
    onSuccess: async (message) => {
      if (message.status === "FAILED") {
        toast.error(message.errorMessage ?? "WhatsApp no aceptó el mensaje");
      }
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo enviar el mensaje")),
  });
}

/**
 * Imagen, nota de voz, video o archivo. Viaja en base64 dentro del JSON, así
 * que el timeout se estira: 25 MB por una conexión normal tardan más de 30 s.
 */
export function useSendAttachment(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AttachmentPayload) => {
      const res = await api.post<{ data: Message }>(
        `/whatsapp/conversations/${conversationId!}/attachments`,
        payload,
        { timeout: 180_000 },
      );
      return res.data.data;
    },
    onSuccess: async (message, payload) => {
      if (message.status === "FAILED") {
        toast.error(`${payload.filename}: ${message.errorMessage ?? "WhatsApp no aceptó el adjunto"}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (error, payload) =>
      toast.error(`${payload.filename}: ${apiErrorMessage(error, "no se pudo enviar")}`),
  });
}

export function useAddNote(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await api.post<{ data: ConversationNote }>(
        `/whatsapp/conversations/${conversationId!}/notes`,
        { body },
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Nota guardada");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-notes", conversationId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo guardar la nota")),
  });
}

/**
 * Regresa el hilo al agente. Compartida entre la tabla y el panel, como
 * `useHandoff`, para que ambos disparen la misma llamada.
 */
export function useReturnToAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await api.post<{ data: Conversation }>(
        `/whatsapp/conversations/${conversationId}/return`,
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Conversación devuelta al agente");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo devolver al agente")),
  });
}
