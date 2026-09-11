import { Module } from "@nestjs/common";
import { WhatsAppController } from "./whatsapp.controller.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { AgentBridgeService } from "./agent-bridge.service.js";
import { AgentSettingsClient } from "./agent-settings.client.js";
import { ConversationAutoCloseService } from "./conversation-auto-close.service.js";
import { ConversationContextService } from "./conversation-context.service.js";
import { ReplyModerationService } from "./reply-moderation.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    AgentBridgeService,
    ConversationContextService,
    ReplyModerationService,
    AgentSettingsClient,
    // Se declara aquí para que su `onModuleInit` arranque el temporizador del
    // autocierre al levantar la app (ver conversation-auto-close.service.ts).
    ConversationAutoCloseService,
  ],
  exports: [WhatsAppService, AgentBridgeService],
})
export class WhatsAppModule {}
