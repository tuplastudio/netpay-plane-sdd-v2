import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService, type PrismaWriteEvent } from "../prisma/prisma.service.js";
import { hashToken, newSessionToken } from "./rate-limit.service.js";
import { TtlCache } from "../common/ttl-cache.js";

export interface OpenSessionInput {
  tenantId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  absoluteTtlMs?: number; // default 30d (SESSION_ABSOLUTE_TTL_MS)
  inactivityTtlMs?: number; // default 7d (SESSION_INACTIVITY_TTL_MS)
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

/**
 * Vida ABSOLUTA de la sesión: cuanto vive el token desde que se emite hasta
 * que deja de valer, aunque el usuario siga activo. Por defecto 30 días:
 * cubre todo un ciclo mensual de uso sin pedir re-login, sin ser tan largo
 * que un token robado quede vivo para siempre. Configurable vía
 * `SESSION_ABSOLUTE_TTL_MS` (en ms, ej. 30 días = `2592000000`).
 */
const DEFAULT_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Vida por INACTIVIDAD: si entre dos peticiones del usuario pasa más de este
 * tiempo, la sesión muere (el usuario debe volver a loguearse). Por defecto
 * 7 días: cualquier persona que vuelve a la plataforma en una semana sigue
 * dentro. Configurable vía `SESSION_INACTIVITY_TTL_MS`.
 */
const DEFAULT_INACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cuánto se extiende la vida absoluta en cada `POST /auth/refresh` exitoso. */
const REFRESH_TTL_MS = (() => {
  const raw = process.env.SESSION_ABSOLUTE_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ABSOLUTE_TTL_MS;
})();

function readAbsoluteTtlMs(): number {
  const raw = process.env.SESSION_ABSOLUTE_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ABSOLUTE_TTL_MS;
}

function readInactivityTtlMs(): number {
  const raw = process.env.SESSION_INACTIVITY_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INACTIVITY_TTL_MS;
}

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

