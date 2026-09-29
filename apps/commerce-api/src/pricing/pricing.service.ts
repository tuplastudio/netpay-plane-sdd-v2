/**
 * Pricing service: cálculo de totales, descuentos, envío y reservas.
 * Ver docs/05-prc.md T-PRC-01..06.
 *
 * Toda la aritmética pasa por `@netpay/domain` (BigInt, half-up).
 * Aquí solo orquestación: lee tenant.config, lee variantes, llama a pricing.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  applyDiscount,
  calculateQuoteTotals,
  qtyTimesPrice,
  type QuoteLineInput,
  type PricingConfig,
  type QuoteTotals,
} from "@netpay/domain";
import { isValidLat, isValidLng, pointInGeometry } from "../shipping/geo.js";
import {
  isCatchAllZone,
  type ShippingAddressInput,
  type ShippingZoneMatch,
  type ShippingZoneResolution,
} from "../shipping/zone-rules.js";

export type { ShippingAddressInput, ShippingZoneMatch, ShippingZoneResolution };

export interface PriceLineInput {
  variantId: string;
  quantity: string;
  discountPct?: number;
}

export interface PriceQuote {
  lines: Array<{
    variantId: string;
    sku: string;
    title: string;
    quantity: string;
    unitPrice: string;
    discountPct: number;
    lineSubtotal: string;
    satProductCode: string;
    satUnitCode: string;
  }>;
  totals: QuoteTotals;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async price(tenantId: string, lines: PriceLineInput[]): Promise<PriceQuote> {
    if (lines.length === 0) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Al menos una línea",
      });
    }
    if (lines.length > 200) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Máximo 200 líneas (ADR-011)",
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Tenant no accesible" });
    }

    const maxDiscount = Number(tenant.maxSellerDiscountPct);
    const variantIds = lines.map((l) => l.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, tenantId },
    });
    if (variants.length !== variantIds.length) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Variante no accesible",
      });
    }

    const linesForCalc: QuoteLineInput[] = [];
    const enriched: PriceQuote["lines"] = [];

    for (const line of lines) {
      const v = variants.find((x) => x.id === line.variantId);
      if (!v) {
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "Variante no accesible",
        });
      }
      if (v.status !== "ACTIVE") {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: `Variante ${v.sku} no está activa`,
        });
      }
      const discountPct = line.discountPct ?? 0;
      if (discountPct < 0 || discountPct > maxDiscount) {
        throw new BadRequestException({
          code: "RULE_VIOLATION",
          message: `Descuento ${discountPct}% excede máximo ${maxDiscount}%`,
        });
      }

      const lineSubtotal = applyDiscount(
        // 100% seguro: precio viene de BD Decimal
        qtyTimesPrice(line.quantity, this.decimalToMoney(v.price)),
        discountPct,
      );
      linesForCalc.push({
        variantId: v.id,
        quantity: line.quantity,
        unitPrice: this.decimalToMoney(v.price),
        discountPct,
      });
      enriched.push({
        variantId: v.id,
        sku: v.sku,
        title: v.title,
        quantity: line.quantity,
        unitPrice: this.decimalToMoney(v.price),
        discountPct,
        lineSubtotal,
        satProductCode: v.satProductCode,
        satUnitCode: v.satUnitCode,
      });
    }

    const config: PricingConfig = {
      taxRatePct: Number(tenant.taxRatePct),
      shippingFlat: this.decimalToMoney(tenant.shippingFlat),
    };
    const totals = calculateQuoteTotals(linesForCalc, config);
    return { lines: enriched, totals };
  }

  /**
   * Resuelve la zona de envío para `LOCAL_DELIVERY` con los datos de dirección
   * del cliente. Orden de precedencia:
   *   1. Polígono que contenga la `lat`/`lng` del cliente (T-SHIP-07), en
   *      orden de `sortOrder`: la primera zona con polígono que lo contenga.
   *   2. Coincidencia exacta por CP en `postalCodes[]`.
   *   3. Coincidencia por `state` + `cityPattern` (LIKE del admin).
   *   4. Zona "catch-all" (sin polígono, CP ni state; solo UNA por tenant).
   *   5. `tenant.shippingFlat` (compatibilidad).
   *
   * Devuelve `{ price, zoneId, zoneName, fallback, matchedBy }`.
   * `fallback=true` cuando no se encontró zona y se cobró `shippingFlat` (el
   * caller debe avisar al cliente que el envío es estándar, no
   * personalizado). `matchedBy` dice qué criterio ganó; los callers viejos
   * pueden ignorarlo (la forma anterior se conserva).
   */
  async resolveShippingZone(
    tenantId: string,
    address: ShippingAddressInput,
  ): Promise<ShippingZoneResolution> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { shippingFlat: true },
    });
    const flat = tenant ? this.decimalToMoney(tenant.shippingFlat) : "0.00";

    const zones = await this.prisma.deliveryZone.findMany({
      where: { tenantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    if (zones.length === 0) {
      return { price: flat, zoneId: null, zoneName: null, fallback: true, matchedBy: "fallback" };
    }

    const hit = (
      z: { id: string; name: string; price: { toString(): string } },
      matchedBy: ShippingZoneMatch,
    ): ShippingZoneResolution => ({
      price: this.decimalToMoney(z.price),
      zoneId: z.id,
      zoneName: z.name,
      fallback: false,
      matchedBy,
    });

    const cp = (address.postalCode ?? "").trim();
    const city = (address.city ?? "").trim().toLowerCase();
    const state = (address.state ?? "").trim().toLowerCase();
    const lat = address.lat;
    const lng = address.lng;

    // 1) Polígono que contenga el punto (solo si vino lat/lng válidas).
    if (isValidLat(lat) && isValidLng(lng)) {
      const byPolygon = zones.find((z) => z.polygon != null && pointInGeometry(lng, lat, z.polygon));
      if (byPolygon) return hit(byPolygon, "polygon");
    }
    // 2) Coincidencia por CP
    if (cp) {
      const byCp = zones.find((z) => z.postalCodes.some((p) => p.trim() === cp));
      if (byCp) return hit(byCp, "postalCode");
    }
    // 3) Coincidencia por estado + ciudad (LIKE)
    if (state && city) {
      const byStateCity = zones.find(
        (z) =>
          (z.state ?? "").trim().toLowerCase() === state &&
          city.includes((z.cityPattern ?? "").trim().toLowerCase()) &&
          (z.cityPattern ?? "").trim() !== "",
      );
      if (byStateCity) return hit(byStateCity, "city");
    }
    // 4) Zona catch-all (sin polígono, postalCodes ni cityPattern: aplica a TODO)
    const catchAll = zones.find((z) => isCatchAllZone(z));
    if (catchAll) return hit(catchAll, "catchAll");
    // 5) Fallback al flat del tenant.
    return { price: flat, zoneId: null, zoneName: null, fallback: true, matchedBy: "fallback" };
  }

  /**
   * Reserva atómica de stock al iniciar checkout.
   * Ver docs/05-prc.md T-PRC-05: evita oversell con decrement condicional.
   */
  async reserveStock(
    tenantId: string,
    items: Array<{ variantId: string; quantity: string }>,
  ): Promise<{ reserved: true } | { conflict: Array<{ variantId: string; available: string }> }> {
    // Itera decrementos condicionales; en Prisma se hace con
    // `updateMany` + condición sobre stock actual.
    for (const item of items) {
      // qty está en escala 3 decimales; stock también.
      const qty = this.decimalTo3(item.quantity);
      const result = await this.prisma.productVariant.updateMany({
        where: {
          id: item.variantId,
          tenantId,
          // Condición: stock disponible >= quantity (en escala 3)
          stock: { gte: qty },
        },
        data: { stock: { decrement: qty } },
      });
      if (result.count === 0) {
        const v = await this.prisma.productVariant.findFirst({
          where: { id: item.variantId, tenantId },
          select: { stock: true, sku: true },
        });
        return {
          conflict: [
            {
              variantId: item.variantId,
              available: v?.stock ? this.decimalTo3(v.stock) : "0.000",
            },
          ],
        };
      }
    }
    return { reserved: true };
  }

  async releaseStock(
    tenantId: string,
    items: Array<{ variantId: string; quantity: string }>,
  ): Promise<void> {
    for (const item of items) {
      await this.prisma.productVariant.updateMany({
        where: { id: item.variantId, tenantId },
        data: { stock: { increment: this.decimalTo3(item.quantity) } },
      });
    }
  }

  /** Prisma Decimal → string "NN.NN" (escala 2). */
  private decimalToMoney(value: { toString(): string }): string {
    const s = value.toString();
    const [int, frac = ""] = s.split(".");
    return `${int}.${(frac + "00").slice(0, 2)}`;
  }

  /** Prisma Decimal → string "NN.NNN" (escala 3). */
  private decimalTo3(value: { toString(): string }): string {
    const s = value.toString();
    const [int, frac = ""] = s.split(".");
    return `${int}.${(frac + "000").slice(0, 3)}`;
  }
}