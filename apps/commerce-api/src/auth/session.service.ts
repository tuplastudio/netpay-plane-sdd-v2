import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService, type PrismaWriteEvent } from "../prisma/prisma.service.js";
import { hashToken, newSessionToken } from "./rate-limit.service.js";
import { TtlCache } from "../common/ttl-cache.js";

export interface OpenSessionInput {
  tenantId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  absoluteTtlMs?: number; // default 12h
  inactivityTtlMs?: number; // default 30min
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: string;
  isSuperAdmin: boolean;
}

/**
 * Vida de la sesión resuelta en memoria. Cada petición autenticada por
 * cookie hacía 2 lecturas (Session + Membership); con el portal abriendo
 * 5–10 peticiones por pantalla eso es puro ruido en la base. El TTL es corto
 * y además CUALQUIER escritura en Session/Membership/User vacía la caché
 * (ver constructor), así que revocar, cambiar de empresa o deshabilitar una
 * membresía se ve en la siguiente petición.
 */
export const SESSION_CACHE_TTL_MS = 5_000;

/**
 * `lastActivityAt` se escribía en CADA petición. La regla de inactividad es
 * de 30 min, así que basta con persistirla una vez por minuto por sesión.
 */
export const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

/** Modelos cuya escritura invalida la caché de sesiones. */
const SESSION_CACHE_MODELS = ["Session", "Membership", "User"] as const;

/**
 * `touchActivity` escribe solo `lastActivityAt`; esa escritura no cambia nada
 * de lo cacheado y no debe vaciar la caché (si no, cada toque la tiraría).
 */
export function isActivityTouch(event: PrismaWriteEvent): boolean {
  if (event.model !== "Session" || event.action !== "update") return false;
  const data = event.args?.data;
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data as Record<string, unknown>);
  return keys.length === 1 && keys[0] === "lastActivityAt";
}

@Injectable()
export class SessionService {
  private readonly cache = new TtlCache<string, ResolvedSession>({
    ttlMs: SESSION_CACHE_TTL_MS,
    maxEntries: 5_000,
  });
  private readonly touched = new TtlCache<string, true>({
    ttlMs: ACTIVITY_TOUCH_INTERVAL_MS,
    maxEntries: 20_000,
  });

  constructor(private readonly prisma: PrismaService) {
    // Los tests construyen el servicio con un Prisma falso sin `onWrite`;
    // en ese caso la invalidación explícita de abajo (revoke, setActiveTenant,
    // refresh) es la que aplica.
    this.prisma.onWrite?.(SESSION_CACHE_MODELS, (event) => {
      if (!isActivityTouch(event)) this.cache.clear();
    });
  }

  /** Vacía la caché de sesiones resueltas (todas las entradas). */
  invalidateAll(): void {
    this.cache.clear();
  }

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
   *
   * El resultado positivo se cachea `SESSION_CACHE_TTL_MS` por hash del
   * token (nunca por el token en claro); los negativos no se cachean.
   */
  async resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token) return null;
    const hash = hashToken(token);
    const resolved = await this.cache.getOrLoad(hash, () => this.loadSession(hash));
    return resolved ?? null;
  }

  private async loadSession(hash: string): Promise<ResolvedSession | undefined> {
    // `select` acotado: antes se hacía `include: { tenant: true }` y la fila
    // completa del tenant (plantillas JSON, branding...) viajaba en cada
    // petición sin usarse.
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        lastActivityAt: true,
        user: { select: { isSuperAdmin: true } },
      },
    });
    if (!session) return undefined;
    if (session.revokedAt) return undefined;
    if (session.expiresAt.getTime() <= Date.now()) return undefined;

    // Sesión abierta pero con inactividad > 30 min → se rechaza.
    // El frontend debería refrescar antes de ese límite; si el navegador se
    // quedó abierto sin requests, forzamos re-login.
    const INACTIVITY_TTL_MS = 30 * 60 * 1000;
    if (session.lastActivityAt) {
      const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
      if (idleMs > INACTIVITY_TTL_MS) return undefined;
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
      select: { role: true, status: true },
    });
    if (!membership || membership.status !== "ACTIVE") return undefined;

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
    this.cache.clear();
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

  /**
   * Registra actividad de la sesión, como mucho una vez por
   * `ACTIVITY_TOUCH_INTERVAL_MS` por sesión (el resto de llamadas son no-op).
   */
  async touchActivity(sessionId: string): Promise<void> {
    if (this.touched.get(sessionId)) return;
    this.touched.set(sessionId, true);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  }

  /**
   * Extiende la vida de la sesión. Llamado por `POST /auth/refresh`, que es
   * `@Public()`: el `PrincipalGuard` no corre antes, así que **esta** es la
   * única validación. Reusa `resolveSession` para aplicar exactamente las
   * mismas reglas que cualquier otra petición (token válido, no revocada, no
   * expirada, inactividad < 30 min, membresía ACTIVE): una sesión que no
   * podría entrar a `/auth/me` tampoco puede extenderse.
   *
   * Devuelve la nueva fecha de expiración absoluta (12h desde ahora) o `null`
   * si la sesión ya no vale.
   */
  async refreshSession(token: string | undefined): Promise<{ expiresAt: Date } | null> {
    // Refresh es la operación que decide si la sesión sigue viva: se
    // resuelve contra la base, no desde la caché.
    if (token) this.cache.delete(hashToken(token));
    const session = await this.resolveSession(token);
    if (!session) return null;

    const newExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.prisma.session.update({
      where: { id: session.sessionId },
      data: { expiresAt: newExpiresAt, lastActivityAt: new Date() },
    });
    this.touched.set(session.sessionId, true);

    return { expiresAt: newExpiresAt };
  }

  async revoke(token: string): Promise<void> {
    const hash = hashToken(token);
    await this.prisma.session.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.cache.delete(hash);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.cache.deleteWhere((_hash, session) => session.userId === userId);
  }
}

export class InvalidSessionError extends UnauthorizedException {
  constructor() {
    super({ code: "UNAUTHORIZED", message: "Invalid or expired session" });
  }
}
