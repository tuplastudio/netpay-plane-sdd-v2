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
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import {
  CreateDeliveryZoneDto,
  LookupDeliveryZoneDto,
  UpdateDeliveryZoneDto,
} from "./delivery-zone.dto.js";
import { countVertices } from "./geo.js";
import { isCatchAllZone } from "./zone-rules.js";
import { Type } from "class-transformer";
import { IsNumber, IsOptional, Max, Min } from "class-validator";

/**
 * Zonas de envío a domicilio del tenant (T-SHIP-01..03, polígonos T-SHIP-07).
 *
 * El admin las crea/edita desde el panel; el agente y el front consultan
 * `GET /shipping/lookup` (público bajo `catalog.read`) para saber cuánto
 * cobrar al cliente según su CP / ciudad / lat-lng.
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

  /**
   * Solo puede haber UNA zona catch-all por tenant. `excludeId` deja fuera la
   * zona que se está editando (si ya era catch-all, seguir siéndolo es válido).
   */
  private async assertNoOtherCatchAll(tenantId: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.deliveryZone.count({
      where: {
        tenantId,
        postalCodes: { isEmpty: true },
        cityPattern: null,
        state: null,
        polygon: { equals: Prisma.DbNull },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing > 0) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: "Ya existe una zona catch-all para este tenant",
      });
    }
  }

  /**
   * Resumen del polígono para auditoría: vértices, no la geometría completa
   * (hasta 2000 puntos por zona harían inmanejable la bitácora).
   */
  private polygonSummary(polygon: unknown): { vertices: number } | null {
    if (polygon === null || polygon === undefined) return null;
    return { vertices: countVertices(polygon) };
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
    if (isCatchAllZone(body)) {
      // Permitido (es la zona catch-all), pero solo UNA por tenant.
      await this.assertNoOtherCatchAll(tenantId);
    }
    const zone = await this.prisma.deliveryZone.create({
      data: {
        tenantId,
        name: body.name,
        postalCodes: body.postalCodes ?? [],
        cityPattern: body.cityPattern,
        state: body.state,
        polygon: body.polygon ? (body.polygon as Prisma.InputJsonValue) : Prisma.DbNull,
        color: body.color ?? null,
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
          polygon: this.polygonSummary(zone.polygon),
          color: zone.color,
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
      "color",
      "price",
      "minOrder",
      "sortOrder",
      "active",
      "notes",
    ] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.polygon !== undefined) {
      // `null` explícito = quitar el polígono (DbNull, no JsonNull: la
      // columna queda SQL NULL y el filtro de catch-all la ve vacía).
      data.polygon = body.polygon === null ? Prisma.DbNull : (body.polygon as Prisma.InputJsonValue);
    }
    // El resultado de aplicar el patch, ¿deja la zona como catch-all? Si sí,
    // no puede haber otra. Se mira la combinación existente + body porque un
    // PATCH parcial puede quitar el último criterio (p. ej. `polygon: null`).
    const merged = {
      postalCodes: body.postalCodes ?? existing.postalCodes,
      cityPattern: body.cityPattern !== undefined ? body.cityPattern : existing.cityPattern,
      state: body.state !== undefined ? body.state : existing.state,
      polygon: body.polygon !== undefined ? body.polygon : existing.polygon,
    };
    if (isCatchAllZone(merged)) {
      await this.assertNoOtherCatchAll(tenantId, id);
    }
    const zone = await this.prisma.deliveryZone.update({ where: { id }, data });
    // T-SHIP-06: el diff de campos contra `existing` queda en `metadata`
    // para que el admin pueda ver QUÉ cambió exactamente (precio, CPs,
    // estado) sin tener que comparar manualmente. El polígono se resume a
    // su número de vértices: la geometría completa no cabe en una bitácora.
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(data)) {
      const before =
        k === "polygon"
          ? this.polygonSummary(existing.polygon)
          : (existing as Record<string, unknown>)[k];
      const after =
        k === "polygon" ? this.polygonSummary(zone.polygon) : (zone as Record<string, unknown>)[k];
      const beforeJson = JSON.stringify(before ?? null);
      const afterJson = JSON.stringify(after ?? null);
      if (beforeJson !== afterJson) {
        diff[k] = { from: before ?? null, to: after ?? null };
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
        metadata: {
          name: existing.name,
          price: existing.price.toFixed(2),
          polygon: this.polygonSummary(existing.polygon),
        },
      },
    });
    return { data: { id, deleted: true }, requestId: RequestContext.requestId };
  }
}

/**
 * Lookup "qué zona me toca" — el agente y el front lo llaman cuando el
 * cliente ya dio dirección (o compartió su ubicación). Está en
 * `/shipping/lookup` (no bajo `tenants/me`) porque es una consulta de cara
 * al cliente, no de admin.
 *
 * `lat`/`lng` llegan como query string: `@Type(() => Number)` los convierte
 * antes de validar rango. Solo cuentan si vienen los dos.
 */
class LookupQuery implements LookupDeliveryZoneDto {
  @IsOptional() @Type(() => String) postalCode?: string;
  @IsOptional() @Type(() => String) city?: string;
  @IsOptional() @Type(() => String) state?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
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
    const hasPoint = typeof query.lat === "number" && typeof query.lng === "number";
    const resolved = await this.pricing.resolveShippingZone(tenantId, {
      postalCode: query.postalCode,
      city: query.city,
      state: query.state,
      lat: hasPoint ? query.lat : undefined,
      lng: hasPoint ? query.lng : undefined,
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
