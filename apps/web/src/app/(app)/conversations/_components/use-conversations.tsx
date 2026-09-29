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

/** Prioridad del ticket (enum `ConversationPriority` del API), de menor a mayor. */
export type ConversationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export const CONVERSATION_PRIORITIES: ConversationPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

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
  /** Help desk (migración 0025). Opcionales por compatibilidad con un API viejo. */
  priority?: ConversationPriority;
  /** Marcado como "pendiente" (espera algo del cliente); `null` = no. */
  pendingAt?: string | null;
  /** Métricas de atención (0023): cuándo entró a la cola humana, cuándo se
   *  tomó, primera respuesta humana desde ese handoff y cierre. */
  handoffAt?: string | null;
  assignedAt?: string | null;
  firstHumanReplyAt?: string | null;
  closedAt?: string | null;
  createdAt?: string;
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
  /** No cerrados marcados como pendientes (esperan al cliente). */
  pending?: number;
  /** Cerrados hoy. */
  resolvedToday?: number;
}

export interface ConversationList {
  data: Conversation[];
  stats: ConversationStats;
  /** Paginado de servidor (limit/offset); ausente con un backend viejo. */
  pageInfo?: { total: number; limit: number; offset: number };
}

export type HandoffFilter = "all" | "agent" | "human";
export type RangeFilter = "all" | "today" | "7d" | "30d";
/**
 * Orden del listado. `oldest` es el orden de triage: lo que lleva más tiempo
 * sin moverse, primero. Lo resuelve el API en el índice `(tenantId,
 * lastMessageAt)`; no se reordena aquí una página ya truncada.
 */
export type SortFilter = "recent" | "oldest" | "priority";

/**
 * Vistas guardadas de la bandeja (estilo Zendesk). No son pantallas
 * distintas: son el mismo listado con un preajuste de `assignee` / estado /
 * pendiente, y TODOS los filtros aplican a todas.
 *
 *  - `inbox`     Bandeja completa.
 *  - `mine`      Mis conversaciones (asignadas a quien mira).
 *  - `queue`     Sin asignar (transferidas a una persona, sin dueño).
 *  - `waiting`   Esperando respuesta (el último mensaje es del cliente).
 *  - `pending`   Pendientes (esperan algo del cliente).
 *  - `resolved`  Resueltas (cerradas).
 *  - `byAgent`   Por agente (tarjetas por persona).
 */
export type InboxView = "inbox" | "mine" | "queue" | "waiting" | "pending" | "resolved" | "byAgent";

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
  /** Prioridad exacta del ticket ("" = todas). */
  priority: ConversationPriority | "";
  /** Solo hilos sin responder (último mensaje del cliente). */
  unanswered: boolean;
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
  priority: "",
  unanswered: false,
};

/**
 * `assignee` que le toca a cada vista. "Sin asignar" es la cola sin dueño;
 * "Mis conversaciones" es quien mira; "Por agente" acota a una persona si se
 * eligió una, y si no deja que el API devuelva todo (el filtro
 * `handoff=human` de la vista se encarga del resto).
 */
export function assigneeFor(filters: ConversationFilters, meId?: string): string | undefined {
  if (filters.view === "queue") return "unassigned";
  if (filters.view === "mine") return meId || undefined;
  if (filters.view === "byAgent") return filters.agent || undefined;
  return undefined;
}

/**
 * Parámetros extra que cada vista guardada preajusta. Un filtro explícito
 * del usuario (p. ej. `status`) gana sobre el de la vista.
 */
