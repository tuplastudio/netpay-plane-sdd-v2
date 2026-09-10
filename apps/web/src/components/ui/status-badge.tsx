import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Tonos de la escala semántica de estado (ver globals.css).
 * NO son colores de marca: solo comunican en qué situación está un dato.
 */
export type Tone = "success" | "warning" | "info" | "neutral" | "destructive";

/**
 * Dominio del enum al que pertenece el valor. Varios enums de Prisma comparten
 * nombre (ACCEPTED, CANCELLED, EXPIRED, ACTIVE, PENDING…) con matices distintos,
 * así que quien conoce el origen del dato lo declara y evita ambigüedad.
 */
export type StatusDomain =
  | "order"
  | "payment"
  | "quote"
  | "catalog"
  | "customer"
  | "membership"
  | "tenant"
  | "revision"
  | "ledger"
  | "channel"
  | "notification"
  | "conversation"
  | "message"
  | "integration"
  | "connection"
  | "job"
  | "outbox"
  | "role"
  | "generic";

// ---------------------------------------------------------------------------
// Etiquetas (es-MX). Fuente de verdad: apps/commerce-api/prisma/schema.prisma.
// La clave siempre es el valor del enum EN MAYÚSCULAS tal cual llega del API.
// ---------------------------------------------------------------------------

/** OrderStatus */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  CHECKOUT_OPEN: "Checkout abierto",
  AWAITING_PAYMENT: "Por pagar",
  PAID: "Pagado",
  FULFILLED: "Entregado",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
};

/** PaymentStatus */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  AUTHORIZED: "Autorizado",
  CAPTURED: "Cobrado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  CANCELLED: "Cancelado",
  UNKNOWN: "Desconocido",
};

/** QuoteStatus */
export const QUOTE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  EXPIRED: "Expirada",
  ACCEPTED: "Aceptada",
  CANCELLED: "Cancelada",
};

/** CatalogStatus */
export const CATALOG_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  ARCHIVED: "Archivado",
};

/** CustomerStatus */
export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  ARCHIVED: "Archivado",
};

/** MembershipStatus */
export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  INVITED: "Invitado",
  DISABLED: "Deshabilitado",
};

/** TenantStatus */
export const TENANT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  DISABLED: "Deshabilitado",
};

/** RevisionStatus */
export const REVISION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  ACCEPTED: "Aceptada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};

/** LedgerEntryType */
export const LEDGER_TYPE_LABELS: Record<string, string> = {
  CHARGE: "Cargo",
  REFUND: "Reembolso",
  FEE: "Comisión",
  ADJUSTMENT: "Ajuste",
};

/** OrderSource */
export const SOURCE_LABELS: Record<string, string> = {
  QUOTE: "Cotización",
  DIRECT: "Directo",
  CHAT: "Chat",
  QUICK_CHARGE: "Cobro rápido",
};

/** Role */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  VENDOR: "Vendedor",
  FINANCE: "Finanzas",
  CATALOG: "Catálogo",
  SUPPORT: "Soporte",
  VIEWER: "Lectura",
};

/** Channel + WhatsAppProvider */
export const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP_META: "WhatsApp (Meta)",
  WHATSAPP_EVOLUTION: "WhatsApp (Evolution)",
  META: "Meta",
  EVOLUTION: "Evolution",
};

/** DeliveryMode */
export const DELIVERY_MODE_LABELS: Record<string, string> = {
  PICKUP: "Recolección",
  LOCAL_DELIVERY: "Envío local",
};

/** ConsentScope */
export const CONSENT_SCOPE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  MARKETING: "Marketing",
  DATA_PROCESSING: "Tratamiento de datos",
};

/** NotificationStatus / NotificationChannel / NotificationRecipient */
export const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  SENT: "Enviada",
  DELIVERED: "Entregada",
  FAILED: "Fallida",
  CANCELLED: "Cancelada",
  EMAIL: "Correo",
  SMS: "SMS",
  PUSH: "Push",
  CUSTOMER: "Cliente",
  USER: "Usuario",
};

/** ConversationStatus */
export const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  HANDED_OFF: "Escalada",
  CLOSED: "Cerrada",
};

/** MessageStatus / MessageDirection / MessageType */
export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Fallido",
  INBOUND: "Entrante",
  OUTBOUND: "Saliente",
  TEXT: "Texto",
  IMAGE: "Imagen",
  AUDIO: "Audio",
  DOCUMENT: "Documento",
  TEMPLATE: "Plantilla",
};

/** IntegrationStatus / IntegrationEventStatus / IntegrationDirection / WhatsAppStatus */
export const INTEGRATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  ACTIVE: "Activa",
  DISABLED: "Deshabilitada",
  ERROR: "Con error",
  PROCESSED: "Procesado",
  FAILED: "Fallido",
  IGNORED: "Ignorado",
  DISCONNECTED: "Desconectado",
  INBOUND: "Entrante",
  OUTBOUND: "Saliente",
  BIDIRECTIONAL: "Bidireccional",
};

