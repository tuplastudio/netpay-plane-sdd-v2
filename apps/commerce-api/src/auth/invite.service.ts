import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { PasswordResetMailer } from "./password-reset-mailer.service.js";


/**
 * Invitaciones, recuperación de contraseña y MFA challenge.
 * Ver docs/03-iam.md T-IAM-02.
 *
 * Tokens (firmados con HMAC y atando purpose, ver TokenService):
 *  - INVITE: 48h
 *  - PASSWORD_RESET: 30min, un solo uso
 *  - MFA_CHALLENGE: 5min, vinculado a sesión
 *
 * Throttling de forgot-password: 3 requests / hora por email. Es silencioso
 * (no devuelve 429) para preservar la respuesta uniforme — el atacante no
 * debe poder distinguir "email existe, throttled" de "email no existe".
 */
@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);
  private static readonly RESET_THROTTLE_LIMIT = 3;
  private static readonly RESET_THROTTLE_WINDOW_MS = 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    private readonly passwordResetMailer: PasswordResetMailer,
  ) {}

  async createInvite(input: {
    tenantId: string;
    email: string;
    fullName: string;
    role: "OWNER" | "ADMIN" | "VENDOR" | "FINANCE" | "CATALOG" | "SUPPORT" | "VIEWER";
  }): Promise<{ token: string; expiresAt: Date }> {
    const issued = this.tokens.issue({
      purpose: "INVITE",
      expiresInMs: 48 * 60 * 60 * 1000,
    });
    await this.prisma.invitation.create({
      data: {
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        role: input.role,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
      },
    });
    return { token: issued.token, expiresAt: issued.expiresAt };
  }

  async acceptInvite(input: { token: string; password: string }) {
    const { tokenHash } = this.tokens.verify(input.token, "INVITE");
    const invite = await this.prisma.invitation.findUnique({
      where: { tokenHash },
    });
    if (!invite || invite.acceptedAt) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invitación inválida o ya usada",
      });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invitación expirada",
      });
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });
    let user = existing;
    if (!user) {
      const hash = await this.passwords.hash(input.password);
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          fullName: invite.fullName,
          passwordHash: hash,
        },
      });
    }
    // Usuario ya existente (p. ej. invitado a una segunda empresa): la cuenta
    // es la misma y conserva su contraseña y sus sesiones. Aquí solo se añade
    // la membresía. No se toca el password a propósito: el enlace de
    // invitación lo ve quien invita, y si reseteara la contraseña bastaría
    // invitar a alguien para apoderarse de su cuenta en sus otras empresas.
    const existingUser = !!existing;

    // Idempotente: si ya había membresía (p. ej. DISABLED), se reactiva con
    // el rol de la invitación; si no, se crea. El usuario queda con una
    // membresía por empresa y elige la activa desde el selector del portal.
    await this.prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
      create: { tenantId: invite.tenantId, userId: user.id, role: invite.role },
      update: { role: invite.role, status: "ACTIVE" },
    });

    await this.prisma.invitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: invite.tenantId,
        actorId: user.id,
        action: "user.invited",
        targetType: "User",
        targetId: user.id,
        metadata: { role: invite.role, existingUser },
      },
    });

    return { userId: user.id, tenantId: invite.tenantId, role: invite.role, existingUser };
  }

  async requestPasswordReset(email: string): Promise<{ token?: string; throttled?: boolean }> {
    const normalized = email.toLowerCase();
    const throttleKey = `password_reset:${createHash("sha256").update(normalized).digest("hex")}`;
    const allowed = this.rateLimit.consume(
      throttleKey,
      InviteService.RESET_THROTTLE_LIMIT,
      InviteService.RESET_THROTTLE_WINDOW_MS,
    );
    if (!allowed) {
      // Silencioso: misma respuesta uniforme. Log para observabilidad interna.
      this.logger.warn(`forgot-password throttled para ${normalized}`);
      return { throttled: true };
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    // Respuesta uniforme: no revela si la cuenta existe.
    if (!user) return {};

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });
    if (!membership) return {};

    const issued = this.tokens.issue({
      purpose: "PASSWORD_RESET",
      expiresInMs: 30 * 60 * 1000,
    });
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
      },
    });

    // Audit: queda registro de que se solicitó un reset (sin incluir el
    // token). El `actorId` es el propio usuario objetivo; en este flujo
    // pre-autenticación no hay "actor" humano más fiable.
    await this.prisma.auditLog.create({
      data: {
        tenantId: membership.tenantId,
        actorId: user.id,
        action: "password.reset.requested",
        targetType: "User",
        targetId: user.id,
      },
    });

    const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const resetUrl = `${base}/reset?token=${encodeURIComponent(issued.token)}`;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: membership.tenantId },
      select: { primaryColor: true, accentColor: true },
    });

    await this.passwordResetMailer.sendBestEffort({
      email: user.email,
      fullName: user.fullName,
      resetUrl,
      primaryColor: tenant?.primaryColor ?? "#18181b",
      accentColor: tenant?.accentColor ?? "#2563eb",
    });

    return { token: issued.token };
  }

  async resetPassword(input: { token: string; newPassword: string }) {
    const { tokenHash } = this.tokens.verify(input.token, "PASSWORD_RESET");
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Token inválido o ya usado",
      });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Token expirado",
      });
    }
    const hash = await this.passwords.hash(input.newPassword);
    const usedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: hash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt },
      }),
      // Invalidar todas las sesiones activas: al cambiar password.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: usedAt },
      }),
    ]);

    // Audit post-transacción: si falla, el reset ya ocurrió pero el log
    // queda como "best effort". No hay tenant aquí porque PasswordResetToken
    // no es tenant-scoped, pero podemos derivarlo por la membresía activa.
    const membership = await this.prisma.membership.findFirst({
      where: { userId: record.userId, status: "ACTIVE" },
      select: { tenantId: true },
    });
    if (membership) {
      await this.prisma.auditLog.create({
        data: {
          tenantId: membership.tenantId,
          actorId: record.userId,
          action: "password.reset.completed",
          targetType: "User",
          targetId: record.userId,
        },
      });
    }

    return { ok: true };
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });
    if (!user) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Usuario no encontrado" });
    }
    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Contraseña actual incorrecta",
      });
    }
    const hash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash },
      }),
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }
}