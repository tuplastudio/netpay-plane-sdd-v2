export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  AUTHORIZED: "Autorizado",
  CAPTURED: "Cobrado",
  FAILED: "Fallido",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reemb. parcial",
  CANCELLED: "Cancelado",
};

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  CHARGE: "Cargo",
  REFUND: "Reembolso",
  ADJUSTMENT: "Ajuste",
  FEE: "Comisión",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  CHECKOUT_OPEN: "Checkout abierto",
  AWAITING_PAYMENT: "Esperando pago",
  PAID: "Pagado",
  FULFILLED: "Entregado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
};

export function statusVariant(
  status: string,
): "success" | "warning" | "muted" | "destructive" {
  if (status === "CAPTURED" || status === "PAID" || status === "FULFILLED") return "success";
  if (status === "PENDING" || status === "AWAITING_PAYMENT" || status === "CHECKOUT_OPEN")
    return "warning";
  if (
    status === "FAILED" ||
    status === "REFUNDED" ||
    status === "CANCELLED" ||
    status === "PARTIALLY_REFUNDED"
  )
    return "destructive";
  return "muted";
}

export function money(value: number | string, currency = "MXN"): string {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}
