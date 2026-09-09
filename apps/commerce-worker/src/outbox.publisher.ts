import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { ConfirmChannel } from "amqplib";
import { RabbitClient } from "./rabbit.client.js";

/**
 * Outbox publisher.
 *
 * 1. Poll: lee filas PENDING o lease expirado.
 * 2. Publish a exchange "netpay" con routing key = eventName.
 * 3. Confirma broker (publish confirm).
 * 4. Marca PUBLISHED + publishedAt.
 *
 * Crash entre commit del publicador y publish: el siguiente poll detecta lease
 * expirado y reintenta. Inbox del consumidor dedup por eventId evita duplicar efectos.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly prisma = new PrismaClient();
  private readonly rabbit: RabbitClient;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly POLL_MS = 1000;
  private readonly LEASE_MS = 30_000;
  private readonly BATCH = 50;

  constructor() {
    this.rabbit = new RabbitClient();
  }

  async start(): Promise<void> {
    this.running = true;
    this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.prisma.$disconnect();
    await this.rabbit.onModuleDestroy();
  }

  private tick(): void {
    if (!this.running) return;
    this.pollOnce()
      .catch((err) => this.logger.error(`Poll error: ${String(err)}`))
      .finally(() => {
        if (this.running) this.timer = setTimeout(() => this.tick(), this.POLL_MS);
      });
  }

  private async pollOnce(): Promise<void> {
    const leaseUntil = new Date(Date.now() - this.LEASE_MS);

    const claimed = await this.prisma.outboxEvent.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: leaseUntil } }],
      },
      orderBy: { createdAt: "asc" },
      take: this.BATCH,
    });

    if (claimed.length === 0) return;

    const now = new Date();
    const leaseExpiry = new Date(now.getTime() + this.LEASE_MS);

    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      data: { status: "IN_FLIGHT", leaseExpiresAt: leaseExpiry, attempts: { increment: 1 } },
    });

    const channel: ConfirmChannel = await this.rabbit.getChannel();

    for (const event of claimed) {
      try {
        const payload = Buffer.from(JSON.stringify(event.payload));
        await new Promise<void>((resolve, reject) => {
          channel.publish(
            "netpay",
            event.eventName,
            payload,
            {
              persistent: true,
              contentType: "application/json",
              messageId: event.id,
              headers: {
                "x-event-name": event.eventName,
                "x-tenant-id": event.tenantId,
                "x-schema-version": String(event.schemaVersion),
                "x-livemode": "false",
              },
            },
            (err: Error | null) => (err ? reject(err) : resolve()),
          );
        });
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
      } catch (err) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            lastError: String(err).slice(0, 500),
          },
        });
        this.logger.error(`Publish failed event=${event.id}: ${String(err)}`);
      }
    }
  }
}