import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashToken, newSessionToken } from "./rate-limit.service.js";

export interface OpenSessionInput {
  tenantId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  absoluteTtlMs?: number; // default 12h
  inactivityTtlMs?: number; // default 30min
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async openSession(input: OpenSessionInput): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = newSessionToken();
    const now = new Date();
    const absoluteTtl = input.absoluteTtlMs ?? 12 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + absoluteTtl);

    await this.prisma.session.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: hash,
        issuedAt: now,
        lastActivityAt: now,
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resuelve la sesión y el principal de tenant en **cada** petición:
   * `Session.tenantId` es el tenant activo (lo fija login y lo cambia
   * `setActiveTenant`) y el rol se relee de la membresía viva en ese tenant.
   * Sin membresía ACTIVE ahí, la sesión no vale aunque el token sea bueno.
   */
  async resolveSession(token: string | undefined): Promise<{
    sessionId: string;
    userId: string;
    tenantId: string;
    role: string;
    isSuperAdmin: boolean;
  } | null> {
    if (!token) return null;
    const hash = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hash },
      include: { tenant: true, user: { select: { isSuperAdmin: true } } },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    // Sesión abierta pero con inactividad > 30 min → se rechaza.
    // El frontend debería refrescar antes de ese límite; si el navegador se
    // quedó abierto sin requests, forzamos re-login.
    const INACTIVITY_TTL_MS = 30 * 60 * 1000;
    if (session.lastActivityAt) {
      const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
      if (idleMs > INACTIVITY_TTL_MS) return null;
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
    });
    if (!membership || membership.status !== "ACTIVE") return null;

    return {
      sessionId: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      role: membership.role,
      isSuperAdmin: session.user.isSuperAdmin,
    };
  }

  /**
   * Cambia el tenant activo de la sesión. Que el usuario tenga membresía
   * ACTIVE ahí lo valida `AuthService.switchTenant`; aquí solo se persiste.
   * A partir de la siguiente petición `resolveSession` ya devuelve el nuevo
   * tenant y el rol de esa membresía.
   */
  async setActiveTenant(sessionId: string, tenantId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { tenantId, lastActivityAt: new Date() },
    });
  }

  /**
   * Último tenant que usó el usuario: el de su sesión con actividad más
   * reciente (revocada o no). Login lo usa como tenant por defecto cuando el
   * usuario pertenece a varias empresas y no manda `tenantSlug`.
   */
  async lastActiveTenantId(userId: string): Promise<string | null> {
    const last = await this.prisma.session.findFirst({
      where: { userId },
      orderBy: { lastActivityAt: "desc" },
      select: { tenantId: true },
    });
    return last?.tenantId ?? null;
  }

  async touchActivity(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  }

  /**
   * Extiende la vida de la sesión. Llamado por `POST /auth/refresh`.
   *
   * - Si `inactivityTtlMs` está configurado y la sesión lleva más inactiva, se
   *   rechaza (el navegador debería haber refresh antes de ese límite).
   * - Si la sesión no existe, está revocada o ya expiró, devuelve null.
   *
   * Devuelve la nueva fecha de expiración para que el frontend confirme al
   * usuario cuánto le queda.
   */
  async refreshSession(
    token: string,
    inactivityTtlMs?: number,
  ): Promise<{ expiresAt: Date } | null> {
    const hash = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hash } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    if (inactivityTtlMs && session.lastActivityAt) {
      const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
      if (idleMs > inactivityTtlMs) return null;
    }

    const newExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: newExpiresAt, lastActivityAt: new Date() },
    });

    return { expiresAt: newExpiresAt };
  }

  async revoke(token: string): Promise<void> {
    const hash = hashToken(token);
    await this.prisma.session.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export class InvalidSessionError extends UnauthorizedException {
  constructor() {
    super({ code: "UNAUTHORIZED", message: "Invalid or expired session" });
  }
}