import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { CustomerService, type CustomerListFilters } from "./customer.service.js";
import {
  CustomerProfileService,
  TIMELINE_KINDS,
  type TimelineKind,
} from "./customer-profile.service.js";
import { buildPageInfo, parsePaging } from "../common/pagination.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { ConstanciaUploadInterceptor } from "../orders/constancia-upload.interceptor.js";
import {
  CreateCustomerDto,
  CustomerAddressDto,
  CustomerConstanciaDto,
  CustomerNoteDto,
  LinkCustomerIdentityDto,
  ResolveChannelContactDto,
  UpdateCustomerAddressDto,
  UpdateCustomerProfileDto,
} from "./customer.dto.js";
import { RequestContext } from "../common/context/request-context.js";

@Controller("customers")
@UseGuards(RoleGuard)
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly profile: CustomerProfileService,
  ) {}

  private listFilters(query: {
    q?: string;
    includeArchived?: string;
    tag?: string;
    hasPendingPayment?: string;
  }): CustomerListFilters {
    return {
      q: query.q?.trim() || undefined,
      includeArchived: query.includeArchived === "true",
      tag: query.tag?.trim() || undefined,
      hasPendingPayment: query.hasPendingPayment === "true",
    };
  }

  @Get()
  @RequireScopes("customers.read")
  async list(
    @Query("q") q?: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("tag") tag?: string,
    @Query("hasPendingPayment") hasPendingPayment?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const tenantId = this.requireTenant();
    const paging = parsePaging({ limit, offset }, { defaultLimit: 25, maxLimit: 100 });
    const { items, total } = await this.customers.list(
      tenantId,
      this.listFilters({ q, includeArchived, tag, hasPendingPayment }),
      paging,
    );
    return {
      data: items,
      pageInfo: buildPageInfo(total, paging),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Rutas estáticas ANTES de `:id`: Express casa en orden de declaración y
   * "export.csv" / "tags" serían un id inválido.
   */
  @Get("export.csv")
  @RequireScopes("customers.read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="clientes.csv"')
  @Header("Cache-Control", "no-store")
  async exportCsv(
    @Query("q") q?: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("tag") tag?: string,
    @Query("hasPendingPayment") hasPendingPayment?: string,
  ): Promise<string> {
    const tenantId = this.requireTenant();
    return this.customers.exportCsv(
      tenantId,
      this.listFilters({ q, includeArchived, tag, hasPendingPayment }),
    );
  }

  /** Etiquetas en uso en el tenant, con conteo, para el filtro del listado. */
  @Get("tags")
  @RequireScopes("customers.read")
  async tags() {
    const tenantId = this.requireTenant();
    return { data: await this.profile.tags(tenantId), requestId: RequestContext.requestId };
  }

  @Get(":id")
  @RequireScopes("customers.read")
  async get(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.get(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  /** Cifras de por vida: pedidos, pagado, ticket promedio, cotizaciones abiertas… */
  @Get(":id/summary")
  @RequireScopes("customers.read")
  async summary(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.profile.summary(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Línea de tiempo unificada (cotizaciones, pedidos, pagos, conversaciones,
   * notas), más reciente primero. `kind` filtra a un solo tipo.
   */
  @Get(":id/timeline")
  @RequireScopes("customers.read")
  async timeline(
    @Param("id") id: string,
    @Query("kind") kind?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const tenantId = this.requireTenant();
    const k = (kind?.trim() || "all") as TimelineKind;
    if (!TIMELINE_KINDS.includes(k)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: `kind inválido; usa uno de: ${TIMELINE_KINDS.join(", ")}`,
      });
    }
    const paging = parsePaging({ limit, offset }, { defaultLimit: 25, maxLimit: 100 });
    const { items, total } = await this.profile.timeline(tenantId, id, k, paging);
    return {
      data: items,
      pageInfo: buildPageInfo(total, paging),
      requestId: RequestContext.requestId,
    };
  }

  /** Historial legado (cotizaciones + pedidos por separado). Lo usa el agente. */
  @Get(":id/history")
  @RequireScopes("customers.read")
  async history(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.history(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  // --- Notas internas ------------------------------------------------------

  @Get(":id/notes")
  @RequireScopes("customers.read")
  async listNotes(
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const tenantId = this.requireTenant();
    const paging = parsePaging({ limit, offset }, { defaultLimit: 25, maxLimit: 100 });
    const { items, total } = await this.profile.listNotes(tenantId, id, paging);
    return {
      data: items,
      pageInfo: buildPageInfo(total, paging),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/notes")
  @RequireScopes("customers.write")
  async addNote(@Param("id") id: string, @Body() body: CustomerNoteDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.profile.addNote(tenantId, id, RequestContext.userId, body.body),
      requestId: RequestContext.requestId,
    };
  }

  @Delete(":id/notes/:noteId")
  @RequireScopes("customers.write")
  async deleteNote(@Param("id") id: string, @Param("noteId") noteId: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.profile.deleteNote(tenantId, id, noteId),
      requestId: RequestContext.requestId,
    };
  }

  // --- Datos fiscales ------------------------------------------------------

  /**
   * Sube la constancia de situación fiscal (PDF, campo `file`) y completa
   * RFC, razón social, CP y régimen en la ficha. Los campos del body mandan
   * sobre lo leído del PDF; `cfdiUse` solo viene del body.
   */
  @Post(":id/fiscal/constancia")
  @RequireScopes("customers.write")
  @UseInterceptors(ConstanciaUploadInterceptor)
  async uploadConstancia(
    @Param("id") id: string,
    @Body() body: CustomerConstanciaDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const tenantId = this.requireTenant();
    if (!file) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Falta el archivo `file` (PDF de la constancia)",
      });
    }
    return {
      data: await this.profile.uploadConstancia(tenantId, id, file, {
        rfc: body.rfc?.trim() || undefined,
        legalName: body.legalName?.trim() || undefined,
        postalCode: body.postalCode?.trim() || undefined,
        regimenFiscal: body.regimenFiscal?.trim() || undefined,
        cfdiUse: body.cfdiUse?.trim() || undefined,
      }),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/archive")
  @RequireScopes("customers.write")
  async archive(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.archive(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/unarchive")
  @RequireScopes("customers.write")
  async unarchive(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.unarchive(tenantId, id),
      requestId: RequestContext.requestId,
    };
  }

  @Post()
  @RequireScopes("customers.write")
  async create(@Body() body: CreateCustomerDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.create(tenantId, body),
      requestId: RequestContext.requestId,
    };
  }

  /**
   * Usada por el agente (WhatsApp) para dejar el cliente completo y ligado a
   * la conversación en una sola llamada. Ver `CustomerService.resolveChannelContact`.
   */
  @Post("resolve-channel")
  @RequireScopes("customers.write")
  async resolveChannel(@Body() body: ResolveChannelContactDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.resolveChannelContact(tenantId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id")
  @RequireScopes("customers.write")
  async update(@Param("id") id: string, @Body() body: UpdateCustomerProfileDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.update(tenantId, id, body),
      requestId: RequestContext.requestId,
    };
  }

  // --- Direcciones ---------------------------------------------------------

  @Post(":id/addresses")
  @RequireScopes("customers.write")
  async addAddress(@Param("id") id: string, @Body() body: CustomerAddressDto) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.addAddress(tenantId, id, body),
      requestId: RequestContext.requestId,
    };
  }

  @Patch(":id/addresses/:addressId")
  @RequireScopes("customers.write")
  async updateAddress(
    @Param("id") id: string,
    @Param("addressId") addressId: string,
    @Body() body: UpdateCustomerAddressDto,
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.profile.updateAddress(tenantId, id, addressId, body),
      requestId: RequestContext.requestId,
    };
  }

  @Delete(":id/addresses/:addressId")
  @RequireScopes("customers.write")
  async deleteAddress(@Param("id") id: string, @Param("addressId") addressId: string) {
    const tenantId = this.requireTenant();
    return {
      data: await this.profile.deleteAddress(tenantId, id, addressId),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/identities")
  @RequireScopes("customers.write")
  async linkIdentity(
    @Param("id") id: string,
    @Body() body: LinkCustomerIdentityDto,
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.linkIdentity(tenantId, id, body.channel, body.externalId),
      requestId: RequestContext.requestId,
    };
  }

  @Post(":id/consents/:scope")
  @RequireScopes("customers.write")
  async grantConsent(
    @Param("id") id: string,
    @Param("scope") scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.grantConsent(tenantId, id, scope),
      requestId: RequestContext.requestId,
    };
  }

  @Delete(":id/consents/:scope")
  @RequireScopes("customers.write")
  async revokeConsent(
    @Param("id") id: string,
    @Param("scope") scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING",
  ) {
    const tenantId = this.requireTenant();
    return {
      data: await this.customers.revokeConsent(tenantId, id, scope),
      requestId: RequestContext.requestId,
    };
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}
