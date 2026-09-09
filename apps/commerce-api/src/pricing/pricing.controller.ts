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
    return {
      data: {
        lines: priced.lines,
        totals: priced.totals,
        // El envío por recolección no cobra flat; el backend decide, no el cliente.
        deliveryMode: body.deliveryMode ?? "PICKUP",
        ...priced.totals,
      },
      requestId: RequestContext.requestId,
    };
  }
}
