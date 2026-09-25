/**
 * Plantillas aprobadas por Meta, configuradas por tenant en
 * `Tenant.whatsappTemplates`.
 *
 * Forma esperada (cualquier otra cosa se ignora, no rompe el despacho):
 *
 * ```json
 * { "QUOTE_REMINDER": { "name": "recordatorio_cotizacion", "language": "es_MX" } }
 * ```
 *
 * El nombre es el de la plantilla tal como quedó aprobada en el WhatsApp
 * Manager del negocio. Sin entrada para una clave, el despachador cancela la
 * notificación fuera de ventana en vez de mandar texto libre.
 */

export interface ApprovedTemplate {
  name: string;
  language: string;
}

const DEFAULT_LANGUAGE = "es_MX";

export function resolveApprovedTemplate(
  configured: unknown,
  templateKey: string,
): ApprovedTemplate | null {
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) return null;
  const entry = (configured as Record<string, unknown>)[templateKey];
  if (!entry) return null;
  if (typeof entry === "string") {
    return entry.trim() ? { name: entry.trim(), language: DEFAULT_LANGUAGE } : null;
  }
  if (typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = (entry as Record<string, unknown>).name;
  if (typeof name !== "string" || !name.trim()) return null;
  const language = (entry as Record<string, unknown>).language;
  return {
    name: name.trim(),
    language: typeof language === "string" && language.trim() ? language.trim() : DEFAULT_LANGUAGE,
  };
}
