import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { QuoteService } from "./quote.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { Public } from "../auth/guards/principal.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { CreateQuoteDto, UpdateQuoteDto, ShareQuoteDto } from "./quote.dto.js";
import { renderQuotePdf, type QuotePdfData } from "./quote-pdf.js";

@Controller("quotes")
@UseGuards(RoleGuard)
export class QuoteController {
  constructor(private readonly quotes: QuoteService) {}

  @Get()
  @RequireScopes("quotes.read")
  async list(@Query("status") status?: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.quotes.list(tenantId, status),
      requestId: RequestContext.requestId,
    };
  }

  @Get(":id")
  @RequireScopes("quotes.read")
  async get(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.quotes.get(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post()
  @RequireScopes("quotes.write")
  async create(@Body() body: CreateQuoteDto) {
    const tenantId = this.requireTenant();
    // Un principal de API key (p. ej. el agente) no tiene userId: se audita
    // como actor nulo, el scope ya autorizó la operación.
    const actorId = RequestContext.userId ?? null;
    return {
      data: await this.quotes.create(tenantId, actorId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id")
  @RequireScopes("quotes.write")
  async update(@Param("id") id: string, @Body() body: UpdateQuoteDto) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    return {
      data: await this.quotes.update(tenantId, id, actorId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id/issue")
  @RequireScopes("quotes.write")
  async issue(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.quotes.issue(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id/cancel")
  @RequireScopes("quotes.write")
  async cancel(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    const actorId = RequestContext.userId ?? null;
    return {
      data: await this.quotes.cancel(tenantId, id, actorId),
      requestId: RequestContext.requestId,
    };
  }

  @Get(":id/pdf")
  @RequireScopes("quotes.read")
  async pdf(@Param("id") id: string, @Res() res: Response) {
    const tenantId = this.requireTenant();
    const quote = await this.quotes.get(tenantId, id);
    const pdf = await renderQuotePdf(quote as unknown as QuotePdfData);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename=cotizacion-${quote.id}.pdf`);
    res.send(pdf);
  }

  @Post(":id/share")
  @RequireScopes("quotes.write")
  async share(@Param("id") id: string, @Body() body: ShareQuoteDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.quotes.createShareToken(tenantId, id, { notify: body?.notify !== false }),
      requestId: RequestContext.requestId,
    };
  }

  // ---- Endpoints públicos (sin auth) ----

  @Public()
  @Get("public/:token")
  async publicView(@Param("token") token: string) {
    const quote = await this.quotes.resolveShareToken(token);
    if (!quote) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    // Lista blanca explícita: este endpoint es público (cualquiera con el link).
    // No se expone el email del cliente ni ids internos de línea (variantId,
    // quoteId, claves SAT). `notes` es la nota que la empresa escribe PARA el
    // cliente (el mismo texto sale impreso en el PDF); no hay campo de notas
    // internas en Quote.
    return {
      data: {
        id: quote.id,
        status: quote.status,
        subtotal: quote.subtotal,
        discount: quote.discount,
        taxBase: quote.taxBase,
        tax: quote.tax,
        shipping: quote.shipping,
        total: quote.total,
        expiresAt: quote.expiresAt,
        notes: quote.notes ?? null,
        customer: { fullName: quote.customer.fullName, email: null },
        // Quién emite: nombre y logo de la empresa para el encabezado público.
        merchant: { name: quote.tenant.name, logoUrl: quote.tenant.logoUrl ?? null },
        lines: quote.lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          title: l.title,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          lineSubtotal: l.lineSubtotal,
        })),
        // Estado de cobro para que el cliente pueda pagar desde este mismo
        // link: `order` dice si ya se pagó; `checkoutToken` es el link de
        // pago vigente (o null: se pide con POST /orders/public/quote/:token/checkout).
        order: quote.order ? { id: quote.order.id, status: quote.order.status } : null,
        checkoutToken: await this.quotes.activeCheckoutToken(quote.order),
      },
      requestId: RequestContext.requestId,
    };
  }

  @Public()
  @Get("public/:token/pdf")
  async publicPdf(@Param("token") token: string, @Res() res: Response) {
    const quote = await this.quotes.resolveShareToken(token);
    if (!quote) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Link inválido o expirado" });
    }
    const pdf = await renderQuotePdf(quote as unknown as QuotePdfData);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename=cotizacion-${quote.id}.pdf`);
    res.send(pdf);
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}