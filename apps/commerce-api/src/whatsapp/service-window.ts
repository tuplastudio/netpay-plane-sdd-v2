/**
 * Reglas de la Política Comercial de WhatsApp (Meta) que el código sí puede
 * hacer cumplir. Ver docs/10-wha.md y docs/14-ntf.md.
 *
 * Meta divide los mensajes en dos: los que responden al cliente dentro de la
 * **ventana de servicio de 24 h** (texto libre, sin plantilla) y los que
 * inicia el negocio fuera de esa ventana, que solo pueden salir como
 * **plantilla aprobada**. La Cloud API rechaza el texto libre fuera de
 * ventana (error 131047); Evolution (Baileys) no lo rechaza, pero la cuenta
 * sigue sujeta a la misma política y a los bloqueos por reportes de spam.
 *
 * Por eso la ventana se evalúa igual para los dos proveedores: lo que cambia
 * es qué se puede hacer cuando está cerrada (plantilla aprobada si el tenant
 * configuró una, si no la notificación se cancela con motivo explícito).
 *
 * La otra obligación dura es el **opt-out**: si el cliente pide dejar de
 * recibir mensajes, hay que honrarlo de inmediato y no volver a escribirle.
 */

/** Horas de la ventana de servicio de Meta. */
export const SERVICE_WINDOW_HOURS = 24;

/**
 * Sólo dígitos: `+52 55 1234 5678`, `5215512345678` y `52 5512345678` tienen
 * que colisionar cuando se comparan el teléfono del cliente (como lo guardó
 * quien lo dio de alta) y el `externalPhone` del hilo (como lo manda el
 * proveedor).
 */
export function phoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  // WhatsApp mete un `1` después del 52 en los móviles mexicanos
  // (`52 1 55…`). Sin quitarlo, el mismo número no casa consigo mismo según
  // por dónde entre.
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return digits;
}

/**
 * Dos teléfonos son el mismo número si uno termina en el otro y el sufijo
 * común tiene al menos 10 dígitos (el largo nacional en MX). Cubre el
 * prefijo de país ausente (`6671234567` vs `526671234567`) sin llegar a
 * casar dos números distintos por los últimos cuatro dígitos; el `1` de los
 * móviles mexicanos ya lo quitó `phoneDigits`.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (x.length < 10 || y.length < 10) return false;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  return long.endsWith(short);
}

/**
 * Palabras con las que el cliente se da de baja. Meta exige honrar la
 * intención, no una sintaxis exacta: se acepta el mensaje completo o una
 * frase que empiece por la palabra ("baja por favor"), pero no una palabra
 * suelta dentro de un texto largo ("no quiero la baja de mi pedido").
 */
const OPT_OUT_KEYWORDS = [
  "baja",
  "darme de baja",
  "dar de baja",
  "stop",
  "unsubscribe",
  "cancelar suscripcion",
  "cancelar suscripción",
  "no molestar",
  "no me escriban",
  "no quiero mensajes",
  "dejen de escribirme",
];

/** Palabras con las que el cliente se vuelve a suscribir. */
const OPT_IN_KEYWORDS = ["alta", "start", "suscribir", "suscribirme", "si quiero mensajes"];

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const withoutAccents = keywords.map(normalizeText);
  if (withoutAccents.includes(normalized)) return true;
  // Frase corta que empieza por la palabra clave: "baja por favor".
  const words = normalized.split(" ");
  if (words.length > 5) return false;
  return withoutAccents.some((k) => normalized.startsWith(`${k} `));
}

export function isOptOutMessage(text: string | null | undefined): boolean {
  return matches(text ?? "", OPT_OUT_KEYWORDS);
}

export function isOptInMessage(text: string | null | undefined): boolean {
  return matches(text ?? "", OPT_IN_KEYWORDS);
}

/** Confirmación de baja. Va dentro de ventana (el cliente acaba de escribir). */
export const OPT_OUT_CONFIRMATION =
  "Listo, no volveremos a escribirte. Si cambias de opinión, responde ALTA y retomamos.";

export const OPT_IN_CONFIRMATION =
  "Listo, vuelves a recibir nuestros mensajes. Responde BAJA cuando quieras dejar de recibirlos.";

/** Pie de opt-out que Meta pide en los mensajes que inicia el negocio. */
export const OPT_OUT_FOOTER = "Responde BAJA para dejar de recibir estos mensajes.";

/** `true` si el último mensaje del cliente entra dentro de la ventana. */
export function isWithinServiceWindow(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_HOURS * 60 * 60 * 1000;
}
