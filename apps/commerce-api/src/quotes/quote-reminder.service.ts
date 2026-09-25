/**
 * Recordatorios de cotización sin pagar y vencimiento de cotizaciones
 * (T-QTE-08 / T-NTF-07). Ver docs/07-qte.md y docs/14-ntf.md.
 *
 * Un barrido cada `SWEEP_INTERVAL_MS` hace dos cosas, en este orden:
 *
 * 1. **Vencer** las cotizaciones `ISSUED` cuya `expiresAt` ya pasó. Antes
 *    nadie llamaba a `markExpired`, así que una cotización vencida seguía
 *    figurando como vigente en los listados aunque su link público ya no
 *    resolviera (el token caduca con la cotización).
 * 2. **Recordar** las `ISSUED` vigentes que siguen sin pagarse, con la
 *    cadencia y el tope que el dueño configuró en el panel
 *    (`quoteReminderEnabled`, `quoteReminderEveryHours`,
 *    `quoteReminderMaxCount`). Apagar los recordatorios es un campo, no un
 *    despliegue.
 *
 * El envío no es directo: se encola en `NotificationService`, que es quien
 * aplica el opt-out del cliente, el horario 09-19 local y la ventana de
 * servicio de 24 h de Meta. Aquí sólo se decide *a quién* y *cuándo* toca.
 *
 * El contador vive en la propia cotización (`remindersSent`,
 * `lastReminderAt`) y se incrementa con un `updateMany` condicionado al
 * valor que se leyó: si dos instancias del API barren a la vez, sólo una
 * encola el recordatorio.
 *
 * No hay `@nestjs/schedule` en el proyecto: el barrido es un `setInterval`,
 * el mismo patrón que ya usa `NotificationService.onModuleInit`.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { pickChannel } from "../notifications/pick-channel.js";

/** Cada cuánto corre el barrido. */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Cuántas cotizaciones se procesan por pasada. */
const BATCH = 100;

@Injectable()
export class QuoteReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteReminderService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error(`barrido de cotizaciones falló: ${String(err)}`));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Una pasada completa: vencer primero, recordar después. */
  async sweep(now = new Date()): Promise<{ expired: number; reminded: number }> {
    const expired = await this.expireDueQuotes(now);
    const reminded = await this.remindUnpaid(now);
    if (expired || reminded) {
      this.logger.log(`barrido de cotizaciones: ${expired} vencidas, ${reminded} recordadas`);
    }
    return { expired, reminded };
  }

  /** `ISSUED` con `expiresAt` en el pasado → `EXPIRED`. */
  async expireDueQuotes(now = new Date()): Promise<number> {
    const result = await this.prisma.quote.updateMany({
      where: { status: "ISSUED", expiresAt: { lte: now } },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * Encola un recordatorio por cada cotización vigente sin pagar a la que le
   * toca. Devuelve cuántos se encolaron.
   */
  async remindUnpaid(now = new Date()): Promise<number> {
    const candidates = await this.prisma.quote.findMany({
      where: {
        status: "ISSUED",
        expiresAt: { gt: now },
        tenant: { status: "ACTIVE", quoteReminderEnabled: true },
        // Una cotización ya convertida en pedido pagado no se recuerda. El
        // pedido en curso (CHECKOUT_OPEN / AWAITING_PAYMENT) sí: es
        // exactamente el caso que el dueño quiere empujar.
        OR: [
          { order: null },
          { order: { status: { notIn: ["PAID", "FULFILLED", "CANCELLED", "REFUNDED"] } } },
        ],
      },
      include: { customer: true, tenant: true, shares: true },
      orderBy: { issuedAt: "asc" },
      take: BATCH,
    });

    let queued = 0;
    for (const quote of candidates) {
      const max = quote.tenant.quoteReminderMaxCount;
      if (max <= 0 || quote.remindersSent >= max) continue;

      const since = quote.lastReminderAt ?? quote.issuedAt ?? quote.createdAt;
      const everyMs = quote.tenant.quoteReminderEveryHours * 60 * 60 * 1000;
      if (now.getTime() - since.getTime() < everyMs) continue;

      const target = pickChannel(quote.customer);
      if (!target) continue;

      // Reserva del turno: si otra instancia ya lo tomó, `count` es 0 y esta
      // no encola nada.
      const claimed = await this.prisma.quote.updateMany({
        where: { id: quote.id, remindersSent: quote.remindersSent },
        data: { remindersSent: { increment: 1 }, lastReminderAt: now },
      });
      if (claimed.count === 0) continue;

      const link = await this.shareLink(quote.tenantId, quote.id, quote.expiresAt, quote.shares);
      await this.notifications.scheduleFromTemplate({
        tenantId: quote.tenantId,
        recipientType: "CUSTOMER",
        recipientId: quote.customerId,
        channel: target.channel,
        templateKey: "QUOTE_REMINDER",
        to: target.to,
        vars: {
          customerName: quote.customer.fullName,
          total: quote.total.toFixed(2),
          expiresAt: quote.expiresAt.toLocaleDateString("es-MX", {
            timeZone: quote.tenant.timezone,
            day: "numeric",
            month: "long",
          }),
          link,
        },
      });
      queued += 1;
    }
    return queued;
  }

  /**
   * Link público de la cotización: reusa un token vigente si lo hay (el
   * cliente puede tener ese mismo enlace abierto) y sólo emite uno nuevo
   * cuando no queda ninguno con vida.
   */
  private async shareLink(
    tenantId: string,
    quoteId: string,
    expiresAt: Date,
    shares: Array<{ token: string; expiresAt: Date }>,
  ): Promise<string> {
    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const alive = shares.find((s) => s.expiresAt.getTime() > Date.now());
    if (alive) return `${base}/quotes/public/${alive.token}`;
    const created = await this.prisma.quoteShareToken.create({
      data: {
        quoteId,
        tenantId,
        token: randomBytes(24).toString("base64url"),
        expiresAt,
      },
    });
    return `${base}/quotes/public/${created.token}`;
  }
}
