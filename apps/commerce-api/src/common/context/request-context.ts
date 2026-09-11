import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de petición global con AsyncLocalStorage.
 * Ver docs/02-fnd.md T-FND-05: tenant y principal vienen de credenciales
 * verificadas, no del body.
 */
export interface Principal {
  type: "USER" | "API_KEY" | "SERVICE" | "ANONYMOUS";
  userId?: string;
  tenantId?: string;
  role?: string;
  scopes?: string[];
  sessionId?: string;
  apiKeyId?: string;
  /** Gestiona /super-admin: crear/editar tenants, cross-tenant. Nunca viene de un API key de servicio. */
  isSuperAdmin?: boolean;
  /**
   * La petición corre bajo impersonación: `tenantId` y `role` son los del
   * tenant impersonado, no los del usuario. Ver PrincipalGuard.
   */
  impersonated?: boolean;
  /**
   * Usuario real detrás de la impersonación (el super-admin). Coincide con
   * `userId`, pero se guarda aparte para que quede explícito en la auditoría
   * que la acción NO la hizo el dueño del tenant.
   */
  impersonatorUserId?: string;
}

interface RequestStore {
  requestId: string;
  principal: Principal;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  /** Ejecuta fn con un store fresco para la petición. */
  run<T>(fn: () => T, initial?: Partial<RequestStore>): T {
    const store: RequestStore = {
      requestId: initial?.requestId ?? "",
      principal: initial?.principal ?? { type: "ANONYMOUS" },
    };
    return storage.run(store, fn);
  },

  get requestId(): string {
    return storage.getStore()?.requestId ?? "";
  },

  setRequestId(id: string): void {
    const store = storage.getStore();
    if (store) store.requestId = id;
  },

  get principal(): Principal {
    return storage.getStore()?.principal ?? { type: "ANONYMOUS" };
  },

  setPrincipal(p: Principal): void {
    const store = storage.getStore();
    if (store) store.principal = p;
  },

  get tenantId(): string | undefined {
    return storage.getStore()?.principal.tenantId;
  },

  get userId(): string | undefined {
    return storage.getStore()?.principal.userId;
  },

  /** La petición corre bajo impersonación de un super-admin. */
  get impersonated(): boolean {
    return storage.getStore()?.principal.impersonated === true;
  },

  /** Super-admin real detrás de la impersonación, si la hay. */
  get impersonatorUserId(): string | undefined {
    return storage.getStore()?.principal.impersonatorUserId;
  },

  /**
   * Sello de impersonación para adjuntar al `metadata` de un AuditLog. Vacío
   * cuando la petición no es impersonada, para no ensuciar las filas normales.
   * Lo aplica automáticamente el middleware de Prisma (ver PrismaService), así
   * que ningún servicio tiene que acordarse de llamarlo.
   */
  get auditImpersonationStamp(): Record<string, unknown> {
    const principal = storage.getStore()?.principal;
    if (!principal?.impersonated) return {};
    return {
      impersonated: true,
      impersonatorUserId: principal.impersonatorUserId ?? principal.userId ?? null,
    };
  },
};