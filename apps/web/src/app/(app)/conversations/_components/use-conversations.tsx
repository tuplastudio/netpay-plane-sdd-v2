"use client";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  customerId: string | null;
  /** Ficha vinculada, resuelta por el API en una consulta por página. */
  customer: { id: string; fullName: string } | null;
  externalPhone: string;
  /** ConversationStatus: OPEN | HANDED_OFF | CLOSED */
  status: string;
  handoffToHuman: boolean;
  handoffUserId: string | null;
  handoffUser: { id: string; fullName: string } | null;
  tags: string[];
  lastMessageAt: string | null;
  /** El último mensaje es del cliente y nadie ha contestado. */
  unanswered: boolean;
  /** Última vez que escribió el cliente. */
  lastInboundAt: string | null;
  /** Adelanto de texto del último mensaje, para la lista de la bandeja. */
  lastMessagePreview: string | null;
  connection: { provider: string; phoneNumber: string | null };
}

/** Agente humano activo en WhatsApp, con cuántos hilos lleva ahora. */
export interface Agent {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  activeConversations: number;
}

/** KPIs del tenant completo (el API los calcula sin aplicar los filtros). */
export interface ConversationStats {
  open: number;
  handedOff: number;
  unanswered: number;
  today: number;
  /** Transferidos sin dueño: la pestaña "Cola". */
  queue: number;
  /** Transferidos con dueño: la pestaña "Por agente". */
  assigned: number;
}

export interface ConversationList {
  data: Conversation[];
  stats: ConversationStats;
}

export type HandoffFilter = "all" | "agent" | "human";
export type RangeFilter = "all" | "today" | "7d" | "30d";
/**
 * Orden del listado. `oldest` es el orden de triage: lo que lleva más tiempo
 * sin moverse, primero. Lo resuelve el API en el índice `(tenantId,
 * lastMessageAt)`; no se reordena aquí una página ya truncada.
 */
export type SortFilter = "recent" | "oldest";

/**
 * Vistas guardadas de la bandeja. No son tres pantallas distintas: son el
 * mismo listado con un `assignee` distinto, y TODOS los filtros aplican a las
 * tres.
 */
export type InboxView = "inbox" | "queue" | "byAgent";

/** Filtros de la bandeja. Viajan en la URL y de ahí al API. */
export interface ConversationFilters {
  q: string;
  handoff: HandoffFilter;
  status: ConversationStatus | "";
  provider: string;
  range: RangeFilter;
  tag: string;
  sort: SortFilter;
  view: InboxView;
  /** Persona dueña del hilo; solo se usa dentro de la vista "Por agente". */
  agent: string;
}

export const DEFAULT_FILTERS: ConversationFilters = {
  q: "",
  handoff: "all",
  status: "",
  provider: "",
  range: "all",
  tag: "",
  sort: "recent",
  view: "inbox",
  agent: "",
};

/**
 * `assignee` que le toca a cada vista. La "Cola" es la cola sin dueño; "Por
 * agente" acota a una persona si se eligió una, y si no deja que el API
 * devuelva todo (el filtro `handoff=human` de la vista se encarga del resto).
 */
export function assigneeFor(filters: ConversationFilters): string | undefined {
  if (filters.view === "queue") return "unassigned";
  if (filters.view === "byAgent") return filters.agent || undefined;
  return undefined;
}

/**
 * Tope del listado. El API no pagina conversaciones por cursor (ordena por
 * `lastMessageAt`, no por `updatedAt`), así que se pide el máximo permitido y
 * los filtros acotan el resto.
 */
export const CONVERSATIONS_LIMIT = 100;

export type MessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION"
  | "TEMPLATE";

/**
 * Quién originó un mensaje saliente. El API todavía NO lo manda: cuando falta,
 * la UI rotula el saliente como neutro ("Enviado") en vez de inventar la
 * autoría a partir del estado ACTUAL del hilo (que no dice nada de mensajes
 * pasados).
 */
