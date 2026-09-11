import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

/**
 * Bootstrap idempotente de tenant + propietario.
 * Ver docs/03-iam.md T-IAM-01.
 */
@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async run(input: {
    tenantName: string;
    ownerEmail: string;
    ownerFullName: string;
    ownerPassword: string;
    timezone: string;
  }) {
    if (!this.isIanaTimezone(input.timezone)) {
      throw new ConflictException({
        code: "VALIDATION_FAILED",
        message: `Invalid IANA timezone: ${input.timezone}`,
      });
    }

    const slug = this.slugify(input.tenantName);

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      // Idempotente: si el tenant ya existe, devolvemos info pero NO
      // creamos nuevo owner ni invitation.
      this.logger.warn(`Bootstrap: tenant '${slug}' ya existe, idempotente.`);
      const owner = await this.prisma.user.findUnique({ where: { email: input.ownerEmail } });
      if (!owner) {
        throw new ConflictException({
          code: "CONFLICT",
          message: "Tenant existe pero el email del owner no coincide.",
        });
      }
      return {
        tenantId: existing.id,
        ownerUserId: owner.id,
        invitationToken: "",
        configVersion: existing.configVersion,
        alreadyExisted: true,
      };
    }

    // SEGURIDAD: este endpoint es @Public(). El flag isSuperAdmin se concede
    // SOLO cuando la instalación está genuinamente vacía (sin tenants y sin
    // ningún super admin), que es el caso que documenta el comentario de
    // abajo. Antes se ponía `isSuperAdmin: true` en TODO bootstrap de un
    // tenant nuevo, así que cualquiera en internet podía crear una empresa con
    // un slug libre y salir con permisos de plataforma sobre TODAS las demás
    // (leer/renombrar/suspender tenants, emitir API keys, impersonar owners).
    // Ambas condiciones se leen antes de crear nada, si no el propio tenant
    // que estamos por insertar haría que el conteo dejara de ser cero.
    const [tenantCount, superAdminCount] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count({ where: { isSuperAdmin: true } }),
    ]);
    const isFirstInstall = tenantCount === 0 && superAdminCount === 0;
    if (!isFirstInstall) {
      this.logger.warn(
        `Bootstrap de '${slug}' sobre una instalación ya inicializada: se crea el tenant sin isSuperAdmin.`,
      );
    }

    const hash = await this.passwords.hash(input.ownerPassword);

    const tenant = await this.prisma.tenant.create({
      data: {
        slug,
        name: input.tenantName,
        timezone: input.timezone,
      },
    });

    // El owner del primer bootstrap (DB vacía) es quien opera la
    // plataforma completa: se marca isSuperAdmin para que pueda entrar a
    // /super-admin y dar de alta las empresas reales. Cualquier bootstrap
    // posterior crea un owner normal, acotado a su propio tenant.
    const user = await this.prisma.user.create({
      data: {
        email: input.ownerEmail.toLowerCase(),
        fullName: input.ownerFullName,
        passwordHash: hash,
        isSuperAdmin: isFirstInstall,
      },
    });

    await this.prisma.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    // Genera invitation token de un solo uso (no se usa aquí porque ya es owner,
    // pero el contrato lo expone para el primer re-acepto/verificación).
    const issued = this.tokens.issue({
      purpose: "INVITE",
      expiresInMs: 48 * 60 * 60 * 1000,
    });
    await this.prisma.invitation.create({
      data: {
        tenantId: tenant.id,
        email: input.ownerEmail.toLowerCase(),
        fullName: input.ownerFullName,
        role: "OWNER",
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId: user.id,
        action: "tenant.bootstrap",
        targetType: "Tenant",
        targetId: tenant.id,
      },
    });

    return {
      tenantId: tenant.id,
      ownerUserId: user.id,
      invitationToken: issued.token,
      configVersion: tenant.configVersion,
      alreadyExisted: false,
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "tenant";
  }

  private isIanaTimezone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
}