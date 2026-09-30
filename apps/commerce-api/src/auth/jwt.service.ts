import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService as NestJwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";

/**
 * Access token JWT (Authorization: Bearer …).
 *
 * Es un JWT firmado (HS256) de vida corta (default 15 min, `ACCESS_TOKEN_TTL_MS`).
 * El frontend lo guarda en memoria y lo envía en cada request; el backend lo
 * verifica con la firma (sin tocar la BD salvo para confirmar que la sesión
 * subyacente sigue viva y la membresía ACTIVE — eso lo hace `PrincipalGuard`
 * vía `SessionService.resolveByAccessToken`).
 *
 * El `jti` (JWT ID) se persiste en `Session.accessJti` para poder revocar el
 * access antes de su `exp` natural (cambio de rol, logout inmediato) sin
 * esperar a que el JWT venza por sí solo. Cada refresh emite un access nuevo
 * con jti nuevo y actualiza la fila.
 *
 * Por qué HS256 y no RS256: el backend valida y firma con la misma clave
 * (`JWT_SECRET`), no hay terceros que tengan que verificar el token. Si en
 * el futuro queremos dar tokens a clientes externos que verifiquen sin
 * contactarnos, pasamos a RS256 y publicamos la pública.
 */
export interface AccessTokenClaims {
  /** subject: User.id */
  sub: string;
  /** session id (Session.id) — clave para revocación y para sacar membership */
  sid: string;
  /** tenant activo al emitir (puede cambiar vía switch-tenant sin re-emitir) */
  tid: string;
  /** role al emitir */
  role: string;
  /** flag super-admin */
  sup: boolean;
  /** JWT ID — único por access emitido */
  jti: string;
  /** issued at (segundos) */
  iat: number;
  /** expires at (segundos) */
  exp: number;
}

const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1000; // 15 min

function readAccessTtlMs(): number {
  const raw = process.env.ACCESS_TOKEN_TTL_MS;
  if (!raw) return DEFAULT_ACCESS_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACCESS_TTL_MS;
}

function readSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail fast al levantar el proceso si no hay clave o es demasiado corta.
    // HS256 con claves <32 bytes es trivial de romper por fuerza bruta.
    throw new Error(
      "JWT_SECRET requerido y debe tener >=32 chars. Genera uno con `openssl rand -hex 32`.",
    );
  }
  return secret;
}

@Injectable()
export class AccessTokenService {
  private readonly logger = new Logger(AccessTokenService.name);
  private readonly nestJwt: NestJwtService;
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor() {
    this.secret = readSecret();
    this.ttlMs = readAccessTtlMs();
    this.nestJwt = new NestJwtService({
      secret: this.secret,
      signOptions: {
        algorithm: "HS256",
        expiresIn: Math.floor(this.ttlMs / 1000),
      },
    });
  }

  /** TTL configurable para que aparezca en logs y tests. */
  get ttlSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  /** Firma un access token nuevo. El jti es único por token emitido. */
  async sign(input: {
    userId: string;
    sessionId: string;
    tenantId: string;
    role: string;
    isSuperAdmin: boolean;
  }): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlMs);

    const claims: Omit<AccessTokenClaims, "iat" | "exp"> = {
      sub: input.userId,
      sid: input.sessionId,
      tid: input.tenantId,
      role: input.role,
      sup: input.isSuperAdmin,
      jti,
    };

    const tokenStr = await this.nestJwt.signAsync(claims, {
      algorithm: "HS256",
      jwtid: jti,
    });

    this.logger.debug?.(
      `access sign user=${input.userId} sid=${input.sessionId} jti=${jti} ttl=${this.ttlSeconds}s`,
    );

    return { token: tokenStr, jti, expiresAt };
  }

  /**
   * Verifica firma + expiración. NO consulta la BD: la revocación y la
   * membresía viva las aplica el caller (`PrincipalGuard` →
   * `SessionService.resolveByAccessToken`).
   *
   * Si la firma es mala, el token está expirado o el formato es inválido,
   * tira `UnauthorizedException`. Si todo OK, devuelve los claims.
   */
  async verify(token: string): Promise<AccessTokenClaims> {
    let payload: AccessTokenClaims;
    try {
      payload = await this.nestJwt.verifyAsync<AccessTokenClaims>(token, {
        algorithms: ["HS256"],
      });
    } catch {
      // Token expirado, firma inválida, formato malformado, etc. La razón
      // exacta no se filtra al cliente (mismo motivo que en login: no dar
      // pistas a un atacante sobre qué falla).
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Access token inválido o expirado",
      });
    }
    // sanity: claims mínimos que esperamos
    if (!payload.sub || !payload.sid || !payload.jti) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Access token malformado",
      });
    }
    return payload;
  }
}