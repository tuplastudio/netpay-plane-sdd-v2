import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PasswordService } from "./password.service.js";
import { SessionService } from "./session.service.js";
import { TokenService } from "./token.service.js";

/**
 * Invitaciones, recuperación de contraseña y MFA challenge.
 * Ver docs/03-iam.md T-IAM-02.
 *
 * Tokens:
 *  - INVITE: 48h
 *  - PASSWORD_RESET: 30min, un solo uso
 *  - MFA_CHALLENGE: 5min, vinculado a sesión
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
  ) {}

  async createInvite(input: {
    tenantId: string;
    email: string;
    fullName: string;
    role: "VENDOR" | "FINANCE" | "CATALOG" | "SUPPORT" | "VIEWER";
  }): Promise<{ token: string; expiresAt: Date }> {
    const issued = this.tokens.issue({
      tenantId: input.tenantId,
      email: input.email.toLowerCase(),
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
    const tokenHash = this.tokens.hash(input.token);
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

    let user = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (!user) {
      const hash = await this.passwords.hash(input.password);
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          fullName: invite.fullName,
          passwordHash: hash,
        },
      });
    } else {
      // Resetear password al aceptar (es el flujo esperado).
      const hash = await this.passwords.hash(input.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash },
      });
      await this.sessions.revokeAllForUser(user.id);
    }

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
        metadata: { role: invite.role },
      },
    });

    return { userId: user.id, tenantId: invite.tenantId, role: invite.role };
  }

  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    // Respuesta uniforme: no revela si la cuenta existe.
    if (!user) return {};

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });
    if (!membership) return {};

    const issued = this.tokens.issue({
      tenantId: membership.tenantId,
      email: user.email,
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
    return { token: issued.token };
  }

  async resetPassword(input: { token: string; newPassword: string }) {
    const tokenHash = this.tokens.hash(input.token);
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
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: hash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidar todas las sesiones activas: al cambiar password.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
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