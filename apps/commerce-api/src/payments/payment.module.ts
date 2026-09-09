import { Module } from "@nestjs/common";
import { PaymentController } from "./payment.controller.js";
import { PaymentService } from "./payment.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationModule } from "../notifications/notification.module.js";

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}