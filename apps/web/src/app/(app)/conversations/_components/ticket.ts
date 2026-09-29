import type { Conversation, ConversationPriority } from "./use-conversations";

/**
 * Vocabulario de ticket sobre el hilo de WhatsApp. El API guarda
 * `status` (OPEN / HANDED_OFF / CLOSED) + `pendingAt`; el estado de ticket se
 * DERIVA aquí, no se duplica:
 *
 *  - `resolved`  CLOSED (a mano o por inactividad).
 *  - `pending`   no cerrado y marcado "pendiente" (espera algo del cliente).
 *  - `open`      todo lo demás (con el bot o con una persona).
 */
export type TicketStatus = "open" | "pending" | "resolved";

export function ticketStatus(c: Pick<Conversation, "status" | "pendingAt">): TicketStatus {
  if (c.status === "CLOSED") return "resolved";
  if (c.pendingAt) return "pending";
  return "open";
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Abierta",
  pending: "Pendiente",
  resolved: "Resuelta",
};

/** Tono de `StatusBadge` para cada estado de ticket. */
export const TICKET_STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success"> = {
  open: "info",
  pending: "warning",
  resolved: "success",
};

export const PRIORITY_LABELS: Record<ConversationPriority, string> = {
  LOW: "Baja",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

/** Tono de `StatusBadge` por prioridad: solo las que piden atención cambian de color. */
export const PRIORITY_TONE: Record<ConversationPriority, "neutral" | "info" | "warning" | "destructive"> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "destructive",
};

export function priorityOf(c: Pick<Conversation, "priority">): ConversationPriority {
  return c.priority ?? "NORMAL";
}

/** Segundos entre dos fechas ISO, o null si falta alguna. */
export function secondsBetween(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

export function secondsSince(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/** Objetivos de SLA (segundos). Fijos por ahora; la UI solo los usa para el tono. */
export const SLA = {
  /** Primera respuesta humana tras entrar a la cola: verde < 15 min, ámbar < 1 h, rojo después. */
  firstResponseWarn: 15 * 60,
  firstResponseBreach: 60 * 60,
  /** Cliente esperando respuesta: ámbar < 1 h, rojo después. */
  waitingBreach: 60 * 60,
} as const;

export type SlaTone = "success" | "warning" | "destructive";

export function firstResponseTone(seconds: number): SlaTone {
  if (seconds < SLA.firstResponseWarn) return "success";
  if (seconds < SLA.firstResponseBreach) return "warning";
  return "destructive";
}

export function waitingTone(seconds: number): "warning" | "destructive" {
  return seconds < SLA.waitingBreach ? "warning" : "destructive";
}

/**
 * SLA de un hilo, calculado con lo que el API ya guarda:
 *  - `firstResponseSeconds`: `firstHumanReplyAt - handoffAt` (primera respuesta
 *    humana desde que entró a la cola). `null` si nunca se transfirió o si
 *    todavía nadie ha contestado; en ese caso `awaitingFirstResponseSeconds`
 *    dice cuánto lleva en cola sin respuesta.
 *  - `waitingSeconds`: cuánto lleva el cliente sin respuesta (solo si el
 *    hilo está sin responder y no está pendiente ni cerrado).
 */
export function slaOf(c: Conversation, now = Date.now()) {
  const status = ticketStatus(c);
  const firstResponseSeconds = secondsBetween(c.handoffAt, c.firstHumanReplyAt);
  const awaitingFirstResponseSeconds =
    c.handoffToHuman && c.handoffAt && !c.firstHumanReplyAt && status === "open"
      ? secondsSince(c.handoffAt, now)
      : null;
  const waitingSeconds =
    status === "open" && c.unanswered ? secondsSince(c.lastInboundAt ?? c.lastMessageAt, now) : null;
  return { status, firstResponseSeconds, awaitingFirstResponseSeconds, waitingSeconds };
}
