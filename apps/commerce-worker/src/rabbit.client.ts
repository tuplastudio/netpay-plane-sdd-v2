import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as amqp from "amqplib";

type ConfirmChannel = amqp.ConfirmChannel;

@Injectable()
export class RabbitClient implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitClient.name);
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<void> | null = null;

  async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (!this.connecting) {
      this.connecting = this.ensureConnection();
    }
    await this.connecting;
    if (!this.channel) {
      throw new Error("Rabbit channel not available");
    }
    return this.channel;
  }

  private async ensureConnection(): Promise<void> {
    if (this.channel) return;
    const url = process.env.BROKER_URL ?? "amqp://netpay:netpay@localhost:5672";
    this.connection = await amqp.connect(url);
    this.connection.on("error", (err: Error) =>
      this.logger.error(`Rabbit connection error: ${err.message}`),
    );
    const channel = await this.connection.createConfirmChannel();
    await channel.assertExchange("netpay", "topic", { durable: true });
    this.channel = channel;
    this.logger.log("Rabbit connected");
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // ignore
    }
  }
}