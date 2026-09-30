/**
 * Persistencia del hilo del chat web en `sessionStorage`, por comercio.
 *
 * Por qué existe: el agente guarda el hilo por `conversationId`, y ese id lo
 * genera el navegador. Sin guardarlo, un refresh perdía el hilo (o peor, antes
 * de que el agente dejara de reenganchar `{tenant}:anon`, retomaba uno ajeno).
 *
 * Reglas:
 *  - La clave incluye el `tenantId`: cambiar de comercio nunca muestra el hilo
 *    del anterior.
 *  - `sessionStorage` (no `localStorage`): muere con la pestaña. Dos pestañas
 *    son dos hilos, y cerrar el navegador arranca limpio.
 *  - Caduca a las `CHAT_SESSION_TTL_MS`: el agente cierra hilos inactivos y
 *    retomar uno muerto solo confunde.
 *
 * Todo es puro (recibe el `Storage` como parámetro) para poder probarlo sin
 * navegador.
 */

import type { AgentCart, AgentResponse, CartLine, ChatMessage } from "./types";

export const CHAT_SESSION_VERSION = 1;
/** 12 h: más que una jornada de atención, menos que "para siempre". */
export const CHAT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const KEY_PREFIX = "easysell.chat.session";

/** Subconjunto mínimo de `Storage` para no depender del DOM en pruebas. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ChatSessionSnapshot {
  conversationId: string;
  /** Epoch ms del primer mensaje del hilo (solo presentación). */
  startedAt: number;
  messages: ChatMessage[];
  cart: CartLine[];
  carts: AgentCart[];
  quote: AgentResponse["quote"];
  checkout: AgentResponse["checkout"];
  handoff: boolean;
}

interface PersistedChatSession extends ChatSessionSnapshot {
  version: number;
  tenantId: string;
  savedAt: number;
}

export function chatSessionKey(tenantId: string): string {
  return `${KEY_PREFIX}.${tenantId}`;
}

/** `sessionStorage` puede no existir (SSR) o estar bloqueado (modo privado). */
export function browserSessionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.sessionStorage;
    // Safari en privado expone el objeto pero revienta al escribir.
    const probe = `${KEY_PREFIX}.__probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Respaldo para contextos sin Web Crypto (http plano en LAN): suficiente
  // para distinguir hilos, no es criptográfico.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Forma corta para la UI: los primeros 8 caracteres bastan para distinguir hilos. */
export function shortConversationId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Lee el hilo guardado para el comercio. Devuelve `null` (y limpia) si no
 * hay, si es de otra versión, si está corrupto o si ya caducó.
 *
 * Los mensajes que quedaron `PENDING` (la pestaña se recargó con una petición
 * en vuelo) se marcan `FAILED`: ya nadie espera esa respuesta y así el usuario
 * puede reintentar.
 */
export function readChatSession(
  storage: StorageLike | null,
  tenantId: string,
  now: number = Date.now(),
): ChatSessionSnapshot | null {
  if (!storage) return null;
  const key = chatSessionKey(tenantId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return null;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== CHAT_SESSION_VERSION ||
    parsed.tenantId !== tenantId ||
    typeof parsed.conversationId !== "string" ||
    parsed.conversationId.length === 0 ||
    typeof parsed.savedAt !== "number" ||
    !Array.isArray(parsed.messages)
  ) {
    storage.removeItem(key);
    return null;
  }
  if (now - parsed.savedAt > CHAT_SESSION_TTL_MS) {
    storage.removeItem(key);
    return null;
  }
  const messages = (parsed.messages as ChatMessage[]).map((message) =>
    message.status === "PENDING" ? { ...message, status: "FAILED" as const } : message,
  );
  return {
    conversationId: parsed.conversationId,
    startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : parsed.savedAt,
    messages,
    cart: Array.isArray(parsed.cart) ? (parsed.cart as CartLine[]) : [],
    carts: Array.isArray(parsed.carts) ? (parsed.carts as AgentCart[]) : [],
    quote: isRecord(parsed.quote) ? (parsed.quote as AgentResponse["quote"]) : null,
    checkout: isRecord(parsed.checkout) ? (parsed.checkout as AgentResponse["checkout"]) : null,
    handoff: parsed.handoff === true,
  };
}

export function writeChatSession(
  storage: StorageLike | null,
  tenantId: string,
  snapshot: ChatSessionSnapshot,
  now: number = Date.now(),
): void {
  if (!storage) return;
  const payload: PersistedChatSession = {
    ...snapshot,
    version: CHAT_SESSION_VERSION,
    tenantId,
    savedAt: now,
  };
  try {
    storage.setItem(chatSessionKey(tenantId), JSON.stringify(payload));
  } catch {
    // Cuota llena o storage bloqueado: el hilo sigue en memoria, solo no
    // sobrevive al refresh.
  }
}

export function clearChatSession(storage: StorageLike | null, tenantId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(chatSessionKey(tenantId));
  } catch {
    // Sin storage no hay nada que limpiar.
  }
}

/** Mensaje para el usuario según cómo falló `POST /chat`. */
export function describeChatError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "El agente tardó demasiado en responder. Puedes reintentar el mensaje.";
  }
  if (error instanceof ChatRequestError) {
    if (error.status === 504) return "El agente tardó demasiado en responder. Puedes reintentar el mensaje.";
    if (error.status === 502 || error.status === 503) {
      return "El agente no está disponible en este momento. Reintenta en unos segundos.";
    }
    if (error.status === 403) return "Tu rol no tiene permiso para escribirle al agente.";
    if (error.status === 429) return "El agente está atendiendo a muchas personas; espera un momento y reintenta.";
    return error.message;
  }
  if (error instanceof TypeError) {
    // `fetch` rechaza con TypeError cuando no hay red.
    return "Sin conexión con el servidor. Revisa tu red y reintenta.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "El agente no respondió. Puedes reintentar el mensaje.";
}

/** Error HTTP de `/agent/*` con el status y el `detail`/`message` del cuerpo. */
export class ChatRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

/** Extrae un texto útil del cuerpo de error del proxy o de FastAPI. */
export function chatErrorFromBody(status: number, body: unknown): ChatRequestError {
  let message = `Error ${status} del agente`;
  if (isRecord(body)) {
    const detail = body.detail ?? body.message;
    if (typeof detail === "string" && detail.trim()) message = detail;
  }
  return new ChatRequestError(status, message);
}
