/**
 * Link público y duradero de seguimiento de pedido (modelo OrderTrackingToken).
 *
 * Una sola implementación para todos los que lo necesitan (OrderService,
 * PaymentService, el link público de la cotización): antes cada uno tenía su
 * copia del "mint-once" y era fácil que divergieran en formato de URL.
 *
 * Mint-once: si el pedido ya tiene token se reusa siempre. Generar uno nuevo
 * por cada aviso invalidaría el link que el cliente ya guardó en WhatsApp.
 */

import { randomBytes } from "node:crypto";

interface TrackingTokenClient {
  orderTrackingToken: {
    findUnique(args: { where: { orderId: string } }): Promise<{ token: string } | null>;
    create(args: { data: { orderId: string; token: string } }): Promise<{ token: string }>;
  };
}

/** Base pública del portal web (donde viven `/orders/public/track/:token` y `/checkout/:token`). */
export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function trackingUrl(token: string): string {
  return `${publicBaseUrl()}/orders/public/track/${token}`;
}

export async function getOrCreateTrackingToken(
  prisma: TrackingTokenClient,
  orderId: string,
): Promise<string> {
  const existing = await prisma.orderTrackingToken.findUnique({ where: { orderId } });
  if (existing) return existing.token;
  const token = randomBytes(24).toString("base64url");
  try {
    const created = await prisma.orderTrackingToken.create({ data: { orderId, token } });
    return created.token;
  } catch (err) {
    // Dos avisos simultáneos (p. ej. webhook de pago + "copiar link" en el
    // panel) pueden pasar los dos por el findUnique en vacío: el índice único
    // de orderId deja ganar a uno y el otro relee.
    if ((err as { code?: string }).code !== "P2002") throw err;
    const winner = await prisma.orderTrackingToken.findUnique({ where: { orderId } });
    if (!winner) throw err;
    return winner.token;
  }
}
