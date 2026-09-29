import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoleGuard, RequireScopes } from "../auth/guards/role.guard.js";
import { RequestContext } from "../common/context/request-context.js";

/** Atajo: letras/números/guiones, sin "/" ni espacios (se escribe `/gracias`). */
const SHORTCUT_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
/** Tope de WhatsApp para un texto; el cuerpo de una respuesta rápida no puede pasarlo. */
const BODY_MAX = 4096;
/** Máximo de respuestas rápidas por tenant: un catálogo, no una base de conocimiento. */
const MAX_PER_TENANT = 200;

export class CreateCannedResponseDto {
  @IsString()
  @Matches(SHORTCUT_RE, {
    message: "shortcut: minúsculas, números, guion o guion bajo; sin espacios ni '/'; máximo 30",
  })
  shortcut!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body!: string;
}

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  @Matches(SHORTCUT_RE, {
    message: "shortcut: minúsculas, números, guion o guion bajo; sin espacios ni '/'; máximo 30",
  })
  shortcut?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  body?: string;
}

/**
 * Respuestas rápidas del tenant ("canned responses"): el redactor de la
 * bandeja las ofrece al teclear `/` y cualquier persona con `chat.read` las
 * ve; crearlas/editarlas pide `chat.write` (mismo permiso que contestar:
 * son texto que sale al cliente). Sin service aparte: es CRUD plano sobre
 * una tabla con RLS, como `tenants/me/delivery-zones`.
 */
@Controller("tenants/me/canned-responses")
@UseGuards(RoleGuard)
export class CannedResponsesController {
  constructor(private readonly prisma: PrismaService) {}

  private requireTenant(): string {
    const t = RequestContext.tenantId;
    if (!t) throw new NotFoundException({ code: "NOT_FOUND", message: "Sin tenant" });
    return t;
  }

  private async requireOne(tenantId: string, id: string) {
    const row = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Respuesta rápida no accesible" });
    }
    return row;
  }

  /** Lista completa (ordenada por atajo). `q` filtra por atajo o título. */
  @Get()
  @RequireScopes("chat.read" as never)
  async list(@Query("q") q?: string) {
    const tenantId = this.requireTenant();
    const term = q?.trim();
    const rows = await this.prisma.cannedResponse.findMany({
      where: {
        tenantId,
        ...(term
          ? {
              OR: [
                { shortcut: { contains: term.toLowerCase().replace(/^\//, "") } },
                { title: { contains: term, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ shortcut: "asc" }],
      take: MAX_PER_TENANT,
    });
    return { data: rows, requestId: RequestContext.requestId };
  }

  @Post()
  @HttpCode(201)
  @RequireScopes("chat.write" as never)
  async create(@Body() body: CreateCannedResponseDto) {
    const tenantId = this.requireTenant();
    const count = await this.prisma.cannedResponse.count({ where: { tenantId } });
    if (count >= MAX_PER_TENANT) {
      throw new BadRequestException({
        code: "RULE_VIOLATION",
        message: `Máximo ${MAX_PER_TENANT} respuestas rápidas por empresa`,
      });
    }
    try {
      const row = await this.prisma.cannedResponse.create({
        data: {
          tenantId,
          shortcut: body.shortcut.trim().toLowerCase(),
          title: body.title.trim(),
          body: body.body.trim(),
          createdByUserId: RequestContext.userId ?? null,
        },
      });
      return { data: row, requestId: RequestContext.requestId };
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  @Patch(":id")
  @RequireScopes("chat.write" as never)
  async update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: UpdateCannedResponseDto,
  ) {
    const tenantId = this.requireTenant();
    await this.requireOne(tenantId, id);
    try {
      const row = await this.prisma.cannedResponse.update({
        where: { id },
        data: {
          ...(body.shortcut !== undefined ? { shortcut: body.shortcut.trim().toLowerCase() } : {}),
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.body !== undefined ? { body: body.body.trim() } : {}),
        },
      });
      return { data: row, requestId: RequestContext.requestId };
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireScopes("chat.write" as never)
  async remove(@Param("id", new ParseUUIDPipe()) id: string) {
    const tenantId = this.requireTenant();
    await this.requireOne(tenantId, id);
    await this.prisma.cannedResponse.delete({ where: { id } });
  }

  /** Atajo repetido → 409 legible, no un 500 de Prisma. */
  private mapUnique(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new ConflictException({
        code: "CONFLICT",
        message: "Ya existe una respuesta rápida con ese atajo",
      });
    }
    return error;
  }
}