export function viewParams(filters: ConversationFilters): Record<string, string | undefined> {
  switch (filters.view) {
    case "waiting":
      return { unanswered: "true" };
    case "pending":
      return { pending: "true" };
    case "resolved":
      return { status: filters.status || "CLOSED" };
    case "byAgent":
      return filters.agent ? {} : { handoff: "human" };
    default:
      return {};
  }
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

export function useConversations(
  filters: ConversationFilters = DEFAULT_FILTERS,
  paging: { page: number; pageSize: number } = { page: 1, pageSize: CONVERSATIONS_LIMIT },
  /** Id de quien mira: lo necesita la vista "Mis conversaciones". */
  meId?: string,
) {
  // "Mis conversaciones" sin sesión resuelta todavía no debe pedir la bandeja
  // completa: espera a `meId` (la query se habilita en cuanto llega).
  const needsMe = filters.view === "mine" && !meId;
  return useQuery({
    queryKey: ["whatsapp-conversations", filters, paging, filters.view === "mine" ? meId : null],
    enabled: !needsMe,
    queryFn: async () => {
      // Preajustes de la vista guardada; un filtro explícito los pisa.
      const preset = viewParams(filters);
      const res = await api.get<ConversationList>("/whatsapp/conversations", {
        params: {
          ...preset,
          q: filters.q || undefined,
          handoff: filters.handoff === "all" ? preset.handoff : filters.handoff,
          status: filters.status || preset.status,
          provider: filters.provider || undefined,
          from: rangeFrom(filters.range),
          limit: paging.pageSize,
          offset: (paging.page - 1) * paging.pageSize || undefined,
          tag: filters.tag || undefined,
          sort: filters.sort === "recent" ? undefined : filters.sort,
          assignee: assigneeFor(filters, meId),
          priority: filters.priority || undefined,
          unanswered: filters.unanswered ? "true" : preset.unanswered,
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
 * Un hilo concreto por id (deep link `?id=` a un hilo que no está en la página
 * visible de la bandeja). Mismo shape que las filas del listado.
 */
export function useConversationById(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["whatsapp-conversation", id],
    enabled: !!id && enabled,
    queryFn: async () => {
      const res = await api.get<ConversationList>("/whatsapp/conversations", {
        params: { id, limit: 1 },
      });
      return res.data.data[0] ?? null;
    },
    refetchInterval: whenVisible(10_000),
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

/**
 * Asigna el hilo a un agente concreto (transferencia entre agentes). El API
 * exige que la persona esté activa como agente.
 */
export function useAssign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; userId: string; name: string }) => {
      await api.post(`/whatsapp/conversations/${input.id}/handoff`, { userId: input.userId });
    },
    onSuccess: async (_d, input) => {
      toast.success(`Conversación asignada a ${input.name}`);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", input.id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo asignar la conversación")),
  });
}

/** Suelta el hilo a la cola: sigue con personas, sin dueño, para que otro lo tome. */
export function useReleaseToQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      await api.post(`/whatsapp/conversations/${conversationId}/release`);
    },
    onSuccess: async (_d, conversationId) => {
      toast.success("Conversación devuelta a la cola");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", conversationId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo devolver a la cola")),
  });
}

// ---------------------------------------------------------------------------
// Help desk: prioridad, pendiente, acciones masivas y respuestas rápidas
// ---------------------------------------------------------------------------

/** `PATCH conversations/:id/priority`. */
export function useSetPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; priority: ConversationPriority }) => {
      const res = await api.patch<{ data: Conversation }>(
        `/whatsapp/conversations/${input.id}/priority`,
        { priority: input.priority },
      );
      return res.data.data;
    },
    onSuccess: async (_d, input) => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", input.id] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", input.id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar la prioridad")),
  });
}

/** `PATCH conversations/:id/pending`: marcar como pendiente / quitar la marca. */
export function useSetPending() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; pending: boolean }) => {
      const res = await api.patch<{ data: Conversation }>(
        `/whatsapp/conversations/${input.id}/pending`,
        { pending: input.pending },
      );
      return res.data.data;
    },
    onSuccess: async (_d, input) => {
      toast.success(
        input.pending ? "Marcada como pendiente del cliente" : "Ya no está pendiente",
      );
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", input.id] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context", input.id] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo cambiar el estado")),
  });
}

export type BulkAction = "assign" | "resolve" | "reopen" | "tag" | "priority" | "pending" | "return";

export interface BulkInput {
  ids: string[];
  action: BulkAction;
  userId?: string;
  tags?: string[];
  priority?: ConversationPriority;
}

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; message: string }>;
}

const BULK_LABEL: Record<BulkAction, string> = {
  assign: "asignadas",
  resolve: "resueltas",
  reopen: "reabiertas",
  tag: "etiquetadas",
  priority: "con prioridad cambiada",
  pending: "marcadas como pendientes",
  return: "devueltas al bot",
};

