/**
 * `/hooks`: administración de hooks salientes del tenant.
 *
 *   GET    /hooks                     lista
 *   POST   /hooks                     crea (devuelve `signingSecret` UNA vez)
 *   GET    /hooks/events              catálogo de eventos con ejemplo de payload
 *   GET    /hooks/deliveries/:id      detalle de una entrega (payload + respuesta)
 *   POST   /hooks/deliveries/:id/retry
 *   GET    /hooks/:id
 *   PATCH  /hooks/:id
 *   DELETE /hooks/:id
 *   POST   /hooks/:id/test            manda un `ping` real y devuelve el resultado
 *   POST   /hooks/:id/rotate-secret   nuevo `signingSecret` (se devuelve UNA vez)
 *   GET    /hooks/:id/deliveries?status&cursor&limit
 *
 * Las rutas fijas (`events`, `deliveries/...`) van antes de `:id` porque Nest
 * resuelve en orden de declaración. Scopes: los mismos de integraciones.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RequireScopes, RoleGuard } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { OutboundHookService } from "./outbound-hook.service.js";
import { CreateOutboundHookDto, ListDeliveriesQueryDto, UpdateOutboundHookDto } from "./outbound-hook.dto.js";

@Controller("hooks")
@UseGuards(RoleGuard)
export class HooksController {
  constructor(private readonly hooks: OutboundHookService) {}

  private envelope<T>(data: T) {
    return { data, requestId: RequestContext.requestId };
  }

  @Get()
  @RequireScopes("integrations.read")
  async list() {
    return this.envelope(await this.hooks.list(RequestContext.tenantId!));
  }

  @Post()
  @HttpCode(201)
  @RequireScopes("integrations.write")
  async create(@Body() body: CreateOutboundHookDto) {
    return this.envelope(
      await this.hooks.create(RequestContext.tenantId!, RequestContext.userId ?? null, body),
    );
  }

  @Get("events")
  @RequireScopes("integrations.read")
  events() {
    return this.envelope(this.hooks.events());
  }

  @Get("deliveries/:id")
  @RequireScopes("integrations.read")
  async getDelivery(@Param("id") id: string) {
    return this.envelope(await this.hooks.getDelivery(RequestContext.tenantId!, id));
  }

  @Post("deliveries/:id/retry")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async retry(@Param("id") id: string) {
    return this.envelope(
      await this.hooks.retry(RequestContext.tenantId!, RequestContext.userId ?? null, id),
    );
  }

  @Get(":id")
  @RequireScopes("integrations.read")
  async get(@Param("id") id: string) {
    return this.envelope(await this.hooks.get(RequestContext.tenantId!, id));
  }

  @Patch(":id")
  @RequireScopes("integrations.write")
  async update(@Param("id") id: string, @Body() body: UpdateOutboundHookDto) {
    return this.envelope(
      await this.hooks.update(RequestContext.tenantId!, RequestContext.userId ?? null, id, body),
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireScopes("integrations.write")
  async remove(@Param("id") id: string) {
    await this.hooks.remove(RequestContext.tenantId!, RequestContext.userId ?? null, id);
  }

  @Post(":id/test")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async test(@Param("id") id: string) {
    return this.envelope(
      await this.hooks.test(RequestContext.tenantId!, RequestContext.userId ?? null, id),
    );
  }

  @Post(":id/rotate-secret")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async rotateSecret(@Param("id") id: string) {
    return this.envelope(
      await this.hooks.rotateSecret(RequestContext.tenantId!, RequestContext.userId ?? null, id),
    );
  }

  @Get(":id/deliveries")
  @RequireScopes("integrations.read")
  async listDeliveries(@Param("id") id: string, @Query() query: ListDeliveriesQueryDto) {
    return this.envelope(
      await this.hooks.listDeliveries(RequestContext.tenantId!, id, {
        status: query.status,
        cursor: query.cursor,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    );
  }
}
