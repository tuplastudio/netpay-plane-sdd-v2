import { Module } from "@nestjs/common";
import { OrderController } from "./order.controller.js";
import { OrderService } from "./order.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { CustomerModule } from "../customers/customer.module.js";
import { QuoteModule } from "../quotes/quote.module.js";
import { PaymentModule } from "../payments/payment.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";

@Module({
  imports: [
    AuthModule,
    PricingModule,
    CustomerModule,
    QuoteModule,
    PaymentModule,
    NotificationModule,
    WhatsAppModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}