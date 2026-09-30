/**
 * Proyecciones `data` de los eventos de dominio.
 *
 * Los servicios pasan la entidad recién confirmada y aquí se reduce a lo que
 * un sistema externo necesita: ids, estado, importes y fechas. Nunca tokens,
 * hashes, credenciales ni datos fiscales completos. Los importes van como
 * cadenas con dos decimales (`"1160.00"`), igual que en el API.
 *
 * Mantener estas funciones alineadas con los ejemplos de `event-catalog.ts`.
 */

type MoneyLike = { toFixed(digits: number): string } | string | number | null | undefined;

function money(value: MoneyLike): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toFixed(2);
  return value.toFixed(2);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface OrderLike {
  id: string;
  status: string;
  source: string;
  quoteId: string | null;
  customerId: string;
  subtotal: MoneyLike;
  discount: MoneyLike;
  tax: MoneyLike;
  shipping: MoneyLike;
  total: MoneyLike;
  description?: string | null;
  createdAt: Date;
  paidAt?: Date | null;
}

export function orderEventData(order: OrderLike): Record<string, unknown> {
  return {
    orderId: order.id,
    status: order.status,
    source: order.source,
    quoteId: order.quoteId ?? null,
    customerId: order.customerId,
    description: order.description ?? null,
    subtotal: money(order.subtotal),
    discount: money(order.discount),
    tax: money(order.tax),
    shipping: money(order.shipping),
    total: money(order.total),
    currency: "MXN",
    createdAt: iso(order.createdAt),
    paidAt: iso(order.paidAt),
  };
}

export interface QuoteLike {
  id: string;
  status: string;
  customerId: string;
  subtotal: MoneyLike;
  discount?: MoneyLike;
  tax: MoneyLike;
  shipping?: MoneyLike;
  total: MoneyLike;
  issuedAt?: Date | null;
  acceptedAt?: Date | null;
  expiresAt: Date;
}

export function quoteEventData(quote: QuoteLike): Record<string, unknown> {
  return {
    quoteId: quote.id,
    status: quote.status,
    customerId: quote.customerId,
    subtotal: money(quote.subtotal),
    discount: money(quote.discount),
    tax: money(quote.tax),
    shipping: money(quote.shipping),
    total: money(quote.total),
    currency: "MXN",
    issuedAt: iso(quote.issuedAt),
    acceptedAt: iso(quote.acceptedAt),
    expiresAt: iso(quote.expiresAt),
  };
}

export interface PaymentSessionLike {
  id: string;
  orderId: string;
  amount: MoneyLike;
  currency?: string;
  paymentMethod?: string | null;
}

export function paymentEventData(
  session: PaymentSessionLike,
  outcome: { status: "CAPTURED" | "FAILED"; orderPaid?: boolean; at: Date; paymentMethod?: string | null },
): Record<string, unknown> {
  return {
    sessionId: session.id,
    orderId: session.orderId,
    amount: money(session.amount),
    currency: session.currency ?? "MXN",
    status: outcome.status,
    paymentMethod: outcome.paymentMethod ?? session.paymentMethod ?? null,
    ...(outcome.status === "CAPTURED"
      ? { orderPaid: outcome.orderPaid === true, capturedAt: iso(outcome.at) }
      : { failedAt: iso(outcome.at) }),
  };
}

export interface CustomerLike {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  createdAt: Date;
}

/** `source`: "panel" (API/portal) o "whatsapp" (primer mensaje del cliente). */
export function customerEventData(
  customer: CustomerLike,
  source: "panel" | "whatsapp",
): Record<string, unknown> {
  return {
    customerId: customer.id,
    fullName: customer.fullName,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    source,
    createdAt: iso(customer.createdAt),
  };
}

export function handoffEventData(input: {
  conversationId: string;
  customerId: string | null;
  assignedUserId: string | null;
  source: "agent" | "human";
  at: Date;
}): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    customerId: input.customerId,
    assignedUserId: input.assignedUserId,
    source: input.source,
    handoffAt: iso(input.at),
  };
}

export interface ProductLike {
  id: string;
  sku: string;
  title: string;
  status: string;
  version: number;
  updatedAt: Date;
}

export interface VariantLike extends ProductLike {
  productId: string;
  price?: MoneyLike;
  currency?: string;
  stock?: MoneyLike;
}

export function productEventData(product: ProductLike): Record<string, unknown> {
  return {
    productId: product.id,
    variantId: null,
    sku: product.sku,
    title: product.title,
    status: product.status,
    version: product.version,
    updatedAt: iso(product.updatedAt),
  };
}

export function variantEventData(variant: VariantLike): Record<string, unknown> {
  return {
    productId: variant.productId,
    variantId: variant.id,
    sku: variant.sku,
    title: variant.title,
    status: variant.status,
    price: money(variant.price),
    currency: variant.currency ?? "MXN",
    stock: variant.stock === null || variant.stock === undefined ? null : String(variant.stock),
    version: variant.version,
    updatedAt: iso(variant.updatedAt),
  };
}
