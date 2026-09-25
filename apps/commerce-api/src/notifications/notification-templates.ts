/**
 * Plantillas canónicas T-NTF-01. Ver docs/14-ntf.md y docs/10-wha.md.
 *
 * Todas salen también por WhatsApp, así que el texto cumple la Política
 * Comercial y la Política de WhatsApp Business de Meta:
 *
 * - **Identificación**: el mensaje dice de parte de qué negocio va
 *   (`businessName`). Meta prohíbe los mensajes que ocultan quién escribe.
 * - **Transaccional y solicitado**: cada plantilla corresponde a algo que el
 *   cliente pidió (una cotización, un pedido, un pago) — no hay promoción no
 *   solicitada, ni urgencia falsa, ni "última oportunidad".
 * - **Opt-out**: los mensajes que inicia el negocio sin que el cliente acabe
 *   de escribir (link de cotización, recordatorio, cotización actualizada)
 *   llevan el pie de baja. `service-window.ts` reconoce la respuesta y
 *   `whatsapp.service.applyConsentKeyword` revoca el consentimiento.
 * - **Sin datos sensibles**: nunca se manda un dato de pago en el texto; solo
 *   el enlace al checkout alojado.
 *
 * Fuera de la ventana de servicio de 24 h, el texto de aquí viaja como
 * parámetro de una plantilla aprobada (ver `whatsapp-template-map.ts`); si el
 * tenant no configuró una, la notificación se cancela en vez de enviarse.
 */

import { OPT_OUT_FOOTER } from "../whatsapp/service-window.js";

export type TemplateKey =
  | "QUOTE_LINK"
  | "QUOTE_UPDATED"
  | "QUOTE_REMINDER"
  | "ORDER_RECEIVED"
  | "ORDER_FULFILLED"
  | "PAYMENT_SIMULATED_SUCCESS"
  | "PAYMENT_SIMULATED_FAILED"
  | "REMINDER"
  | "HANDOFF";

/**
 * Plantillas que inicia el negocio: llevan pie de opt-out. Las que contestan
 * a una acción del cliente en el mismo momento (pago confirmado, pedido
 * recibido) no lo llevan: ahí el cliente acaba de interactuar y el pie solo
 * añade ruido.
 */
const BUSINESS_INITIATED: ReadonlySet<TemplateKey> = new Set<TemplateKey>([
  "QUOTE_LINK",
  "QUOTE_UPDATED",
  "QUOTE_REMINDER",
  "REMINDER",
]);

function from(vars: Record<string, string>): string {
  const business = (vars.businessName ?? "").trim();
  return business ? ` de ${business}` : "";
}

function body(key: TemplateKey, vars: Record<string, string>): string {
  switch (key) {
    case "QUOTE_LINK":
      return `Hola ${vars.customerName}, tu cotización${from(vars)} por $${vars.total} está lista: ${vars.link}`;
    case "QUOTE_UPDATED":
      return `Hola ${vars.customerName}, actualizamos tu cotización${from(vars)}: ahora es por $${vars.total} (antes $${vars.previousTotal}). Revísala aquí: ${vars.link}`;
    case "QUOTE_REMINDER":
      return (
        `Hola ${vars.customerName}, tu cotización${from(vars)} por $${vars.total} sigue disponible` +
        `${vars.expiresAt ? ` y vence el ${vars.expiresAt}` : ""}. ` +
        `Puedes verla y pagarla aquí: ${vars.link}`
      );
    case "ORDER_RECEIVED":
      return `Hola ${vars.customerName}, recibimos tu pedido${from(vars)} por $${vars.total} (folio ${vars.orderId}).`;
    case "ORDER_FULFILLED":
      return `Hola ${vars.customerName}, tu pedido ${vars.orderId}${from(vars)} ya quedó entregado. Detalle: ${vars.link}`;
    case "PAYMENT_SIMULATED_SUCCESS":
      return `Pago confirmado (modo simulado) por $${vars.total}. ¡Gracias, ${vars.customerName}!${vars.link ? ` Sigue tu pedido aquí: ${vars.link}` : ""}`;
    case "PAYMENT_SIMULATED_FAILED":
      return `No pudimos procesar tu pago (modo simulado) por $${vars.total}.${vars.link ? ` Intenta de nuevo: ${vars.link}` : ""}`;
    case "REMINDER":
      return `Hola ${vars.customerName ?? ""}, tu pedido${from(vars)} por $${vars.total} sigue pendiente de pago.${vars.link ? ` ${vars.link}` : ""}`.trim();
    case "HANDOFF":
      return `${vars.customerName} pidió hablar con un asesor humano.`;
  }
}

export function renderTemplate(key: TemplateKey, vars: Record<string, string>): string {
  const text = body(key, vars);
  // HANDOFF va a una persona del negocio, no al cliente: no lleva pie de baja.
  if (!BUSINESS_INITIATED.has(key)) return text;
  return `${text}\n\n${OPT_OUT_FOOTER}`;
}
