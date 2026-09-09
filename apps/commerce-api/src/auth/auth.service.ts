import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
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
    private readonly sessions: SessionService,
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
      : memberships[0];
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
      mfaRequired: false,
      mfaSetupRecommended: ["OWNER", "ADMIN", "FINANCE"].includes(membership.role),
      expiresAt: session.expiresAt.toISOString(),
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

  async me(userId: string, tenantId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, totpEnabled: true },
    });
    if (!user) throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Usuario no accesible" });
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, name: true } })
      : null;
    return { ...user, tenantSlug: tenant?.slug ?? null, tenantName: tenant?.name ?? null };
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) return;
    await this.sessions.revoke(sessionToken);
  }
}