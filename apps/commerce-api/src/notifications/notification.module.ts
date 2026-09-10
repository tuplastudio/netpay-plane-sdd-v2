import { Module } from "@nestjs/common";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { EmailModule } from "../email/email.module.js";

@Module({
  imports: [AuthModule, WhatsAppModule, EmailModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}