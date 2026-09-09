import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { OutboxPublisher } from "./outbox.publisher.js";
import { InboxConsumer } from "./inbox.consumer.js";
import { RabbitClient } from "./rabbit.client.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: [".env", "../../.env"] })],
  providers: [OutboxPublisher, InboxConsumer, RabbitClient],
  exports: [OutboxPublisher, InboxConsumer],
})
export class WorkerModule {}