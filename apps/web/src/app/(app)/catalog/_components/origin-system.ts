/**
 * Plataformas conocidas para el selector de "sistema de origen". Cubre los
 * ecommerce y ERPs más comunes en la región; `ORIGIN_SYSTEM_OTHER_VALUE` es
 * el valor centinela del <select> para "no está en la lista" — revela un
 * campo de texto libre, nunca se manda tal cual al backend.
 *
 * Módulo puro (sin React) para que los builders de payload se puedan probar.
 */
export const ORIGIN_SYSTEM_OPTIONS = [
  "Shopify",
  "WooCommerce",
  "Mercado Libre",
  "Amazon",
  "Magento",
  "VTEX",
  "Tiendanube",
  "PrestaShop",
  "BigCommerce",
  "SAP",
  "Oracle NetSuite",
  "Microsoft Dynamics 365",
  "Odoo",
  "Zoho Inventory",
  "QuickBooks",
] as const;
export const ORIGIN_SYSTEM_OTHER_VALUE = "__OTHER__";

/** Del valor guardado en BD (texto libre) a los dos campos que usa el formulario. */
export function originSystemToFormValue(stored: string | null): {
  originSystem: string;
  originSystemOther: string;
} {
  if (!stored) return { originSystem: "", originSystemOther: "" };
  if ((ORIGIN_SYSTEM_OPTIONS as readonly string[]).includes(stored)) {
    return { originSystem: stored, originSystemOther: "" };
  }
  return { originSystem: ORIGIN_SYSTEM_OTHER_VALUE, originSystemOther: stored };
}

/** De los dos campos del formulario al string que se manda al backend. */
export function resolveOriginSystem(values: {
  originSystem?: string;
  originSystemOther?: string;
}): string {
  if (values.originSystem === ORIGIN_SYSTEM_OTHER_VALUE) {
    return (values.originSystemOther ?? "").trim();
  }
  return (values.originSystem ?? "").trim();
}