/** `POST conversations/bulk`: la misma acción sobre varias filas seleccionadas. */
export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkInput) => {
      const res = await api.post<{ data: BulkResult }>("/whatsapp/conversations/bulk", input);
      return res.data.data;
    },
    onSuccess: async (result, input) => {
      const okCount = result.ok.length;
      const failed = result.failed.length;
      if (okCount > 0) {
        toast.success(
          `${okCount} ${okCount === 1 ? "conversación" : "conversaciones"} ${BULK_LABEL[input.action]}`,
        );
      }
      if (failed > 0) {
        toast.error(
          `${failed} no se ${failed === 1 ? "pudo" : "pudieron"}: ${result.failed[0]!.message}`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-agents"] });
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-context"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo aplicar la acción")),
  });
}

/** Respuesta rápida del tenant (`/atajo` en el redactor). */
export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export function useCannedResponses(enabled = true) {
  return useQuery({
    queryKey: ["canned-responses"],
    queryFn: async () => {
      const res = await api.get<{ data: CannedResponse[] }>("/tenants/me/canned-responses");
      return res.data.data;
    },
    enabled,
    staleTime: 60_000,
  });
}

export interface CannedResponseInput {
  shortcut: string;
  title: string;
  body: string;
}

export function useCreateCannedResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CannedResponseInput) => {
      const res = await api.post<{ data: CannedResponse }>("/tenants/me/canned-responses", input);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Respuesta rápida guardada");
      await queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo guardar la respuesta rápida")),
  });
}

export function useUpdateCannedResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<CannedResponseInput>) => {
      const { id, ...patch } = input;
      const res = await api.patch<{ data: CannedResponse }>(
        `/tenants/me/canned-responses/${id}`,
        patch,
      );
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success("Respuesta rápida actualizada");
      await queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo actualizar la respuesta rápida")),
  });
}

export function useDeleteCannedResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tenants/me/canned-responses/${id}`);
    },
    onSuccess: async () => {
      toast.success("Respuesta rápida eliminada");
      await queryClient.invalidateQueries({ queryKey: ["canned-responses"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "No se pudo eliminar la respuesta rápida")),
  });
}

// ---------------------------------------------------------------------------
// Reporte de atención (`GET /reports/attention`)
// ---------------------------------------------------------------------------

export interface AttentionAgentRow {
  userId: string;
  fullName: string;
  email: string;
  active: boolean;
  assignedNow: number;
  handled: number;
  messagesSent: number;
  avgFirstReplySeconds: number | null;
  closed: number;
  avgResolutionSeconds: number | null;
}

export interface AttentionDayRow {
  day: string;
  newConversations: number;
  inbound: number;
  outboundHuman: number;
  outboundBot: number;
}

export interface AttentionReport {
  range: { from: string; to: string; timezone: string };
  overview: {
    newConversations: number;
    escalated: number;
    escalationRate: number | null;
    closed: number;
    unattended: number;
    avgFirstReplySeconds: number | null;
    medianFirstReplySeconds: number | null;
    avgResolutionSeconds: number | null;
    inbound: number;
    outboundHuman: number;
    outboundBot: number;
  };
  now: {
    queue: number;
    oldestQueueWaitSeconds: number | null;
    awaitingReply: number;
    assigned: number;
  };
  agents: AttentionAgentRow[];
  byDay: AttentionDayRow[];
  /** Filtros que el API aplicó (`null` = sin filtrar). */
  filters: { agentId: string | null; provider: "META" | "EVOLUTION" | null };
  /** Hilos con actividad en el rango, por estado y canal actuales. */
  breakdown: {
    byStatus: { OPEN: number; HANDED_OFF: number; CLOSED: number };
    byProvider: { META: number; EVOLUTION: number };
  };
}

export interface AttentionQuery {
  from: string;
  to: string;
  agentId?: string;
  provider?: "META" | "EVOLUTION";
}

export function useAttentionReport(range: AttentionQuery, enabled = true) {
  return useQuery({
    queryKey: ["reports-attention", range],
    queryFn: async () => {
      const res = await api.get<{ data: AttentionReport }>("/reports/attention", {
        params: {
          from: range.from,
          to: range.to,
          agentId: range.agentId || undefined,
          provider: range.provider || undefined,
        },
      });
      return res.data.data;
    },
    placeholderData: keepPreviousData,
    refetchInterval: whenVisible(60_000),
    enabled,
  });
}

/** Duración corta en español: "45 s", "12 min", "3 h 20 min", "2 d". `—` sin dato. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days} d ${restH} h` : `${days} d`;
}
