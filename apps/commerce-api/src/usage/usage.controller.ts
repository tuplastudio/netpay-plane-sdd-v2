import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { UsageService } from "./usage.service.js";
import { RecordUsageEventDto } from "./usage.dto.js";

@Controller("usage")
@UseGuards(RoleGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /**
   * Interno: lo llama agent-v2 con su API key de servicio después de cada
   * turno. Sin `@RequireScopes`: cualquier principal autenticado (sesión o
   * API key) de este tenant puede reportar su propio consumo — el
   * aislamiento ya lo da `requireTenant()`, no hace falta un scope extra
   * para telemetría que nadie externo puede falsear a nombre de otro tenant.
   */
  @Post("events")
  async recordEvent(@Body() body: RecordUsageEventDto) {
    const tenantId = this.requireTenant();
    const event = await this.usage.record(tenantId, body);
    return { data: event, requestId: RequestContext.requestId };
  }

  @Get("summary")
  @RequireScopes("tenant.admin")
  async summary(@Query("from") from?: string, @Query("to") to?: string) {
    const tenantId = this.requireTenant();
    const data = await this.usage.summaryForTenant(tenantId, from, to);
    return { data, requestId: RequestContext.requestId };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}

@Controller("super-admin/usage")
@UseGuards(SuperAdminGuard)
export class SuperAdminUsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async summary(
    @Query("tenantId") tenantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const data = await this.usage.summaryAllTenants({ tenantId, from, to });
    return { data, requestId: RequestContext.requestId };
  }

  /**
   * Drill-down de una empresa: desglose día × modelo del rango pedido (por
   * defecto, el mes en curso). Alimenta los paneles laterales de la pestaña
   * "Costos" en /super-admin/:id. Vive aquí y no en `/super-admin/tenants/:id`
   * porque ese controlador no tiene `UsageService` a la mano.
   */
  @Get("detail")
  async detail(
    @Query("tenantId") tenantId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "tenantId es obligatorio",
      });
    }
    const data = await this.usage.detailForTenant(tenantId, from, to);
    return { data, requestId: RequestContext.requestId };
  }
}
