import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { ConsumeMessage } from "amqplib";
import { RabbitClient } from "./rabbit.client.js";
import { handleEvent } from "./handlers.js";

/**
 * Inbox consumer (T-FND-04).
 *
 * Cola durable por consumer group enlazada al exchange "netpay" con patrones
 * de routing. Dedup por `(consumerGroup, eventId)` con índice único: un evento
 * reentregado se reconoce y se descarta sin repetir efectos.
 *
 * El ack va después de escribir el resultado, no antes: si el proceso muere a
 * medio camino, el broker vuelve a entregar y el inbox decide si ya se aplicó.
 */
@Injectable()
export class InboxConsumer {
  private readonly logger = new Logger(InboxConsumer.name);
  private readonly prisma = new PrismaClient();
  private readonly rabbit = new RabbitClient();
  private readonly consumerGroup = process.env.CONSUMER_GROUP ?? "commerce-worker";
  private readonly patterns = (process.env.CONSUMER_PATTERNS ?? "#")
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  private readonly prefetch = Number(process.env.CONSUMER_PREFETCH ?? 10);
  private consumerTag: string | null = null;

  get queueName(): string {
    return `netpay.${this.consumerGroup}`;
  }

  get deadLetterName(): string {
    return `netpay.${this.consumerGroup}.dlq`;
  }

  async start(): Promise<void> {
    const channel = await this.rabbit.getChannel();
    await channel.prefetch(this.prefetch);

    await channel.assertQueue(this.deadLetterName, { durable: true });
    await channel.assertQueue(this.queueName, {
      durable: true,
      deadLetterExchange: "",
      deadLetterRoutingKey: this.deadLetterName,
    });
    for (const pattern of this.patterns) {
      await channel.bindQueue(this.queueName, "netpay", pattern);
    }

    const { consumerTag } = await channel.consume(this.queueName, (message) => {
      if (message) void this.onMessage(message);
    });
    this.consumerTag = consumerTag;

    this.logger.log(
      `Inbox consumiendo ${this.queueName} (patrones: ${this.patterns.join(", ")})`,
    );
  }

  async stop(): Promise<void> {
    try {
      if (this.consumerTag) {
        const channel = await this.rabbit.getChannel();
        await channel.cancel(this.consumerTag);
      }
    } catch (error) {
      this.logger.warn(`Cancelación de consumidor: ${String(error)}`);
    }
    await this.prisma.$disconnect();
    await this.rabbit.onModuleDestroy();
  }

  private async onMessage(message: ConsumeMessage): Promise<void> {
    const channel = await this.rabbit.getChannel();
    const eventId = message.properties.messageId;
    const tenantId = String(message.properties.headers?.["x-tenant-id"] ?? "");
    const eventName =
      String(message.properties.headers?.["x-event-name"] ?? "") || message.fields.routingKey;

    // Sin identidad no hay dedup posible: va a la DLQ, no se reintenta en bucle.
    if (!eventId || !tenantId) {
      this.logger.warn(`Evento sin messageId o tenant (${eventName}); a la DLQ`);
      channel.nack(message, false, false);
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message.content.toString());
    } catch {
      this.logger.warn(`Evento ${eventId} con payload no JSON; a la DLQ`);
      channel.nack(message, false, false);
      return;
    }

    try {
      // Dedup: la clave única (consumerGroup, eventId) decide quién procesa.
      const existing = await this.prisma.inboxEvent.findUnique({
        where: { consumerGroup_eventId: { consumerGroup: this.consumerGroup, eventId } },
      });
      if (existing?.status === "PROCESSED") {
        channel.ack(message);
        return;
      }

      if (!existing) {
        await this.prisma.inboxEvent.create({
          data: {
            tenantId,
            consumerGroup: this.consumerGroup,
            eventId,
            eventName,
            payload: payload as never,
          },
        });
      }

      await handleEvent({ eventName, tenantId, eventId, payload });

      await this.prisma.inboxEvent.update({
        where: { consumerGroup_eventId: { consumerGroup: this.consumerGroup, eventId } },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
      });
      channel.ack(message);
    } catch (error) {
      const reason = String(error).slice(0, 500);
      this.logger.error(`Evento ${eventId} (${eventName}) falló: ${reason}`);
      await this.prisma.inboxEvent
        .updateMany({
          where: { consumerGroup: this.consumerGroup, eventId },
          data: { status: "FAILED", lastError: reason },
        })
        .catch(() => undefined);
      // requeue=false: el reintento lo decide la operación desde la DLQ.
      channel.nack(message, false, false);
    }
  }
}
