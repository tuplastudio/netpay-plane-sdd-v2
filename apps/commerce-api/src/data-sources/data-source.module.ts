import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DataSourceController } from "./data-source.controller.js";
import { DataSourceSchedulerService } from "./data-source-scheduler.service.js";
import { DataSourceService } from "./data-source.service.js";

/**
 * Fuentes de datos (sync de catálogo desde REST/MCP). Módulo aparte de
 * `integrations` a propósito: ese módulo son webhooks/eventos; este trae
 * productos. Ver docs/integrations/data-sources.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [DataSourceController],
  providers: [DataSourceService, DataSourceSchedulerService],
  exports: [DataSourceService],
})
export class DataSourceModule {}