/**
 * Estado de conexión de un canal de WhatsApp (`Connection.status`).
 * Es un enlace vivo, no una integración configurada: se habla de conectado /
 * desconectado, no de "Activa" / "Deshabilitada".
 */
export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Conectado",
  PENDING: "Esperando confirmación",
  ERROR: "Con error",
  DISCONNECTED: "Desconectado",
};

/** JobStatus */
export const JOB_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  RUNNING: "En curso",
  SUCCEEDED: "Completado",
  PARTIAL: "Parcial",
  FAILED: "Fallido",
};

/** OutboxStatus + InboxStatus */
export const OUTBOX_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  IN_FLIGHT: "En vuelo",
  PUBLISHED: "Publicado",
  PROCESSED: "Procesado",
  FAILED: "Fallido",
};

/**
 * Mapa compartido por defecto (`domain` omitido). Cubre el vocabulario común;
 * en las colisiones toma la lectura más frecuente en el portal:
 * ACTIVE→"Activo", ACCEPTED→"Aceptada", EXPIRED→"Expirado", CANCELLED→"Cancelado",
 * PENDING→"Pendiente", FAILED→"Fallido", SENT→"Enviado", OPEN→"Abierta".
 * Si tu pantalla necesita otra lectura, pasa `domain`.
 *
 * `CONNECTION_STATUS_LABELS` queda fuera a propósito: ahí `ACTIVE` significa
 * "Conectado", que sería incorrecto para el resto de la app. El dominio
 * `connection` es de uso explícito.
 */
export const STATUS_LABELS: Record<string, string> = {
  ...OUTBOX_STATUS_LABELS,
  ...JOB_STATUS_LABELS,
  ...INTEGRATION_STATUS_LABELS,
  ...MESSAGE_STATUS_LABELS,
  ...CONVERSATION_STATUS_LABELS,
  ...NOTIFICATION_STATUS_LABELS,
  ...CONSENT_SCOPE_LABELS,
  ...DELIVERY_MODE_LABELS,
  ...CHANNEL_LABELS,
  ...ROLE_LABELS,
  ...SOURCE_LABELS,
  ...LEDGER_TYPE_LABELS,
  ...REVISION_STATUS_LABELS,
  ...TENANT_STATUS_LABELS,
  ...MEMBERSHIP_STATUS_LABELS,
  ...CUSTOMER_STATUS_LABELS,
  ...CATALOG_STATUS_LABELS,
  ...QUOTE_STATUS_LABELS,
  ...PAYMENT_STATUS_LABELS,
  ...ORDER_STATUS_LABELS,
};

const LABELS_BY_DOMAIN: Record<StatusDomain, Record<string, string>> = {
  order: ORDER_STATUS_LABELS,
  payment: PAYMENT_STATUS_LABELS,
  quote: QUOTE_STATUS_LABELS,
  catalog: CATALOG_STATUS_LABELS,
  customer: CUSTOMER_STATUS_LABELS,
  membership: MEMBERSHIP_STATUS_LABELS,
  tenant: TENANT_STATUS_LABELS,
  revision: REVISION_STATUS_LABELS,
  ledger: LEDGER_TYPE_LABELS,
  channel: CHANNEL_LABELS,
  notification: NOTIFICATION_STATUS_LABELS,
  conversation: CONVERSATION_STATUS_LABELS,
  message: MESSAGE_STATUS_LABELS,
  integration: INTEGRATION_STATUS_LABELS,
  connection: CONNECTION_STATUS_LABELS,
  job: JOB_STATUS_LABELS,
  outbox: OUTBOX_STATUS_LABELS,
  role: ROLE_LABELS,
  generic: STATUS_LABELS,
};

// ---------------------------------------------------------------------------
// Tonos
// ---------------------------------------------------------------------------

/**
 * Tono por defecto de cada valor. Criterio:
 *  success     — terminó bien (pagado, entregado, aceptado, activo)
 *  warning     — falta una acción humana o hay una espera (pendiente, borrador)
 *  info        — en curso / informativo, sin juicio de valor
 *  destructive — falló o murió (fallido, cancelado, expirado, con error)
 *  neutral     — inerte o desconocido (archivado, deshabilitado, ignorado)
 */
