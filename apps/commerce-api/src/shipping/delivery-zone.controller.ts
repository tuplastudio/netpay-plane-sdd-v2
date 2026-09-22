import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import {
  CreateDeliveryZoneDto,
  LookupDeliveryZoneDto,
  UpdateDeliveryZoneDto,
} from "./delivery-zone.dto.js";
import { Type } from "class-transformer";
import { IsOptional } from "class-validator";

/**
 * Zonas de envío a domicilio del tenant (T-SHIP-01..03).
 *
 * El admin las crea/edita desde el panel; el agente y el front consultan
 * `POST /shipping/lookup` (público bajo `quotes.read`) para saber cuánto
 * cobrar al cliente según su CP / ciudad.
 *
 * `RequireScopes("tenant.admin")` en mutaciones: solo un admin de la empresa
 * puede cambiar precios y CPs. Las lecturas usan `catalog.read` para que el
 * agente y el front puedan resolver sin escalar privilegios.
 */
@Controller("tenants/me/delivery-zones")
@UseGuards(RoleGuard)
export class DeliveryZonesController {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }

  @Get()
  @RequireScopes("catalog.read")
  async list(@Query("activeOnly") activeOnly?: string) {
    const tenantId = this.requireTenant();
    const zones = await this.prisma.deliveryZone.findMany({
      where: {
        tenantId,
        ...(activeOnly === "true" ? { active: true } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { data: zones, requestId: RequestContext.requestId };
  }

  @Post()
  @RequireScopes("tenant.admin")
  async create(@Body() body: CreateDeliveryZoneDto) {
    const tenantId = this.requireTenant();
    if (!body.postalCodes && !body.cityPattern && !body.state) {
      // Permitido (es la zona catch-all), pero solo UNA por tenant.
      const existing = await this.prisma.deliveryZone.count({
        where: {
          tenantId,
          postalCodes: { isEmpty: true },
          cityPattern: null,
          state: null,
        },
      });
      if (existing > 0) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: "Ya existe una zona catch-all para este tenant",
        });
      }
    }
    const zone = await this.prisma.deliveryZone.create({
      data: {
        tenantId,
        name: body.name,
        postalCodes: body.postalCodes ?? [],
        cityPattern: body.cityPattern,
        state: body.state,
        price: body.price,
        minOrder: body.minOrder,
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
        notes: body.notes,
      },
    });
    // T-SHIP-06 — auditar cualquier cambio de precio (compliance + soporte
    // cuando un cliente discute el envío cobrado): el admin del tenant
    // también lo ve desde /audit, pero queda en log persistente.
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: RequestContext.userId ?? null,
        action: "delivery_zone.created",
        targetType: "DeliveryZone",
        targetId: zone.id,
        metadata: {
          name: zone.name,
          price: zone.price.toFixed(2),
          postalCodes: zone.postalCodes,
          cityPattern: zone.cityPattern,
          state: zone.state,
          active: zone.active,
        },
      },
    });
    return { data: zone, requestId: RequestContext.requestId };
  }

  @Patch(":id")
  @RequireScopes("tenant.admin")
  async update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: UpdateDeliveryZoneDto,
  ) {
    const tenantId = this.requireTenant();
    const existing = await this.prisma.deliveryZone.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Zona no encontrada" });
    }
    const data: Record<string, unknown> = {};
    for (const k of [
      "name",
      "postalCodes",
      "cityPattern",
      "state",
      "price",
      "minOrder",
      "sortOrder",
      "active",
      "notes",
    ] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    const zone = await this.prisma.deliveryZone.update({ where: { id }, data });
    // T-SHIP-06: el diff de campos contra `existing` queda en `metadata`
    // para que el admin pueda ver QUÉ cambió exactamente (precio, CPs,
    // estado) sin tener que comparar manualmente. `Prisma.InputJsonValue`
    // es más estricto que `unknown` y rechaza objetos no-JSON-serializables;
    // aquí todo viene de columnas Prisma, así que es seguro.
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(data)) {
      const before = (existing as Record<string, unknown>)[k];
      const after = (zone as Record<string, unknown>)[k];
      const beforeJson = JSON.stringify(before);
      const afterJson = JSON.stringify(after);
      if (beforeJson !== afterJson) {
        diff[k] = { from: before, to: after };
      }
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: RequestContext.userId ?? null,
        action: "delivery_zone.updated",
        targetType: "DeliveryZone",
        targetId: zone.id,
        metadata: diff as Record<string, unknown> as never,
      },
    });
    return { data: zone, requestId: RequestContext.requestId };
  }

  @Delete(":id")
  @RequireScopes("tenant.admin")
  async remove(@Param("id", new ParseUUIDPipe()) id: string) {
    const tenantId = this.requireTenant();
    const existing = await this.prisma.deliveryZone.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Zona no encontrada" });
    }
    await this.prisma.deliveryZone.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: RequestContext.userId ?? null,
        action: "delivery_zone.deleted",
        targetType: "DeliveryZone",
        targetId: id,
        metadata: { name: existing.name, price: existing.price.toFixed(2) },
      },
    });
    return { data: { id, deleted: true }, requestId: RequestContext.requestId };
  }
}

/**
 * Lookup "qué zona me toca" — el agente y el front lo llaman cuando el
 * cliente ya dio dirección. Está en `/shipping/lookup` (no bajo `tenants/me`)
 * porque es una consulta de cara al cliente, no de admin.
 */
class LookupQuery implements LookupDeliveryZoneDto {
  @IsOptional() @Type(() => String) postalCode?: string;
  @IsOptional() @Type(() => String) city?: string;
  @IsOptional() @Type(() => String) state?: string;
}

@Controller("shipping")
@UseGuards(RoleGuard)
export class ShippingLookupController {
  constructor(private readonly pricing: PricingService) {}

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }

  @Get("lookup")
  @RequireScopes("catalog.read")
  async lookup(@Query() query: LookupQuery) {
    const tenantId = this.requireTenant();
    const resolved = await this.pricing.resolveShippingZone(tenantId, {
      postalCode: query.postalCode,
      city: query.city,
      state: query.state,
    });
    return {
      data: {
        ...resolved,
        // Para el front: precio como número (no string) por consistencia con
        // el resto de importes.
        priceNumber: Number(resolved.price),
      },
      requestId: RequestContext.requestId,
    };
  }
}
