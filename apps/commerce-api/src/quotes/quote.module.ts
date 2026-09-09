import { Module } from "@nestjs/common";
import { QuoteController } from "./quote.controller.js";
import { QuoteService } from "./quote.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { CustomerModule } from "../customers/customer.module.js";
import { NotificationModule } from "../notifications/notification.module.js";

@Module({
  imports: [AuthModule, PricingModule, CustomerModule, NotificationModule],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class QuoteModule {}