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
};