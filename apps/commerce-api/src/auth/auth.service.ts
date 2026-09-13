import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { PasswordService } from "./password.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { SessionService } from "./session.service.js";
import { MfaService } from "./mfa.service.js";
import { encryptSecret, decryptSecret } from "../common/crypto/secret-cipher.js";

interface MfaChallenge {
  userId: string;
  tenantId: string;
  role: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class AuthService {
  // Reto MFA de corta vida (5 min): sin sesión completa hasta verificar TOTP.
  // En memoria como RateLimitService — no necesita sobrevivir un restart.
  private readonly mfaChallenges = new Map<string, MfaChallenge>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService,
    readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    tenantSlug?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const key = RateLimitService.keyFor(input.email.toLowerCase(), input.ip);
    if (!this.rateLimit.allow(key)) {
      throw new HttpException(
        { code: "RATE_LIMITED", message: "Demasiados intentos. Intenta en 15 min." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (!user) {
      this.rateLimit.recordFailure(key);
      // Respuesta uniforme: no revela si la cuenta existe.
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Credenciales inválidas",
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      this.rateLimit.recordFailure(key);
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Credenciales inválidas",
      });
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { tenant: true },
    });
    if (memberships.length === 0) {
      this.rateLimit.recordFailure(key);
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Sin membresía activa",
      });
    }

    const membership = input.tenantSlug
      ? memberships.find((m) => m.tenant.slug === input.tenantSlug)
      : await this.defaultMembership(user.id, memberships);
    if (!membership) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Sin acceso al tenant solicitado",
      });
    }

    if (membership.tenant.status === "DISABLED") {
      // Respuesta diferenciada: cuenta deshabilitada pero sin filtrar más.
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Cuenta deshabilitada",
      });
    }

    this.rateLimit.reset(key);

    // MFA ya activado: la contraseña sola no basta, se exige TOTP antes de
    // abrir sesión. Sin activar: se deja pasar (no hay forma de enrolarse
    // sin sesión), mfaSetupRecommended avisa a la UI que debería enrolar.
    if (user.totpEnabled) {
      const challengeToken = randomBytes(24).toString("base64url");
      this.mfaChallenges.set(challengeToken, {
        userId: user.id,
        tenantId: membership.tenantId,
        role: membership.role,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });
      return {
        mfaRequired: true,
        mfaChallengeToken: challengeToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
    }

    const session = await this.sessions.openSession({
      tenantId: membership.tenantId,
      userId: user.id,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return {
      sessionToken: session.token,
      userId: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      isSuperAdmin: user.isSuperAdmin,
      mfaRequired: false,
      mfaSetupRecommended: ["OWNER", "ADMIN", "FINANCE"].includes(membership.role),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Tenant por defecto al entrar sin `tenantSlug` cuando el usuario pertenece
   * a varias empresas: el último que usó (su sesión con actividad más
   * reciente) si sigue siendo una membresía ACTIVE de un tenant ACTIVE; si no,
   * la membresía más antigua de un tenant ACTIVE. Si ninguna empresa está
   * activa se devuelve la primera para que login conteste "deshabilitada".
   */
  private async defaultMembership<
    M extends { tenantId: string; joinedAt: Date; tenant: { status: string } },
  >(userId: string, memberships: M[]): Promise<M | undefined> {
    const usable = memberships.filter((m) => m.tenant.status === "ACTIVE");
    if (usable.length === 0) return memberships[0];
    if (usable.length === 1) return usable[0];
    const lastTenantId = await this.sessions.lastActiveTenantId(userId);
    const last = lastTenantId ? usable.find((m) => m.tenantId === lastTenantId) : undefined;
    if (last) return last;
    return [...usable].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
  }

  /**
   * Cambia el tenant activo de la sesión. Exige membresía ACTIVE del usuario
   * en un tenant ACTIVE; si no, 403 sin revelar si la empresa existe. Es
   * idempotente: pedir el tenant que ya está activo no mueve nada ni audita.
   */
  async switchTenant(input: { userId: string; sessionId: string; tenantId: string }) {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
      select: {
        role: true,
        status: true,
        tenant: { select: { id: true, slug: true, name: true, status: true } },
      },
    });
    if (!membership || membership.status !== "ACTIVE" || membership.tenant.status !== "ACTIVE") {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "No tienes acceso a esa empresa",
      });
    }

    const session = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
      select: { tenantId: true, userId: true, revokedAt: true },
    });
    if (!session || session.userId !== input.userId || session.revokedAt) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Sesión requerida" });
    }

    if (session.tenantId !== input.tenantId) {
      await this.sessions.setActiveTenant(input.sessionId, input.tenantId);
      await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.userId,
          action: "auth.tenant_switched",
          targetType: "Tenant",
          targetId: input.tenantId,
          metadata: { fromTenantId: session.tenantId, sessionId: input.sessionId },
        },
      });
    }

    return {
      tenantId: membership.tenant.id,
      slug: membership.tenant.slug,
      name: membership.tenant.name,
      role: membership.role,
    };
  }

  /** Segundo factor: verifica TOTP/recovery code y recién ahí abre sesión. */
  async completeMfa(input: {
    challengeToken: string;
    code: string;
    ip?: string;
    userAgent?: string;
  }) {
    const challenge = this.mfaChallenges.get(input.challengeToken);
    if (!challenge || challenge.expiresAt < Date.now()) {
      this.mfaChallenges.delete(input.challengeToken);
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Reto MFA inválido o expirado" });
    }
    if (challenge.attempts >= 5) {
      this.mfaChallenges.delete(input.challengeToken);
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Demasiados intentos" });
    }

    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.totpSecret) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Reto MFA inválido" });
    }

    const secret = decryptSecret(user.totpSecret);
    let ok = !!secret && this.mfa.verifyTotp(secret, input.code);

    if (!ok && user.recoveryCodesHash) {
      const hashed = user.recoveryCodesHash as unknown as string[];
      const remaining = this.mfa.consumeRecoveryCode(hashed, input.code);
      if (remaining) {
        ok = true;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { recoveryCodesHash: remaining as never },
        });
      }
    }

    if (!ok) {
      challenge.attempts += 1;
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Código inválido" });
    }

    this.mfaChallenges.delete(input.challengeToken);
    const session = await this.sessions.openSession({
      tenantId: challenge.tenantId,
      userId: challenge.userId,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return {
      sessionToken: session.token,
      userId: challenge.userId,
      tenantId: challenge.tenantId,
      role: challenge.role,
      isSuperAdmin: user.isSuperAdmin,
      mfaRequired: false,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /** Inicia enrolamiento MFA para un usuario ya autenticado. */
  async enrollMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Usuario no accesible" });

    const enrollment = this.mfa.enroll(user.email);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: encryptSecret(enrollment.secretBase32),
        recoveryCodesHash: this.mfa.hashRecoveryCodes(enrollment.recoveryCodes) as never,
        totpEnabled: false,
      },
    });
    // secretBase32/recoveryCodes en claro: se muestran una sola vez al usuario.
    return enrollment;
  }

  /** Confirma el enrolamiento con un código TOTP válido; activa MFA. */
  async confirmMfaEnrollment(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "No hay enrolamiento pendiente" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!secret || !this.mfa.verifyTotp(secret, code)) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Código inválido" });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
  }

  /** Desactiva MFA: exige un código TOTP vigente o un recovery code, para que
   * no baste con haber robado la sesión del navegador. */
  async disableMfa(userId: string, code: string, tenantId: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabled || !user.totpSecret) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "MFA no está activado" });
    }
    const secret = decryptSecret(user.totpSecret);
    const validTotp = !!secret && this.mfa.verifyTotp(secret, code);
    const remaining = validTotp
      ? (user.recoveryCodesHash as string[] | null)
      : this.mfa.consumeRecoveryCode((user.recoveryCodesHash as string[] | null) ?? [], code);
    if (!validTotp && remaining === null) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Código inválido" });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, recoveryCodesHash: Prisma.JsonNull },
    });
    if (tenantId) {
      await this.prisma.auditLog.create({
        data: { tenantId, actorId: userId, action: "auth.mfa_disabled", targetType: "User", targetId: userId },
      });
    }
  }

  /** Reemplaza los recovery codes vigentes por un lote nuevo (se muestran una
   * sola vez); exige un código TOTP vigente para no regenerarlos a la ligera. */
  async regenerateRecoveryCodes(userId: string, code: string, tenantId: string | null): Promise<string[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabled || !user.totpSecret) {
      throw new BadRequestException({ code: "RULE_VIOLATION", message: "MFA no está activado" });
    }
    const secret = decryptSecret(user.totpSecret);
    if (!secret || !this.mfa.verifyTotp(secret, code)) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Código inválido" });
    }
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
    await this.prisma.user.update({
      where: { id: userId },
      data: { recoveryCodesHash: this.mfa.hashRecoveryCodes(recoveryCodes) as never },
    });
    if (tenantId) {
      await this.prisma.auditLog.create({
        data: { tenantId, actorId: userId, action: "auth.mfa_recovery_regenerated", targetType: "User", targetId: userId },
      });
    }
    return recoveryCodes;
  }

  async me(userId: string, tenantId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, totpEnabled: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Usuario no accesible" });
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { slug: true, name: true, primaryColor: true, secondaryColor: true, accentColor: true, logoUrl: true },
        })
      : null;
    // El rol se relee de la membresía viva, no del principal de la sesión: si a
    // alguien lo degradaron a mitad de sesión, /auth/me debe decir la verdad.
    // Campos aditivos (role, tenantId): no cambian nada de lo ya existente.
    const membership = tenantId
      ? await this.prisma.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
          select: { role: true, status: true },
        })
      : null;
    // Todas las empresas a las que puede entrar (membresía ACTIVE en tenant
    // ACTIVE): el selector del portal las lista y `POST /auth/switch-tenant`
    // acepta cualquiera de ellas. `tenantId` (arriba) dice cuál está activa.
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: "ACTIVE", tenant: { status: "ACTIVE" } },
      select: {
        tenantId: true,
        role: true,
        status: true,
        tenant: { select: { slug: true, name: true, logoUrl: true } },
      },
      orderBy: { tenant: { name: "asc" } },
    });
    return {
      ...user,
      tenantId: tenantId ?? null,
      tenantSlug: tenant?.slug ?? null,
      tenantName: tenant?.name ?? null,
      role: membership?.status === "ACTIVE" ? membership.role : null,
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        slug: m.tenant.slug,
        name: m.tenant.name,
        role: m.role,
        status: m.status,
        logoUrl: m.tenant.logoUrl,
      })),
      branding: tenant
        ? {
            primaryColor: tenant.primaryColor,
            secondaryColor: tenant.secondaryColor,
            accentColor: tenant.accentColor,
            logoUrl: tenant.logoUrl,
          }
        : null,
    };
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) return;
    await this.sessions.revoke(sessionToken);
  }
}