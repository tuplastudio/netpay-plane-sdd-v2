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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ["error", "warn"],
    });
    this.$use(auditImpersonationMiddleware);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected");

    // Avisa si la defensa de RLS está bypassed. La app filtra por tenantId en
    // código, pero sin RLS un query olvidado filtra cero y devuelve datos de
    // otros tenants. Si este check falla, ver docs/TENANT-ISOLATION.md.
    try {
      const r = await this.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles
         WHERE rolname = current_user
        LIMIT 1
      `;
      const bypass = r[0]?.rolbypassrls === true;
      if (bypass) {
        this.logger.warn(
          `TENANT ISOLATION: el rol "${process.env.PGUSER ?? "current_user"}" ` +
            `tiene BYPASSRLS. La app filtra por tenantId en código, pero ` +
            `RLS no aplica como defensa de profundidad. ` +
            `Ver docs/TENANT-ISOLATION.md para activar el rol ` +
            `neondb_app sin bypass.`,
        );
      } else {
        this.logger.log(
          `TENANT ISOLATION: RLS activa para rol "${process.env.PGUSER ?? "current_user"}"`,
        );
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