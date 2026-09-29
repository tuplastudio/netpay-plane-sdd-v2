import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { CatalogService } from "./catalog.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import { parsePaging } from "../common/pagination.js";
import { ProductImageUploadInterceptor } from "./product-image-upload.interceptor.js";
import {
  AddVariantDto,
  CreateProductDto,
  DryRunImportDto,
  UpdateProductDto,
  UpdateVariantDto,
} from "./catalog.dto.js";

@Controller("catalog")
@UseGuards(RoleGuard)
export class CatalogController {
  private readonly logger = new Logger(CatalogController.name);

  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
  @RequireScopes("catalog.read")
  async list(
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const tenantId = this.requireTenant();
    // `offset` inválido → 400 (misma regla que el resto de listados).
    const offsetValue =
      offset === undefined || offset === ""
        ? undefined
        : parsePaging({ offset }, { defaultLimit: 25, maxLimit: 100 }).offset;
    const { items, pageInfo } = await this.catalog.listProducts(tenantId, {
      q,
      status: status as "DRAFT" | "ACTIVE" | "ARCHIVED" | undefined,
      cursor,
      limit: limit ? parsePaging({ limit }, { defaultLimit: 25, maxLimit: 100 }).limit : undefined,
      offset: offsetValue,
    });
    return { data: items, pageInfo, requestId: RequestContext.requestId };
  }

  @Get("products/:id")
  @RequireScopes("catalog.read")
  async get(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    const product = await this.catalog.getProduct(tenantId, id);
    return { data: product, requestId: RequestContext.requestId };
  }

  @Post("products")
  @RequireScopes("catalog.write")
  async create(@Body() body: CreateProductDto) {
    const tenantId = this.requireTenant();
    const userId = RequestContext.userId ?? null;
    const product = await this.catalog.createProduct(tenantId, userId, body);
    if (!userId) {
      // Sin usuario humano (API key / servicio) `createdById` queda NULL y
      // catalog.service no escribe AuditLog para altas: se deja rastro con el
      // apiKeyId para que la creación siga siendo atribuible.
      const p = RequestContext.principal;
      this.logger.log(
        `product.created sin usuario tenant=${tenantId} product=${product.id} ` +
          `principal=${p.type} apiKeyId=${p.apiKeyId ?? "-"} requestId=${RequestContext.requestId}`,
      );
    }
    return { data: product, requestId: RequestContext.requestId };
  }

  @Patch("products/:id")
  @RequireScopes("catalog.write")
  async update(@Param("id") id: string, @Body() body: UpdateProductDto) {
    const tenantId = this.requireTenant();
    const updated = await this.catalog.updateProduct(tenantId, id, body);
    return { data: updated, requestId: RequestContext.requestId };
  }

  @Post("products/:id/variants")
  @RequireScopes("catalog.write")
  async addVariant(@Param("id") productId: string, @Body() body: AddVariantDto) {
    const tenantId = this.requireTenant();
    const variant = await this.catalog.addVariant(tenantId, productId, body);
    return { data: variant, requestId: RequestContext.requestId };
  }

  @Patch("variants/:id")
  @RequireScopes("catalog.write")
  async updateVariant(@Param("id") id: string, @Body() body: UpdateVariantDto) {
    const tenantId = this.requireTenant();
    const variant = await this.catalog.updateVariant(tenantId, id, body);
    return { data: variant, requestId: RequestContext.requestId };
  }

  /**
   * Foto general del producto (portada de la galería). Multipart, campo
   * `file`. PNG, JPG o WebP, ≤ 5 MB, entre 200×200 y 6000×6000 px; ver
   * `product-image-validation.ts`. Se puede llamar varias veces: cada
   * llamada agrega una imagen más, no reemplaza las anteriores.
   */
  @Post("products/:id/images")
  @RequireScopes("catalog.write")
  @UseInterceptors(ProductImageUploadInterceptor)
  async addProductImage(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    const tenantId = this.requireTenant();
    const image = await this.catalog.addProductImage(tenantId, id, RequestContext.userId ?? null, file);
    return { data: image, requestId: RequestContext.requestId };
  }

  /** Foto propia de una variante (p.ej. color distinto al del producto). Mismas reglas que arriba. */
  @Post("variants/:id/images")
  @RequireScopes("catalog.write")
  @UseInterceptors(ProductImageUploadInterceptor)
  async addVariantImage(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    const tenantId = this.requireTenant();
    const image = await this.catalog.addVariantImage(tenantId, id, RequestContext.userId ?? null, file);
    return { data: image, requestId: RequestContext.requestId };
  }

  @Delete("images/:id")
  @HttpCode(204)
  @RequireScopes("catalog.write")
  async removeImage(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    await this.catalog.deleteImage(tenantId, id, RequestContext.userId ?? null);
  }

  @Post("imports/dry-run")
  @RequireScopes("catalog.write")
  async dryRunImport(
    @Body() body: DryRunImportDto,
  ) {
    const tenantId = this.requireTenant();
    const result = await this.catalog.dryRunImport(tenantId, body.rows);
    return { data: result, requestId: RequestContext.requestId };
  }

  /** Aplica de verdad una importación (crea/actualiza), tras revisar el dry-run. */
  @Post("imports/commit")
  @RequireScopes("catalog.write")
  async commitImport(
    @Body() body: DryRunImportDto,
  ) {
    const tenantId = this.requireTenant();
    const result = await this.catalog.commitImport(tenantId, RequestContext.userId ?? null, body.rows);
    return { data: result, requestId: RequestContext.requestId };
  }

  @Delete("products/:id")
  @HttpCode(204)
  @RequireScopes("catalog.write")
  async archive(@Param("id") id: string) {
    const tenantId = this.requireTenant();
    await this.catalog.archiveProduct(tenantId, id);
  }

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "UNAUTHORIZED", message: "Sin tenant" });
    return t;
  }
}