const DEFAULT_TONES: Record<string, Tone> = {
  // terminado bien
  PAID: "success",
  FULFILLED: "success",
  CAPTURED: "success",
  ACCEPTED: "success",
  ACTIVE: "success",
  PUBLISHED: "success",
  SUCCEEDED: "success",
  DELIVERED: "success",
  READ: "success",
  PROCESSED: "success",
  // esperando algo
  DRAFT: "warning",
  PENDING: "warning",
  AWAITING_PAYMENT: "warning",
  CHECKOUT_OPEN: "warning",
  INVITED: "warning",
  PARTIAL: "warning",
  PARTIALLY_REFUNDED: "warning",
  HANDED_OFF: "warning",
  // en curso / informativo
  ISSUED: "info",
  OPEN: "info",
  AUTHORIZED: "info",
  RUNNING: "info",
  IN_FLIGHT: "info",
  SENT: "info",
  REFUNDED: "info",
  // roto
  FAILED: "destructive",
  CANCELLED: "destructive",
  EXPIRED: "destructive",
  ERROR: "destructive",
  // inerte
  ARCHIVED: "neutral",
  DISABLED: "neutral",
  DISCONNECTED: "neutral",
  CLOSED: "neutral",
  IGNORED: "neutral",
  UNKNOWN: "neutral",
};

/** Sobrecargas por dominio, solo donde el default no aplica. */
const TONE_OVERRIDES: Partial<Record<StatusDomain, Record<string, Tone>>> = {
  // Un reembolso de pago no es un final feliz: se destaca como advertencia.
  payment: { REFUNDED: "warning" },
  order: { REFUNDED: "warning" },
  // Una revisión abierta espera decisión del cliente.
  revision: { OPEN: "warning" },
  // El ledger no tiene "estado": son tipos de asiento.
  ledger: { CHARGE: "success", REFUND: "warning", FEE: "neutral", ADJUSTMENT: "info" },
  // Emitida = esperando respuesta del cliente.
  quote: { ISSUED: "info" },
  // Los roles no son estados: todos neutrales salvo los privilegiados.
  role: {
    OWNER: "info",
    ADMIN: "info",
    VENDOR: "neutral",
    FINANCE: "neutral",
    CATALOG: "neutral",
    SUPPORT: "neutral",
    VIEWER: "neutral",
  },
  channel: { WHATSAPP_META: "info", WHATSAPP_EVOLUTION: "info", META: "info", EVOLUTION: "info" },
};

/**
 * Tono semántico de un valor de enum. Nunca lanza: lo que no conoce es `neutral`.
 *
 * @example statusTone("PAID")                  // "success"
 * @example statusTone("REFUNDED", "payment")   // "warning"
 */
export function statusTone(status: string, domain: StatusDomain = "generic"): Tone {
  const key = String(status ?? "").toUpperCase();
  return TONE_OVERRIDES[domain]?.[key] ?? DEFAULT_TONES[key] ?? "neutral";
}

/**
 * Etiqueta legible en es-MX. Si el valor no está en el catálogo devuelve el
 * string crudo, para que una pantalla nunca quede en blanco por un enum nuevo.
 *
 * @example statusLabel("AWAITING_PAYMENT")     // "Por pagar"
 * @example statusLabel("ACCEPTED", "quote")    // "Aceptada"
 */
export function statusLabel(status: string, domain: StatusDomain = "generic"): string {
  const raw = String(status ?? "");
  const key = raw.toUpperCase();
  return LABELS_BY_DOMAIN[domain][key] ?? STATUS_LABELS[key] ?? raw;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-transparent px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        success: "bg-success-subtle text-success-foreground",
        warning: "bg-warning-subtle text-warning-foreground",
        info: "bg-info-subtle text-info-foreground",
        neutral: "bg-neutral-subtle text-neutral-foreground",
        destructive: "bg-destructive-subtle text-destructive-subtle-foreground",
      },
      size: {
        sm: "px-2 py-0 text-[11px]",
        default: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    Pick<VariantProps<typeof statusBadgeVariants>, "size"> {
  /** Valor del enum tal cual llega del API, en MAYÚSCULAS. */
  status: string;
  /** Enum de origen, para desambiguar valores compartidos. */
  domain?: StatusDomain;
  /** Fuerza el tono ignorando el mapa. Úsalo solo como escape hatch. */
  tone?: Tone;
  /** Sobrescribe la etiqueta calculada. */
  label?: string;
  /** Punto de color a la izquierda, útil en tablas densas. */
  withDot?: boolean;
}

const DOT_TONE: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  neutral: "bg-neutral",
  destructive: "bg-destructive",
};

/**
 * Insignia de estado de dominio. Resuelve tono y etiqueta en español a partir
 * del valor del enum; nunca muestra el enum crudo salvo que sea desconocido.
 *
 * @example
 * <StatusBadge status={order.status} domain="order" />
 * <StatusBadge status={payment.status} domain="payment" withDot />
 */
export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, status, domain = "generic", tone, label, size, withDot = false, ...props }, ref) => {
    const resolvedTone = tone ?? statusTone(status, domain);
    const text = label ?? statusLabel(status, domain);
    return (
      <span
        ref={ref}
        className={cn(statusBadgeVariants({ tone: resolvedTone, size }), className)}
        {...props}
      >
        {withDot ? (
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOT_TONE[resolvedTone])} />
        ) : null}
        {text}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";
