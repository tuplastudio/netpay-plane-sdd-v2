import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RequireScopes, RoleGuard } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";
import {
  CreateDataSourceDto,
  ListToolsDto,
  TestDataSourceDto,
  UpdateDataSourceDto,
} from "./data-source.dto.js";
import { DataSourceService } from "./data-source.service.js";

/**
 * /data-sources — fuentes de datos para sincronizar el catálogo.
 * Permisos: `integrations.read` para consultar, `integrations.write` para
 * todo lo demás (OWNER y ADMIN del tenant; ver auth/policies.ts).
 *
 * Las rutas fijas (`tools`, `test`) van ANTES de `:id` para que Nest no las
 * confunda con un id.
 */
@Controller("data-sources")
@UseGuards(RoleGuard)
export class DataSourceController {
  constructor(private readonly dataSources: DataSourceService) {}

  private envelope<T>(data: T) {
    return { data, requestId: RequestContext.requestId };
  }

  @Get()
  @RequireScopes("integrations.read")
  async list() {
    return this.envelope(await this.dataSources.list(RequestContext.tenantId!));
  }

  /** Tools de un servidor MCP: `?id=` para una fuente guardada. */
  @Get("tools")
  @RequireScopes("integrations.write")
  async toolsSaved(@Query("id") id?: string) {
    if (!id) {
      return this.envelope({ tools: [], message: "Manda ?id=<fuente> o usa POST /data-sources/tools" });
    }
    return this.envelope({ tools: await this.dataSources.listToolsSaved(RequestContext.tenantId!, id) });
  }

  /** Tools de un servidor MCP sin guardar la fuente (asistente de alta). */
  @Post("tools")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async tools(@Body() body: ListToolsDto) {
    return this.envelope({ tools: await this.dataSources.listTools(RequestContext.tenantId!, body) });
  }

  /** Prueba de conexión y vista previa sin guardar (asistente de alta/edición). */
  @Post("test")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async testAdHoc(@Body() body: TestDataSourceDto) {
    return this.envelope(await this.dataSources.test(RequestContext.tenantId!, body));
  }

  @Post()
  @HttpCode(201)
  @RequireScopes("integrations.write")
  async create(@Body() body: CreateDataSourceDto) {
    return this.envelope(
      await this.dataSources.create(RequestContext.tenantId!, RequestContext.userId ?? null, body),
    );
  }

  @Get(":id")
  @RequireScopes("integrations.read")
  async get(@Param("id") id: string) {
    return this.envelope(await this.dataSources.get(RequestContext.tenantId!, id));
  }

  @Patch(":id")
  @RequireScopes("integrations.write")
  async update(@Param("id") id: string, @Body() body: UpdateDataSourceDto) {
    return this.envelope(
      await this.dataSources.update(RequestContext.tenantId!, RequestContext.userId ?? null, id, body),
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireScopes("integrations.write")
  async remove(@Param("id") id: string) {
    await this.dataSources.remove(RequestContext.tenantId!, RequestContext.userId ?? null, id);
  }

  /** Conecta con la fuente guardada y devuelve 3 ítems mapeados sin escribir. */
  @Post(":id/test")
  @HttpCode(200)
  @RequireScopes("integrations.write")
  async test(@Param("id") id: string) {
    return this.envelope(await this.dataSources.testSaved(RequestContext.tenantId!, id));
  }

  /** Sincroniza ahora (en segundo plano). Devuelve el id del run. */
  @Post(":id/sync")
  @HttpCode(202)
  @RequireScopes("integrations.write")
  async sync(@Param("id") id: string) {
    return this.envelope(
      await this.dataSources.triggerSync(
        RequestContext.tenantId!,
        id,
        "MANUAL",
        RequestContext.userId ?? null,
      ),
    );
  }

  @Get(":id/runs")
  @RequireScopes("integrations.read")
  async runs(@Param("id") id: string) {
    return this.envelope(await this.dataSources.listRuns(RequestContext.tenantId!, id));
  }
}
