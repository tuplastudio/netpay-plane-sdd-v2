/** Plantillas canónicas T-NTF-01. Ver docs/14-ntf.md. */

export type TemplateKey =
  | "QUOTE_LINK"
  | "ORDER_RECEIVED"
  | "PAYMENT_SIMULATED_SUCCESS"
  | "PAYMENT_SIMULATED_FAILED"
  | "REMINDER"
  | "HANDOFF";

export function renderTemplate(key: TemplateKey, vars: Record<string, string>): string {
  switch (key) {
    case "QUOTE_LINK":
      return `Hola ${vars.customerName}, tu cotización por $${vars.total} está lista: ${vars.link}`;
    case "ORDER_RECEIVED":
      return `Hola ${vars.customerName}, recibimos tu pedido por $${vars.total} (folio ${vars.orderId}).`;
    case "PAYMENT_SIMULATED_SUCCESS":
      return `Pago confirmado (modo simulado) por $${vars.total}. ¡Gracias, ${vars.customerName}!`;
    case "PAYMENT_SIMULATED_FAILED":
      return `No pudimos procesar tu pago (modo simulado) por $${vars.total}.${vars.link ? ` Intenta de nuevo: ${vars.link}` : ""}`;
    case "REMINDER":
      return `Recordatorio: tu pedido por $${vars.total} sigue pendiente de pago.${vars.link ? ` ${vars.link}` : ""}`;
    case "HANDOFF":
      return `${vars.customerName} pidió hablar con un asesor humano.`;
  }
}
