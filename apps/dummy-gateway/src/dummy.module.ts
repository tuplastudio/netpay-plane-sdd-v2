import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CheckoutController } from "./checkout.controller.js";
import { WebhookController } from "./webhook.controller.js";
import { HealthController } from "./health.controller.js";
import { CheckoutStore } from "./checkout.store.js";
import { WebhookDispatcher } from "./webhook.dispatcher.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: [".env", "../../.env"] }),
  ],
  controllers: [CheckoutController, WebhookController, HealthController],
  providers: [CheckoutStore, WebhookDispatcher],
})
export class DummyModule {}