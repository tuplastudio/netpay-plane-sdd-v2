import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { RequestContext } from "../common/context/request-context.js";

/** Formato UUID que debe cumplir cualquier tenantId antes de llegar al SQL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo único que este middleware necesita mirar de los params de Prisma. */
type AuditMiddlewareParams = Prisma.MiddlewareParams;

/**
 * Marca de impersonación en TODA fila de AuditLog.
 *
 * Cuando un super-admin entra a un tenant con la cookie `impersonate`, el
 * `PrincipalGuard` sustituye tenant y rol del principal, así que cada
 * `auditLog.create` de cualquier servicio quedaba indistinguible de una acción
 * del dueño de la empresa. Hay 26 sitios que escriben auditoría; en lugar de
 * hilar el contexto por todos, se hace en el único punto por el que pasan
 * todos: el middleware del cliente Prisma (aplica también dentro de
 * `$transaction`, que es como escriben la mayoría).
 *
 * Solo AÑADE claves (`impersonated`, `impersonatorUserId`) al metadata; nunca
 * pisa las del llamador ni toca actorId. Si la petición no es impersonada el
 * middleware es un no-op.
 */
export async function auditImpersonationMiddleware(
  params: AuditMiddlewareParams,
  next: (p: AuditMiddlewareParams) => Promise<unknown>,
): Promise<unknown> {
  if (params.model !== "AuditLog") return next(params);
  if (params.action !== "create" && params.action !== "createMany") return next(params);

  const stamp = RequestContext.auditImpersonationStamp;
  if (Object.keys(stamp).length === 0) return next(params);

  const data = params.args?.data;
  const apply = (row: Record<string, unknown>) => {
    const metadata = row.metadata;
    row.metadata = {
      ...stamp,
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {}),
    };
  };
  if (Array.isArray(data)) {
    for (const row of data) apply(row as Record<string, unknown>);
  } else if (data && typeof data === "object") {
    apply(data as Record<string, unknown>);
  }
  return next(params);
}

/**
 * Inyecta el contexto RLS (`SET LOCAL app.tenant_id = ...`) al inicio de cada
 * query. Lee el tenantId del AsyncLocalStorage que mantiene `RequestContext`
 * (lo llena `PrincipalGuard` con el tenant del principal o del impersonated).
 *
 * Prisma envuelve cada query en su propia tx corta; con `SET LOCAL` (tercer
 * arg `true`) el contexto aplica a esa tx y se revierte solo.
 *
 * Si no hay tenantId (rutas públicas pre-tenant, login, etc.) el middleware
 * setea `app.tenant_id = ''` (string vacío). La policy RLS devuelve NULL al
 * comparar con NULL, así que `tenantId = NULL` → 0 filas → la query falla
 * silenciosamente en tablas multi-tenant. Por eso DROPEAMOS las policies de
 * tablas no-multi-tenant (User, Membership, etc.) — sin policy, el filtro no
 * aplica y la query pasa.
 */
async function rlsContextMiddleware(
  params: Prisma.MiddlewareParams,
  next: (p: Prisma.MiddlewareParams) => Promise<unknown>,
): Promise<unknown> {
  const tenantId = RequestContext.tenantId ?? "";
  const safe = tenantId && UUID_RE.test(tenantId) ? tenantId : "";
  // Accedemos al client de Prisma via una closure en el módulo. Lo creamos
  // con `globalThis` para evitar import circulares (PrismaService se crea
  // después que esta función).
  const client = await getPrismaClient();
  if (!client) {
    // Antes del primer connect (en startup tests o jobs) saltamos.
    return next(params);
  }
  try {
    await client.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', $1, ${params.runInTransaction ? "true" : "false"})`,
      [safe],
    );
  } catch (e) {
    // Si la conexión no permite set_config (ej: rol sin permisos sobre
    // pg_catalog), no es fatal — la app sigue filtrando a nivel código.
    if (!(e instanceof Error) || !/permission denied/.test(e.message)) {
      throw e;
    }
  }
  return next(params);
}

/** Singleton lazy del PrismaClient. Se inyecta desde PrismaService.constructor. */
let _client: PrismaClient | undefined;
async function getPrismaClient(): Promise<PrismaClient | undefined> {
  return _client;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ["error", "warn"],
    });
    _client = this;
    // rlsContextMiddleware debe ir PRIMERO: cualquier otro middleware que
    // emita queries vería el contexto activo.
    this.$use(rlsContextMiddleware);
    this.$use(auditImpersonationMiddleware);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected");

    // Avisa si la defensa de RLS está bypassed. La app filtra por tenantId en
    // código, pero sin RLS un query olvidado filtra cero y devuelve datos de
    // otros tenants. Si este check falla, ver docs/TENANT-ISOLATION.md.
    try {
      const rows = await this.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
        SELECT rolname, rolbypassrls
          FROM pg_roles
         WHERE rolname = current_user
         LIMIT 1
      `;
      const me = rows[0];
      if (me && me.rolbypassrls) {
        this.logger.warn(
          `TENANT ISOLATION: el rol "${me.rolname}" tiene BYPASSRLS. ` +
            `La app filtra por tenantId en código, pero RLS no aplica ` +
            `como defensa de profundidad. Ver docs/TENANT-ISOLATION.md ` +
            `para activar el rol neondb_app sin bypass.`,
        );
      } else if (me) {
        this.logger.log(`TENANT ISOLATION: RLS activa para rol "${me.rolname}"`);
      }
    } catch {
      // Si no tenemos permiso de leer pg_roles (Neon limita), no es fatal;
      // ya filtramos por tenantId en código.
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Ejecuta una función con SET LOCAL app.tenant_id = ... para RLS.
   * Ver docs/03-iam.md T-IAM-06.
   */
  async withTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    // `SET LOCAL` no admite parámetros de bind, así que la versión anterior
    // interpolaba el tenantId en el SQL (`SET LOCAL app.tenant_id = '${id}'`).
    // Cualquier llamador que dejara entrar una cadena controlada por el
    // cliente (un :id de la URL, un ?tenantId=) podía cerrar la comilla y
    // ejecutar SQL arbitrario. Se cierra por dos vías:
    //   1. Se exige que sea un UUID antes de tocar la base.
    //   2. Se usa set_config(...), que sí acepta un parámetro real.
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`withTenant: tenantId inválido (se esperaba UUID): ${JSON.stringify(tenantId)}`);
    }
    return this.$transaction(async (tx) => {
      // El tercer argumento `true` = is_local, equivalente a SET LOCAL: se
      // revierte al terminar la transacción.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}