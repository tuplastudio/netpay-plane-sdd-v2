import { Module } from "@nestjs/common";
import { IntegrationController } from "./integration.controller.js";
import { IntegrationService } from "./integration.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}