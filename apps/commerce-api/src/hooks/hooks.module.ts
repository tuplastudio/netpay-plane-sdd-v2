import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HooksController } from "./hooks.controller.js";
import { OutboundHookService } from "./outbound-hook.service.js";
import { OutboundDispatcherService } from "./outbound-dispatcher.service.js";

/**
 * Hooks salientes (webhooks REST / herramientas MCP por tenant).
 *
 * Los servicios de negocio NO dependen de este módulo: emiten por el
 * `domainEvents` de `domain-event-bus.ts`, al que `OutboundHookService` se
 * suscribe en `onModuleInit`. El despachador arranca su `setInterval` aquí
 * mismo (ver outbound-dispatcher.service.ts).
 */
@Module({
  imports: [AuthModule],
  controllers: [HooksController],
  providers: [OutboundDispatcherService, OutboundHookService],
  exports: [OutboundHookService],
})
export class HooksModule {}
