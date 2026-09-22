import { Body, Controller, NotFoundException, Post, UseGuards } from "@nestjs/common";
import { PricingService } from "./pricing.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { PricingPreviewDto } from "../quotes/quote.dto.js";

/**
 * Calculadora oficial de importes (T-PRC-02).
 *
 * Es la única fuente de totales para el agente IA y para el front: calcula
 * sin crear nada, de modo que el modelo nunca tenga que estimar un precio.
 *
 * Para `LOCAL_DELIVERY`, si el cliente ya dio CP / ciudad / estado, el
 * backend resuelve la zona del admin y sobreescribe `shipping` con el
 * precio de esa zona. Sin dirección, se cae al `shippingFlat` del tenant.
 */
@Controller("pricing")
@UseGuards(RoleGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post("preview")
  @RequireScopes("quotes.read")
  async preview(@Body() body: PricingPreviewDto) {
    const tenantId = RequestContext.tenantId;
    if (!tenantId) {
      throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    }
    const priced = await this.pricing.price(tenantId, body.lines ?? []);
    const deliveryMode = body.deliveryMode ?? "PICKUP";

    let shipping = priced.totals.shipping;
    let shippingZone: { id: string | null; name: string | null; fallback: boolean } = {
      id: null,
      name: null,
      fallback: false,
    };
    if (deliveryMode === "LOCAL_DELIVERY" && (body.postalCode || body.city || body.state)) {
      const resolved = await this.pricing.resolveShippingZone(tenantId, {
        postalCode: body.postalCode,
        city: body.city,
        state: body.state,
      });
      shipping = resolved.price;
      shippingZone = { id: resolved.zoneId, name: resolved.zoneName, fallback: resolved.fallback };
    }

    // `total` ya viene sumado; ajustamos solo el delta de envío para no
    // recomponer a mano la aritmética de BigInt del domain package.
    const newTotal = (
      Number(priced.totals.total) -
      Number(priced.totals.shipping) +
      Number(shipping)
    ).toFixed(2);

    return {
      data: {
        lines: priced.lines,
        totals: {
          ...priced.totals,
          shipping,
          total: newTotal,
        },
        shippingZone,
        deliveryMode,
      },
      requestId: RequestContext.requestId,
    };
  }
}
