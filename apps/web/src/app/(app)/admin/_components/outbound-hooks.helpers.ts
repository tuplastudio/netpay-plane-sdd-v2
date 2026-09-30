/**
 * Lógica pura de la sección "Hooks salientes": parseo de los campos de
 * texto libre del formulario (headers línea a línea, plantilla JSON) y
 * etiquetas/tonos de los estados. Sin React, para poder probarla sola.
 */

import type { Tone } from "@/components/ui/status-badge";

export type HookKind = "REST" | "MCP";
export type HookAuthType = "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC" | "HMAC";
export type HookStatus = "ACTIVE" | "DISABLED";
export type DeliveryStatus = "PENDING" | "SUCCESS" | "FAILED" | "DEAD";

/** `GET /hooks` (apps/commerce-api/src/hooks/outbound-hook.service.ts → PublicHook). */
export interface OutboundHook {
  id: string;
  name: string;
  description: string | null;
  kind: HookKind;
  targetUrl: string;
  authType: HookAuthType;
  authHeaderName: string | null;
  hasCredential: boolean;
  events: string[];
  status: HookStatus;
  headers: Record<string, string> | null;
  toolName: string | null;
  argsTemplate: Record<string, unknown> | null;
  retryPolicy: { maxAttempts: number; backoffSeconds: number };
  createdAt: string;
  updatedAt: string;
}

/** `GET /hooks/:id/deliveries` (listado) y `GET /hooks/deliveries/:id` (detalle). */
export interface HookDelivery {
  id: string;
  hookId: string;
  eventName: string;
  eventId: string;
  attempt: number;
  status: DeliveryStatus;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
  payload?: unknown;
  responseBody?: string | null;
}

/** `GET /hooks/events`. */
export interface HookEventDefinition {
  name: string;
  group: string;
  description: string;
  subscribable: boolean;
  example: Record<string, unknown>;
}

export const HOOK_KIND_LABELS: Record<HookKind, string> = {
  REST: "Webhook REST",
  MCP: "Servidor MCP",
};

export const AUTH_TYPE_LABELS: Record<HookAuthType, string> = {
  NONE: "Sin autenticación (solo firma)",
  BEARER: "Bearer token",
  API_KEY_HEADER: "API key en header",
  BASIC: "Usuario y contraseña (Basic)",
  HMAC: "Solo firma HMAC",
};

/** Tipos de autenticación que piden una credencial. */
export const AUTH_NEEDS_CREDENTIAL: ReadonlySet<HookAuthType> = new Set(["BEARER", "API_KEY_HEADER", "BASIC"]);

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: "Pendiente",
  SUCCESS: "Entregada",
  FAILED: "Falló, reintentará",
  DEAD: "Agotada",
};

export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, Tone> = {
  PENDING: "info",
  SUCCESS: "success",
  FAILED: "warning",
  DEAD: "destructive",
};

/** Un header por línea: `Nombre: valor`. Líneas vacías se ignoran. */
export function parseHeaderLines(text: string): { headers: Record<string, string>; error?: string } {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) return { headers, error: `Cada línea debe ser "Nombre: valor" (revisa "${line}")` };
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) {
      return { headers, error: `Nombre de header inválido: "${name}" (solo letras, números y guiones)` };
    }
    if (!value) return { headers, error: `El header "${name}" no tiene valor` };
    headers[name] = value;
  }
  if (Object.keys(headers).length > 20) return { headers, error: "Máximo 20 headers" };
  return { headers };
}

export function headersToLines(headers: Record<string, string> | null | undefined): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** JSON que además debe ser un objeto (no arreglo ni primitivo). */
export function parseJsonObject(text: string): { value: Record<string, unknown> | null; error?: string } {
  if (!text.trim()) return { value: null };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "Debe ser un objeto JSON, por ejemplo { \"orderId\": \"{{event.data.orderId}}\" }" };
    }
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { value: null, error: "JSON inválido" };
  }
}

/** Texto corto del resultado de una entrega para la tabla. */
export function describeDeliveryResult(d: Pick<HookDelivery, "status" | "responseStatus" | "error">): string {
  if (d.status === "SUCCESS") return d.responseStatus ? `HTTP ${d.responseStatus}` : "OK";
  if (d.error) return d.error;
  if (d.responseStatus) return `HTTP ${d.responseStatus}`;
  return "—";
}

/** Recorta una URL larga para la tabla sin perder el host. */
export function shortUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const room = Math.max(8, max - u.host.length - 1);
    return `${u.host}${path.length > room ? `${path.slice(0, room - 1)}…` : path}`;
  } catch {
    return `${url.slice(0, max - 1)}…`;
  }
}
