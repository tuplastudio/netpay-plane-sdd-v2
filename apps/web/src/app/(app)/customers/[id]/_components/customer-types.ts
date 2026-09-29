/**
 * Formas del API de clientes que usa la ficha 360°:
 *   - `GET /customers/:id`          → `CustomerDetail`
 *   - `GET /customers/:id/summary`  → `CustomerSummary`
 *   - `GET /customers/:id/timeline` → `TimelineItem[]` (paginado)
 *   - `GET /customers/:id/notes`    → `CustomerNote[]` (paginado)
 * Ver `apps/commerce-api/src/customers/customer-profile.service.ts`.
 */

export interface CustomerAddress {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface CustomerIdentity {
  id: string;
  /** `Channel` — WHATSAPP_META | WHATSAPP_EVOLUTION. */
  channel: string;
  externalId: string;
  verifiedAt: string | null;
}

export interface CustomerConsent {
  id: string;
  /** `ConsentScope` — WHATSAPP | MARKETING | DATA_PROCESSING. */
  scope: string;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
}

export interface CustomerDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  legalName: string | null;
  fiscalPostalCode: string | null;
  fiscalCfdiUse: string | null;
  fiscalRegimenFiscal: string | null;
  fiscalConstanciaUrl: string | null;
  tags: string[];
  notes: string | null;
  /** `CustomerStatus` — ACTIVE | ARCHIVED. */
  status: string;
  /** Versión actual (optimistic concurrency en PATCH). */
  version: number;
  createdAt: string;
  updatedAt: string;
  addresses: CustomerAddress[];
  identities: CustomerIdentity[];
  consents: CustomerConsent[];
}

export interface CustomerSummary {
  ordersCount: number;
  paidOrdersCount: number;
  totalPaid: string;
  averageTicket: string;
  lastPurchaseAt: string | null;
  firstPurchaseAt: string | null;
  quotesCount: number;
  openQuotesCount: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: string;
  refundedOrdersCount: number;
  conversationsCount: number;
  openConversationsCount: number;
  lastConversationId: string | null;
  firstContactAt: string;
  lastContactAt: string | null;
  notesCount: number;
  addressesCount: number;
  identitiesCount: number;
}

export type TimelineKind = "quote" | "order" | "payment" | "conversation" | "note";

export interface TimelineItem {
  kind: TimelineKind;
  id: string;
  at: string;
  status: string | null;
  amount: string | null;
  currency: string | null;
  meta: Record<string, unknown>;
}

export interface CustomerNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string; email: string } | null;
}

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  quote: "Cotización",
  order: "Pedido",
  payment: "Pago",
  conversation: "Conversación",
  note: "Nota",
};

/** Ruta de detalle de cada tipo de movimiento. Conversaciones: `?id=` abre el hilo en la bandeja. */
export function timelineHref(item: TimelineItem): string | undefined {
  switch (item.kind) {
    case "quote":
      return `/quotes/${item.id}`;
    case "order":
      return `/orders/${item.id}`;
    case "payment":
      return `/payments/${item.id}`;
    case "conversation":
      return `/conversations?id=${item.id}`;
    default:
      return undefined;
  }
}

/**
 * Catálogo SAT c_RegimenFiscal, los que la constancia suele traer. Mismo
 * conjunto que `constancia-parser.ts` (persona física / persona moral).
 */
export const REGIMENES_FISCALES = [
  { value: "601", label: "601 — General de Ley Personas Morales" },
  { value: "603", label: "603 — Personas Morales con Fines no Lucrativos" },
  { value: "605", label: "605 — Sueldos y Salarios" },
  { value: "606", label: "606 — Arrendamiento" },
  { value: "612", label: "612 — Personas Físicas con Actividades Empresariales y Profesionales" },
  { value: "620", label: "620 — Sociedades Cooperativas de Producción" },
  { value: "621", label: "621 — Incorporación Fiscal" },
  { value: "622", label: "622 — Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { value: "626", label: "626 — Régimen Simplificado de Confianza (RESICO)" },
  { value: "628", label: "628 — Hidrocarburos" },
] as const;

/** Catálogo SAT c_UsoCFDI — mismo que el checkout público. */
export const CFDI_USES = [
  { value: "G01", label: "G01 — Adquisición de mercancías" },
  { value: "G02", label: "G02 — Devoluciones, descuentos o bonificaciones" },
  { value: "G03", label: "G03 — Gastos en general" },
  { value: "P01", label: "P01 — Por definir" },
  { value: "S01", label: "S01 — Sin efectos fiscales" },
] as const;

export function regimenLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return REGIMENES_FISCALES.find((r) => r.value === code)?.label ?? code;
}

export function cfdiUseLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return CFDI_USES.find((u) => u.value === code)?.label ?? code;
}

/** RFC: 3 letras (moral) o 4 (física) + fecha AAMMDD + homoclave de 3. */
export const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Teléfono en formato apto para `wa.me`: solo dígitos, con lada de país. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // 10 dígitos sin lada → México.
  return digits.length === 10 ? `52${digits}` : digits;
}

export function formatAddress(a: CustomerAddress): string {
  return [a.line1, a.line2, `${a.postalCode} ${a.city}`.trim(), a.state, a.country]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" · ");
}

export function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
