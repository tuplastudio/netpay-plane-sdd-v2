/** Prefiere WhatsApp (si hay teléfono) sobre email; null si no hay ningún canal. */
export function pickChannel(
  customer: { email?: string | null; phone?: string | null },
): { channel: "WHATSAPP" | "EMAIL"; to: string } | null {
  if (customer.phone) return { channel: "WHATSAPP", to: customer.phone };
  if (customer.email) return { channel: "EMAIL", to: customer.email };
  return null;
}
