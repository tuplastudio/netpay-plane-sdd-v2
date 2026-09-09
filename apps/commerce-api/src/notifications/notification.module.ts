import { Module } from "@nestjs/common";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";

@Module({
  imports: [AuthModule, WhatsAppModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}