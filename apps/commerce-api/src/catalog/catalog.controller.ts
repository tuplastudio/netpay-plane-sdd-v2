import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
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
  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
  @RequireScopes("catalog.read")
  async list(
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const tenantId = this.requireTenant();
    const { items, pageInfo } = await this.catalog.listProducts(tenantId, {
      q,
      status: status as "DRAFT" | "ACTIVE" | "ARCHIVED" | undefined,
      cursor,
      limit: limit ? Number(limit) : undefined,
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
    const userId = this.requireUser();
    const product = await this.catalog.createProduct(tenantId, userId, body);
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

  private requireUser(): string {
    const u = RequestContext.userId;
    if (!u) throw new ForbiddenException({ code: "UNAUTHORIZED", message: "Sin usuario" });
    return u;
  }
}