export type MessageSender = "BOT" | "HUMAN" | "SYSTEM";

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
  /** Acuses de WhatsApp (columnas de `WhatsAppMessage`; opcionales por compatibilidad). */
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  /** Solo LOCATION: coordenadas compartidas por el cliente. */
  latitude?: number | null;
  longitude?: number | null;
  /** Solo DOCUMENT (cuando el API los exponga): nombre y tamaño del archivo. */
  filename?: string | null;
  fileSize?: number | null;
  /** Autoría por mensaje, si el API la llega a mandar. */
  sender?: MessageSender | null;
  senderUser?: { id: string; fullName: string } | null;
}

/**
 * Página de `GET conversations/:id/messages?limit=&before=`. `pageInfo` es
 * opcional: el API anterior devuelve todo el hilo sin paginar, y ahí la UI
 * simplemente no ofrece "Cargar anteriores".
 */
export interface MessagesPage {
  data: Message[];
  pageInfo?: { hasMore: boolean; nextBefore: string | null };
}

/** Tamaño de página del hilo. */
export const MESSAGES_PAGE_SIZE = 50;

/** Tope de WhatsApp para un mensaje de texto. */
export const WHATSAPP_TEXT_MAX = 4096;

/** Nota interna del hilo: la ve el equipo, nunca el cliente. */
export interface ConversationNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string; email: string } | null;
}

/** Nota interna sobre UN mensaje puntual (mismo shape que `ConversationNote`). */
export type MessageNote = ConversationNote;

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

/**
 * Intervalo de refresco que solo corre con la pestaña visible. TanStack ya
 * pausa `refetchInterval` en segundo plano (`refetchIntervalInBackground`
 * es `false` por defecto); esta función lo hace explícito y además evita
 * disparar el primer tick si el documento ya está oculto.
 */
function whenVisible(ms: number) {
  return () =>
    typeof document === "undefined" || document.visibilityState === "visible" ? ms : false;
}

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
          tag: filters.tag || undefined,
          sort: filters.sort === "recent" ? undefined : filters.sort,
          assignee: assigneeFor(filters),
          // "Por agente" son, por definición, los hilos que lleva una persona.
          ...(filters.view === "byAgent" && !filters.agent ? { handoff: "human" } : {}),
        },
      });
      return res.data;
    },
    // Al cambiar un filtro la tabla conserva las filas previas en vez de
    // parpadear a skeleton; las KPIs no dependen del filtro y tampoco saltan.
    placeholderData: keepPreviousData,
    // Bandeja en vivo: lista + KPIs cada 10 s mientras la pestaña se ve.
    refetchInterval: whenVisible(10_000),
    refetchIntervalInBackground: false,
  });
}

/**
 * Hilo paginado hacia atrás. La primera página es la MÁS RECIENTE (orden
 * ascendente dentro de la página); `fetchNextPage` trae la anterior con
 * `before=pageInfo.nextBefore`. Para pintar, usar `flattenMessages`.
 *
 * `pollMs`: 5 s si atiende una persona, 15 s si atiende el bot; se pausa con
 * la pestaña oculta.
 */
