import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ReportsService } from "./reports.service.js";
import { AttentionReportService, resolveRange } from "./attention.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { effectiveScopesOf } from "../auth/policies.js";

/**
 * Mismo patrón exacto que `PaymentController`: `PrincipalGuard` global resuelve
 * el principal y el tenant, `RoleGuard` a nivel de controlador exige los scopes
 * declarados por handler, el tenant sale de `RequestContext` (nunca del body ni
 * de la query) y la respuesta va envuelta en `{ data, requestId }`.
 *
 * Scope: `payments.read`. Es el mismo que ya protege `/payments/sessions`, de
 * donde salían las cifras de dinero de esta pantalla, así que quien ve el
 * panorama hoy lo sigue viendo y nadie gana acceso nuevo. No se pide además
 * `orders.read` / `quotes.read` / `catalog.read` / `chat.read` porque
 * `RequireScopes` es conjuntivo y esa combinación dejaría fuera a FINANCE, que
 * no tiene `chat.read` y sí es el rol que vive en esta pantalla.
 */
@Controller("reports")
@UseGuards(RoleGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly attention: AttentionReportService,
  ) {}

  /**
   * Reporte de atención de conversaciones: volumen, tiempos de respuesta y
   * carga por agente. Scope `chat.read`: es lo que ya abre la bandeja, así que
   * nadie gana acceso nuevo a los hilos; FINANCE/CATALOG/VIEWER no lo ven.
   */
  @Get("attention")
  @RequireScopes("chat.read")
  async attentionReport(@Query("from") from?: string, @Query("to") to?: string) {
    const tenantId = RequestContext.tenantId!;
    const parse = (name: string, raw?: string) => {
      if (!raw) return undefined;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} no es una fecha válida`);
      return d;
    };
    let range;
    try {
      range = resolveRange(parse("from", from), parse("to", to));
    } catch (e) {
      if (e instanceof RangeError) throw new BadRequestException(e.message);
      throw e;
    }
    return {
      data: await this.attention.report(tenantId, range),
      requestId: RequestContext.requestId,
    };
  }

  @Get("summary")
  @RequireScopes("payments.read")
  async summary() {
    const tenantId = RequestContext.tenantId!;
    return {
      data: await this.reports.summary(tenantId),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Dashboard operativo: KPIs unificados + lista corta de actividad reciente
   * (pedidos, conversaciones, bitácora) y serie de ventas de 7 días.
   *
   * Scope: `payments.read` (mismo razonamiento que `summary`: el rol FINANCE
   * es el que vive en esta pantalla y no tiene `chat.read`; abrir la
   * combinación `payments.read + chat.read + orders.read + catalog.read`
   * dejaría fuera al FINANCE).
   */
  @Get("dashboard")
  @RequireScopes("payments.read")
  async dashboard() {
    const tenantId = RequestContext.tenantId!;
    const data = await this.reports.dashboard(tenantId);
    // Un solo scope abre la pantalla, pero los hilos de WhatsApp y la
    // bitácora solo se entregan a quien puede leerlos por su propia ruta.
    const scopes = effectiveScopesOf(RequestContext.principal);
    return {
      data: {
        ...data,
        recentConversations: scopes.has("chat.read") ? data.recentConversations : [],
        recentActivity: scopes.has("audit.read") ? data.recentActivity : [],
      },
      requestId: RequestContext.requestId,
    };
  }
}