  async openSession(input: OpenSessionInput): Promise<{
    refreshToken: string;
    sessionId: string;
    expiresAt: Date;
  }> {
    const { token, hash } = newSessionToken();
    const now = new Date();
    const absoluteTtl = input.absoluteTtlMs ?? readAbsoluteTtlMs();
    const expiresAt = new Date(now.getTime() + absoluteTtl);

    const created = await this.prisma.session.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        // `tokenHash` es ahora el hash del REFRESH token opaco (cookie). El
        // access token es un JWT firmado y viaja por `Authorization: Bearer`,
        // su jti se guarda aparte en `accessJti` tras firmarlo en
        // `auth.controller` (login/mfa/refresh).
        tokenHash: hash,
        issuedAt: now,
        lastActivityAt: now,
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      select: { id: true },
    });

    return { refreshToken: token, sessionId: created.id, expiresAt };
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

  /**
   * Resuelve la sesión cuando el request llega con un JWT de access (Bearer)
   * válido. La firma del JWT ya autenticó al portador; aquí confirmamos que la
   * sesión subyacente no fue revocada ni expiró, y que la membresía sigue
   * ACTIVE. El `jti` debe coincidir con el último emitido (si rotó, los
   * access viejos mueren — defensa contra replay).
   *
   * Usa la misma caché que `resolveSession`, keyed por `sessionId|jti` para
   * no abrir un canal de cache paralelo.
   */
  async resolveByAccessToken(input: {
    sessionId: string;
    jti: string;
  }): Promise<ResolvedSession | null> {
    const cacheKey = `${input.sessionId}|${input.jti}`;
    const resolved = await this.cache.getOrLoad(cacheKey, () =>
      this.loadSessionByAccess(input.sessionId, input.jti),
    );
    return resolved ?? null;
  }

  private async loadSessionByAccess(
    sessionId: string,
    jti: string,
  ): Promise<ResolvedSession | undefined> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        lastActivityAt: true,
        accessJti: true,
        user: { select: { isSuperAdmin: true } },
      },
    });
    if (!session) return undefined;
    if (session.revokedAt) return undefined;
    if (session.expiresAt.getTime() <= Date.now()) return undefined;
    // jti distinto al último persistido = access viejo (rotado por un refresh
    // posterior). El middleware ya rechazó la firma; aquí cortamos el replay.
    if (session.accessJti !== jti) return undefined;

    const INACTIVITY_TTL_MS = readInactivityTtlMs();
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

    // Sesión abierta pero con inactividad > N → se rechaza.
    // El frontend debería refrescar antes de ese límite; si el navegador se
    // quedó abierto sin requests, forzamos re-login. `SESSION_INACTIVITY_TTL_MS`
    // controla N (default 7 días).
    const INACTIVITY_TTL_MS = readInactivityTtlMs();
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
   * Rota el refresh token: invalida el anterior (revoca la sesión vieja,
   * corta cualquier access JWT aún válido cuyo jti apunte a esa sesión) y
   * crea una sesión NUEVA con un refresh NUEVO. Esto cierra la ventana de
   * replay si el refresh viejo fue filtrado: el atacante no puede renovar
   * porque el refresh ya no está en la BD.
   *
   * Llamado por `POST /auth/refresh`, que es `@Public()` (el `PrincipalGuard`
   * no corre antes). La única validación de la petición es `resolveSession`
   * sobre el refresh cookie — mismas reglas que cualquier endpoint
   * autenticado (token válido, no revocado, no expirado, inactividad dentro
   * del límite, membresía ACTIVE).
   *
   * Devuelve la sesión nueva (refresh + expiración) o `null` si la sesión
   * original ya no vale (en cuyo caso el caller responde 401 y el frontend
   * redirige a /login).
   */
  async rotateRefresh(token: string | undefined): Promise<{
    refreshToken: string;
    sessionId: string;
    expiresAt: Date;
    userId: string;
    tenantId: string;
    role: string;
    isSuperAdmin: boolean;
  } | null> {
    if (!token) return null;
    // Refresh decide si la sesión sigue viva: resuelve contra la BD, no caché.
    const oldHash = hashToken(token);
    this.cache.delete(oldHash);
    const existing = await this.resolveSession(token);
    if (!existing) return null;

    const { token: newRefresh, hash: newHash } = newSessionToken();
    const newExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const now = new Date();

    // Una sola escritura atómica sería ideal (no la tenemos en Prisma 5 sin
    // $transaction de 2 queries). El orden importa:
    //   1. Crear la nueva sesión primero (con `tokenHash` nuevo, mismo
    //      tenantId/userId, expiración nueva). Si esto falla, la sesión vieja
    //      sigue válida y el refresh viejo sigue funcionando (no se rompe
    //      nada).
    //   2. Revocar la vieja. Si esto falla, la nueva sigue válida y la vieja
    //      queda activa con un refresh que ya entregamos al cliente — el
    //      atacante que tuviera el refresh viejo podría seguir usándolo
    //      hasta que la inactividad o expiración lo maten. Para evitarlo, el
    //      2 se hace en una `updateMany` con `tokenHash: oldHash`,
    //      `revokedAt: null` (idempotente) y, si la BD reporta 0 filas
    //      modificadas, NO se devuelve la nueva sesión al caller.
    const created = await this.prisma.session.create({
      data: {
        tenantId: existing.tenantId,
        userId: existing.userId,
        tokenHash: newHash,
        issuedAt: now,
        lastActivityAt: now,
        expiresAt: newExpiresAt,
        accessJti: null,
      },
      select: { id: true },
    });

    const revoked = await this.prisma.session.updateMany({
      where: { tokenHash: oldHash, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count === 0) {
      // La sesión vieja ya estaba revocada (otra rotación concurrente, o
      // logout). No le damos al cliente la nueva sesión: podría ser un replay.
      // Tira la nueva fila para no dejar basura.
      await this.prisma.session.delete({ where: { id: created.id } }).catch(() => undefined);
      return null;
    }

    // El rol se relee de la membresía viva, como hace `loadSession`.
    const membership = await this.prisma.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: existing.tenantId, userId: existing.userId },
      },
      select: { role: true, status: true },
    });
    if (!membership || membership.status !== "ACTIVE") {
      await this.prisma.session.delete({ where: { id: created.id } }).catch(() => undefined);
      return null;
    }

    return {
      refreshToken: newRefresh,
      sessionId: created.id,
      expiresAt: newExpiresAt,
      userId: existing.userId,
      tenantId: existing.tenantId,
      role: membership.role,
      isSuperAdmin: existing.isSuperAdmin,
    };
  }

  /**
   * Persiste el `accessJti` recién emitido para la sesión, para que
   * `resolveByAccessToken` pueda detectar replays cuando se rote.
   */
  async recordAccessJti(sessionId: string, jti: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { accessJti: jti, lastActivityAt: new Date() },
    });
    // Invalida la caché de ese sessionId para forzar re-validación con el
    // nuevo jti (la entrada anterior podría tener el jti anterior).
    this.cache.deleteWhere((_k, s) => s.sessionId === sessionId);
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