export function useMessages(
  conversationId: string | undefined,
  opts?: { pollMs?: number | false },
) {
  const pollMs = opts?.pollMs ?? false;
  return useInfiniteQuery({
    queryKey: ["whatsapp-messages", conversationId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<MessagesPage> => {
      const res = await api.get<MessagesPage>(
        `/whatsapp/conversations/${conversationId!}/messages`,
        { params: { limit: MESSAGES_PAGE_SIZE, before: pageParam ?? undefined } },
      );
      return { data: res.data.data, pageInfo: res.data.pageInfo };
    },
    getNextPageParam: (last) =>
      last.pageInfo?.hasMore && last.pageInfo.nextBefore ? last.pageInfo.nextBefore : undefined,
    enabled: !!conversationId,
    refetchInterval: pollMs ? whenVisible(pollMs) : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Páginas (más reciente primero) → lista ascendente sin duplicados. Si el API
 * todavía no pagina, hay una sola página y esto la devuelve tal cual.
 */
export function flattenMessages(pages: MessagesPage[] | undefined): Message[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: Message[] = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    for (const m of pages[i]!.data) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
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

/**
 * Mensaje del API cuando la regla o la validación rechazan la acción. El
 * `HttpExceptionFilter` (apps/commerce-api/src/common/filters) manda el
 * mensaje anidado en `error.message` (`{ error: { code, message, … },
 * requestId }`), no plano en `data.message` — de ahí que se revise primero
 * ese anidado y solo si falta se caiga al plano, antes del fallback fijo.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (
    error as { response?: { data?: { message?: unknown; error?: { message?: unknown } } } }
  )?.response?.data;
  const msg = data?.error?.message ?? data?.message;
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
      // Las notas del hilo se asoman también en el panel de contexto y en la
      // línea de tiempo: ambas viven en la query del contexto.
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", conversationId] });
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

// ---------------------------------------------------------------------------
// Notas por mensaje, etiquetas de hilo y agentes humanos (bandeja fase 2)
// ---------------------------------------------------------------------------

export function useMessageNotes(messageId: string | undefined) {
  return useQuery({
    queryKey: ["whatsapp-message-notes", messageId],
    queryFn: async () => {
      const res = await api.get<{ data: MessageNote[] }>(`/whatsapp/messages/${messageId!}/notes`);
      return res.data.data;
    },
    enabled: !!messageId,
  });
}

export function useAddMessageNote(messageId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await api.post<{ data: MessageNote }>(
        `/whatsapp/messages/${messageId!}/notes`,
        { body },
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Nota guardada");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-message-notes", messageId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo guardar la nota")),
  });
}

/** Reemplaza las etiquetas del hilo (chips: agregar/quitar). */
export function useSetTags(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tags: string[]) => {
      const res = await api.patch<{ data: Conversation }>(
        `/whatsapp/conversations/${conversationId!}/tags`,
        { tags },
      );
      return res.data.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", conversationId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudieron guardar las etiquetas")),
  });
}

/** Personas activas como agente de WhatsApp, con su carga actual. */
export function useAgents() {
  return useQuery({
    queryKey: ["whatsapp-agents"],
    queryFn: async () => {
      const res = await api.get<{ data: Agent[] }>("/whatsapp/agents");
      return res.data.data;
    },
  });
}

/** "Tomar": el usuario en sesión se asigna un hilo de la cola sin asignar. */
export function useClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      await api.post(`/whatsapp/conversations/${conversationId}/claim`);
    },
    onSuccess: async () => {
      toast.success("Conversación asignada a ti");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo tomar la conversación")),
  });
}

/**
 * Cerrar / reabrir un hilo a mano (`PATCH conversations/:id/status`). Es lo que
 * convierte la bandeja en una cola de tickets: hasta ahora solo el job de
 * inactividad podía cerrar, y nada podía reabrir.
 *
 * Invalida también el contexto porque el cierre/reapertura deja una entrada en
 * la línea de tiempo de "Actividad".
 */
export function useSetConversationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "OPEN" | "CLOSED" }) => {
      const res = await api.patch<{ data: Conversation }>(
        `/whatsapp/conversations/${input.id}/status`,
        { status: input.status },
      );
      return res.data.data;
    },
    onSuccess: async (_data, input) => {
      toast.success(input.status === "CLOSED" ? "Conversación cerrada" : "Conversación reabierta");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", input.id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar el estado")),
  });
}

/**
 * Manda texto (típicamente un link de cotización) aunque el hilo siga con el
 * agente. Endpoint dedicado: no afloja la regla de `useReply`.
 */
export function useSendQuoteMessage(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await api.post<{ data: Message }>(
        `/whatsapp/conversations/${conversationId!}/send-quote`,
        { body },
      );
      return res.data.data;
    },
    onSuccess: async (message) => {
      if (message.status === "FAILED") {
        toast.error(message.errorMessage ?? "WhatsApp no aceptó el mensaje");
      } else {
        toast.success("Cotización enviada por WhatsApp");
      }
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo enviar la cotización")),
  });
}
