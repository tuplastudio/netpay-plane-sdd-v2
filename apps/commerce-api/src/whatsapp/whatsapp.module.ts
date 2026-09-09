import { Module } from "@nestjs/common";
import { WhatsAppController } from "./whatsapp.controller.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { AgentBridgeService } from "./agent-bridge.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, AgentBridgeService],
  exports: [WhatsAppService, AgentBridgeService],
})
export class WhatsAppModule {}
